"use strict";
var through = require('through2').obj;
var pump = require("pump");
var pumpify = require("pumpify").obj;
var split = require("split2");
var zlib = require("zlib");
var fastCsv = require("fast-csv");
var write = require("flush-write-stream");
var AWS = require("aws-sdk");
var https = require("https");
var PassThrough = require('stream').PassThrough;
var s3 = new AWS.S3({
	apiVersion: '2006-03-01',
	httpOptions: {
		agent: new https.Agent({
			keepAlive: true
		})
	}
});
var stream = require("stream");
var moment = require("moment");
var async = require("async");

var backoff = require("backoff");

var leoS3 = require("./helper/leos3.js");
var chunkEventStream = require("./helper/chunkEventStream.js");
var cronlib = require("../cron.js");
var dynamo = require("../dynamodb.js");
var refUtil = require("../reference.js");

module.exports = function (configure = {}) {
	var kinesis = new AWS.Kinesis({
		region: configure.aws.region
	});
	var dynamodb = new dynamo({
		region: configure.aws.region
	});

	var cron = cronlib(configure);
	var pad = "0000000";
	var padLength = -1 * pad.length;
	var ls = {
		through: (func, flush) => {
			return through(function (obj, enc, done) {
				try {
					func.call(this, obj, done, this.push.bind(this));
				} catch (err) {
					console.log(err);
					done(err);
				}
			}, flush ? function (done) {
				flush.call(this, done);
			} : null);
		},
		pipeline: pumpify,
		split: split,
		gzip: zlib.createGzip,
		gunzip: zlib.createGunzip,
		gzipChunk: function (opts, process) {
			opts = Object.assign({
				buffer: 1000,
				records: 1000,
				size: 1024 * 200,
				time: {
					seconds: 10
				},
				debug: true
			}, opts || {});

			var gzip;
			var event;

			function resetGzip() {
				event = {
					source: null,
					buffer: new Buffer(0),
					start: null,
					end: null,
					records: 0,
					size: 0,
					gzipSize: 0
				};
				gzip = zlib.createGzip();

				gzip.on('data', function (chunk) {
					event.buffer = Buffer.concat([event.buffer, chunk]);
					event.gzipSize += Buffer.byteLength(chunk);
				});
			}
			resetGzip();

			var timeTrigger = false;
			var timeout = null;

			function emitChunk(callback, last) {
				opts.debug && console.log(`gzip emitting ${last?'due to stream end':''} ${event.size>opts.size?'due to size':''} ${timeTrigger?'due to time':''} ${event.records>opts.records?'due to record count':''}  records:${event.records} size:${event.size}`);
				timeTrigger = false;
				clearTimeout(timeout);
				timeout = null;
				gzip.end();
				gzip.once('end', () => {
					opts.debug && console.log(event.records);
					opts.debug && console.log(`Byte ratio  ${Buffer.byteLength(event.buffer)}/${event.size}  ${Buffer.byteLength(event.buffer)/event.size}`);
					opts.debug && console.log(`Capacity ratio  ${Math.ceil(Buffer.byteLength(event.buffer)/1024)}/${event.records}  ${Math.ceil(Buffer.byteLength(event.buffer)/1024)/event.records}`);
					var o = event;
					resetGzip();
					callback(null, obj);
				});
			}

			return through({
					decodeStrings: false,
					highWaterMark: opts.buffer
				}, function (obj, enc, callback) {
					event.records++;

					if (!timeout) { //make sure no event gets too old
						timeout = setTimeout(() => {
							timeTrigger = true;
						}, moment.duration(opts.time).asMilliseconds());
					}

					if (process) {
						process(obj);
					}

					var d = JSON.stringify(obj) + "\n";
					event.size += Buffer.byteLength(d);
					if (!gzip.write(d)) {
						gzip.once('drain', () => {
							if (event.size > opts.size || timeTrigger || event.records >= opts.records) {
								emitChunk((err, obj) => {
									this.push(obj);
									callback();
								});
							} else {
								callback();
							}
						});
					} else if (event.size > opts.size || timeTrigger || event.records >= opts.records) {
						emitChunk((err, obj) => {
							this.push(obj);
							callback();
						});
					} else {
						callback();
					}
				},
				function flush(callback) {
					if (event.records) {
						emitChunk((err, obj) => {
							console.log("GZIP END");
							this.push(obj);
							callback();
						}, true);
					} else {
						console.log("GZIP EMPTY END");
						callback();
					}
				});
		},
		write: write.obj,
		pipe: pump,
		stringify: () => {
			return through((obj, enc, done) => {
				done(null, JSON.stringify(obj) + "\n");
			});
		},
		parse: () => {
			return pumpify(split(), through((obj, enc, done) => {
				if (!obj) {
					done();
				} else {
					try {
						obj = JSON.parse(obj);
					} catch (err) {
						console.log(err);
						done(err);
						return;
					}
					done(null, obj);
				}
			}));
		},
		fromCSV: function (fieldList, opts) {
			opts = Object.assign({
				headers: fieldList,
				ignoreEmpty: true,
				trim: true,
				escape: '\\',
				nullValue: "\\N",
				delimiter: '|'
			}, opts || {});

			var parse = fastCsv.parse(opts);
			var transform = through((obj, enc, done) => {
				for (var i in obj) {
					if (obj[i] === opts.nullValue) {
						obj[i] = null;
					}
				}
				done(null, obj);
			});

			parse.on("error", () => {
				console.log(arguments);
			});

			return pumpify(parse, transform);
		},
		toCSV: (fieldList, opts) => {
			opts = Object.assign({
				nullValue: "\\N",
				delimiter: ','
			}, opts || {});
			return fastCsv.format({
				headers: fieldList,
				delimiter: opts.delimiter,
				transform: function (row) {
					for (var key in row) {
						if (row[key] === null || row[key] === undefined) {
							row[key] = opts.nullValue;
						}
						if (row[key] && row[key].match) {
							if (row[key].match(/\n/, '')) {
								row[key] = row[key].replace(/\n/g, '');
							}
						}
					}
					return row;
				}
			});
		},
		toS3: (Bucket, File) => {
			var callback = null;
			var pass = new PassThrough();
			console.log(Bucket, File);
			s3.upload({
				Bucket: Bucket,
				Key: File,
				Body: pass
			}, (err) => {
				console.log("done uploading", err);
				callback(err);
			});
			return write((s, enc, done) => {
				if (!pass.write(s)) {
					pass.once('drain', () => {
						done();
					});
				} else {
					done();
				}
			}, (cb) => {
				callback = cb;
				pass.end();
			});
		},
		fromS3: (file, opts) => {
			opts = Object.assign({}, opts);
			return (opts.s3 || s3).getObject({
				Bucket: file.bucket || file.Bucket,
				Key: file.key || file.Key,
				Range: file.range || undefined
			}).createReadStream();
		},
		asEvent: function (opts) {
			opts = Object.assign({
				id: "unknown"
			}, opts);
			if (typeof opts.kinesis_number != "function") {
				var kn = opts.kinesis_number;
				opts.kinesis_number = function () {
					return kn;
				};
			}
			return this.through((data, done) => {
				done(null, {
					id: opts.id,
					event: opts.event,
					payload: data,
					kinesis_number: opts.kinesis_number(data)
				});
			});
		},
		log: function () {
			return through(function (obj, enc, callback) {
				if (typeof obj == "string") {
					console.log(obj);
				} else {
					console.log(JSON.stringify(obj, null, 2));
				}
				callback(null, obj);
			});
		},
		devnull: function () {
			return new stream.Writable({
				objectMode: true,
				write(chunk, encoding, callback) {
					callback();
				}
			});
		},
		load: function (id, outQueue) {
			return ls.pipeline(ls.through((obj, done) => {
				var e;
				if (obj.payload) {
					e = obj;
				} else {
					e = {
						payload: obj
					}
				}
				e.id = id;
				e.event = outQueue;
				if (!e.event_source_timestamp) {
					e.event_source_timestamp = moment.now();
				}
				done(null, e);
			}), ls.toLeo(id), ls.toCheckpoint());
		},
		enrich: function (opts, callback) {
			var id = opts.id;
			var inQueue = opts.inQueue;
			var outQueue = opts.outQueue;
			var func = opts.transform;

			return ls.pipe(ls.fromLeo(id, inQueue), ls.process(id, func, outQueue), ls.toLeo(id), ls.toCheckpoint(), callback);
		},
		offload: function (opts, callback) {
			var id = opts.id;
			var inQueue = opts.inQueue || opts.queue;
			var func = opts.each || opts.transform;
			var batch = {
				size: 1,
				map: a => a
			};
			if (!opts.batch || typeof opts.batch === "number") {
				batch.size = opts.batch || batch.size;
			} else {
				batch.size = opts.batch.size || batch.size;
				batch.map = opts.batch.map || batch.map;
			}

			return ls.pipe(
				ls.fromLeo(id, inQueue),
				ls.through((obj, done) => {
					batch.map(obj.payload, obj, (err, r, rOpts = {}) => {
						if (err || !r) {
							done(err);
						} else {
							obj.payload = r;
							done(null, obj)
						}
					});
				}),
				ls.batch(batch.size),
				ls.through((batch, done) => {
					batch.units = batch.payload.length;
					let last = batch.payload[batch.units - 1];
					batch.event_source_timestamp = last.event_source_timestamp;
					batch.event = last.event;
					batch.eid = last.eid;
					done(null, batch);
				}),
				ls.process(id, func, null),
				ls.pipeline(chunkEventStream(ls, null, {
					records: 1,
					size: 1,
					time: {
						seconds: 10
					},
					debug: false
				}), ls.through((obj, done) => {
					done(null, {
						id: id,
						correlations: [obj.correlations]
					});
				})),
				ls.toCheckpoint({
					debug: false
				}), callback);
		},
		process: function (id, func, outQueue) {
			var firstEvent;
			var units;

			function reset() {
				firstEvent = null;
				units = 0;
			}
			reset();

			return ls.through((obj, done) => {
				if (!firstEvent) {
					firstEvent = obj;
				}
				units += obj.units || 1;
				func(obj.payload, obj, (err, r, rOpts = {}) => {
					if (err) {
						done(err);
					} else if (r === true) { //then we handled it, though it didn't create an object
						done(null, {
							id: id,
							event_source_timestamp: obj.event_source_timestamp,
							correlation_id: {
								source: obj.event,
								start: obj.eid,
								units: obj.units || 1
							}
						});
					} else if (r) { //then we are actually writing an object
						done(null, {
							id: id,
							event: outQueue,
							payload: r,
							event_source_timestamp: obj.event_source_timestamp,
							correlation_id: {
								source: obj.event,
								start: obj.eid,
								units: obj.units || 1
							}
						});
					} else {
						done();
					}
				});
			});
		},
		toLeo: (ID, opts = {}) => {
			opts = Object.assign({
				records: 10,
				size: 1024 * 200,
				time: {
					seconds: 3
				},
				debug: false
			}, opts || {});
			var records, size, correlations, timeout, timeTrigger;

			function reset() {
				records = [];
				size = 0;
				correlations = [];
				clearTimeout(timeout);
				timeout = null;
				timeTrigger = false;
			}
			reset();

			var retry = backoff.fibonacci({
				randomisationFactor: 0,
				initialDelay: 1,
				maxDelay: 1000
			});
			retry.failAfter(10);
			retry.success = function () {
				retry.reset();
				retry.emit("success");
			};
			retry.run = function (callback) {
				retry.once('fail', (err) => {
					callback(err || 'failed');
				}).once('success', () => {
					var c = correlations;
					reset();
					callback(null, {
						id: ID,
						correlations: c
					});
				});
				retry.backoff();
			};
			retry.on('ready', function (number, delay) {
				if (records.length === 0) {
					retry.success();
				} else {
					opts.debug && console.log("sending", records.length, number, delay);
					opts.debug && console.time("kiensis request");
					kinesis.putRecords({
						Records: records.map((r) => {
							return {
								Data: r,
								PartitionKey: ID
							};
						}),
						StreamName: configure.stream
					}, function (err, data) {
						if (err) {
							retry.backoff();
						} else if (data.FailedRecordCount && data.FailedRecordCount > 0) {
							var left = [];
							for (var i = 0; i < data.Records.length; i++) {
								var row = data.Records[i];
								if (row.ErrorCode) {
									left.push(records[i]);
								}
							}
							records = left;
							retry.backoff();
						} else {
							opts.debug && console.timeEnd("kiensis request");
							retry.success();
						}
					});
				}
			});

			return ls.pipeline(chunkEventStream(ls, null, {
				records: 10000,
				size: 1024 * 300,
				time: {
					seconds: 10
				},
				debug: false
			}), ls.through(function (obj, callback) {
				size += obj.gzipSize;
				records.push(obj.gzip);
				correlations.push(obj.correlations);
				delete obj.buffer;

				if (!timeout) { //make sure no event gets too old
					timeout = setTimeout(() => {
						timeTrigger = true;
					}, moment.duration(opts.time).asMilliseconds());
				}
				if (size > opts.size || timeTrigger || records.length > opts.records) {
					opts.debug && console.log(`kinesis emitting ${size>opts.size?'due to size':''} ${timeTrigger?'due to time':''} ${records.length>opts.records?'due to record count':''}  records:${records.length} size:${size}`);
					opts.debug && console.log("starting retry");
					retry.run(callback);
				} else {
					callback();
				}
			}, function flush(callback) {
				opts.debug && console.log(`kinesis emitting due to stream end records:${records.length} size:${size}`);
				retry.run(callback);
			}));
		},
		toCheckpoint: (opts = {}) => {
			opts = Object.assign({
				records: 1000,
				time: {
					seconds: 10
				},
				debug: false
			}, opts || {});

			var checkpoints = {};
			var shouldCheckpoint = false;

			var records = 0;

			var timeout = null;

			function doCheckpoint(callback) {
				records = 0;
				clearTimeout(timeout);
				timeout = null;
				shouldCheckpoint = false;
				opts.debug && console.log(JSON.stringify(checkpoints, null, 2));

				var tasks = [];
				for (var id in checkpoints) {
					var bot = checkpoints[id];
					for (var event in bot) {
						var checkpoint = bot[event];
						tasks.push((done) => {
							cron.checkpoint(id, event, checkpoint, done);
						});
					}
				}
				async.parallelLimit(tasks, 10, (err, results) => {
					checkpoints = {};
					callback(err);
				});
			}

			return ls.write((update, enc, callback) => {
				if (!timeout) {
					timeout = setTimeout(() => {
						shouldCheckpoint = true;
					}, moment.duration(opts.time).asMilliseconds());
				}

				var id = update.id;
				var correlations = update.correlations;
				if (!(id in checkpoints)) {
					checkpoints[id] = {

					};
				}
				var c = checkpoints[id];

				correlations.forEach((correlation) => {
					for (var event in correlation) {
						var u = correlation[event];
						if (!(event in c)) {
							c[event] = {
								eid: u.end,
								records: u.records,
								source_timestamp: u.source_timestamp,
								ended_timestamp: u.timestamp,
								started_timestamp: u.timestamp
							};
						} else {
							c[event].eid = u.end;
							c[event].records += u.records;
							c[event].source_timestamp = Math.min(c[event].source_timestamp, u.source_timestamp);
							c[event].ended_timestamp = Math.max(c[event].ended_timestamp, u.timestamp);
							c[event].started_timestamp = Math.max(c[event].started_timestamp, u.timestamp);
						}

						records += u.records;
					}
				});
				if (records >= opts.records) {
					shouldCheckpoint = true;
				}

				if (shouldCheckpoint) {
					doCheckpoint(callback);
					return false;
				}
				callback();
			}, function flush(callback) {
				doCheckpoint(() => {
					opts.debug && console.log("all checkpointed");
					callback();
				});
			});
		},
		fromLeo: (ID, queue, opts = {}) => {
			queue = refUtil.ref(queue).queue(opts.subqueue).id;
			if (!opts.stopTime && configure.registry && configure.registry.context) {
				opts.stopTime = moment.now() + (configure.registry.context.getRemainingTimeInMillis() * 0.8);
			}
			opts = Object.assign({
				buffer: 1000,
				loops: 100,
				start: null,
				limit: Number.POSITIVE_INFINITY,
				size: Number.POSITIVE_INFINITY,
				debug: false,
				stopTime: moment().add(240, "seconds")
			}, opts || {});

			var pass = new PassThrough({
				highWaterMark: opts.buffer,
				objectMode: true
			});
			var hasTime = true;

			let oldDestroy = pass.destroy;
			pass.destroy = function () {
				hasTime = false;
				oldDestroy && oldDestroy();
			};

			dynamodb.docClient.batchGet({
				RequestItems: {
					'Leo_cron': {
						Keys: [{
							id: ID
						}]
					},
					'Leo_event': {
						Keys: [{
							event: queue
						}]
					}
				}
			}, function (err, docs) {
				if (err) {
					throw err;
				} else if (docs.UnprocessedKeys !== undefined && Object.keys(docs.UnprocessedKeys).length > 0) {
					throw new Error("Not enough capacity to read");
				}

				var start = null;
				var leoEvent, leoCron;
				if (Object.keys(docs.UnprocessedKeys) >= 1) {
					pass.end();
					return;
				} else if (!docs.Responses || !docs.Responses.Leo_event || docs.Responses.Leo_event.length === 0) { //There are no events that are processable
					pass.end();
					return;
				} else {
					leoEvent = docs.Responses.Leo_event[0];
				}

				if (opts.start) {
					start = opts.start + " "; //we want it to start after this one
				} else if (docs.Responses && docs.Responses.Leo_cron && docs.Responses.Leo_cron[0]) { //There are no cron jobs, not possible to stream
					leoCron = docs.Responses.Leo_cron[0];

					if (leoCron.checkpoint) {
						start = leoCron.checkpoint;
					} else if (leoCron.checkpoints && leoCron.checkpoints.read && leoCron.checkpoints.read[queue]) {
						start = leoCron.checkpoints.read[queue].checkpoint;
					} else {
						start = "z/";
					}
				} else {
					start = "z/";
				}

				if (start === null) { //We will not run unless we got a start
					pass.end();
					return;
				}

				var count = 0;
				pass.throttledWrite = (obj, callback) => {
					count++;
					start = obj.eid + " "; //we want it to continue after this one
					if (!pass.write(obj)) {
						opts.debug && console.log("back pressure");
						pass.once('drain', () => {
							opts.debug && console.log("back pressure done");
							callback();
						});
					} else {
						callback();
					}
				};

				function max() {
					var max = arguments[0]
					for (var i = 1; i < arguments.length; ++i) {
						if (arguments[i] != null && arguments[i] != undefined) {
							max = max > arguments[i] ? max : arguments[i];
						}
					}
					return max;
				}

				let getEvents;
				if (leoEvent.v >= 2) {
					var max_eid = opts.maxOverride || leoEvent.max_eid;
					var table_name = "Leo_stream";
					var eid = "eid";
					var range_key = "end";

					getEvents = function (callback) {
						var params = {
							TableName: table_name,
							KeyConditionExpression: "#event = :event and #key between :start and :maxkey",
							ExpressionAttributeNames: {
								"#event": "event",
								"#key": range_key,
							},
							Limit: 50,
							ExpressionAttributeValues: {
								":event": queue,
								":maxkey": max_eid,
								":start": start
							},
							"ReturnConsumedCapacity": 'TOTAL'
						};
						opts.debug && console.log(params);
						dynamodb.docClient.query(params, function (err, data) {
							opts.debug && console.log("Consumed Capacity", data && data.ConsumedCapacity);
							if (err) {
								console.log(err)
								callback(err);
								return;
							}
							callback(null, data.Items)
						});
					};
				} else {
					var max_eid = max(leoEvent.kinesis_number, leoEvent.s3_kinesis_number, leoEvent.initial_kinesis_number, leoEvent.s3_new_kinesis_number);
					var table_name = "Leo";
					var eid = "kinesis_number";
					var range_key = "kinesis_number";

					getEvents = function (callback) {
						leo.getEvents(ID, queue, Object.assign({}, opts, {
							start: start
						}), (err, events, checkpoint) => {
							err && console.log(err);
							callback(err, events);
						});
					}
				}

				var hasMoreEvents = true;
				var hasLoops = opts.loops;
				var totalCount = 0;
				var totalSize = 0;

				if (max_eid.localeCompare(start) > 0) {
					async.whilst(() => {
							opts.debug && console.log("checking next loop, loops remaining ", hasLoops, ", Time Remaining:", opts.stopTime - moment.now());
							hasTime = hasTime && (opts.stopTime > moment.now());
							opts.debug && console.log(totalCount, opts.limit, totalSize, opts.size, hasTime, max_eid, start, max_eid.localeCompare(start));
							return totalCount < opts.limit && totalSize < opts.size && hasMoreEvents && hasTime && hasLoops && max_eid.localeCompare(start) > 0;
						}, (done) => {
							var count = 0;
							hasLoops--;
							getEvents(function (err, items) {
								opts.debug && console.log("found", items.length, "items");
								if (items.length == 0) {
									opts.debug && console.log("no more events");
									hasMoreEvents = false;
									done();
									return;
								}

								var counts = 0;
								var size = 0;
								async.eachOfSeries(items, (item, i, done) => {
										if (totalCount >= opts.limit || totalSize >= opts.size || !hasTime) {
											return done();
										}
										if (item.start) {
											var [prefix, idOffset] = item.start.split(/-/);
											idOffset = parseInt(idOffset);

										}

										function createEId(eid) {
											return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
										};
										if (item.s3) {
											if (item.end.localeCompare(start) > 0) { //Then it is greater than the event they were looking at
												//let's figure out where we should jump into this file.
												var fileOffset = null;
												var fileEnd = item.gzipSize;
												var recordOffset = 0;

												for (let i = 0; i < item.offsets.length; i++) {
													var offset = item.offsets[i];
													if (start.localeCompare(offset.end) < 0) {
														opts.debug && console.log(start, offset.start, offset.end);
														counts += offset.records; //is this right?
														size += offset.size; //this isn't exact when getting in the middle of a file, but close enough
														if (fileOffset == null) {
															fileOffset = offset.gzipOffset;
														}
														if (counts >= opts.limit || size >= opts.size) {
															fileEnd = offset.gzipOffset + offset.gzipSize - 1;
															break;
														}
													}
												}

												var file = item.s3;
												file.range = `bytes=${fileOffset}-${fileEnd}`;
												opts.debug && console.log(file.range);

												pump(ls.fromS3(file), zlib.createGunzip(), split((value) => {
													return {
														length: Buffer.byteLength(value),
														obj: JSON.parse(value)
													}
												}), ls.write((obj, enc, done) => {
													var e = obj.obj;
													totalSize += obj.length;
													e.eid = createEId(e.eid);
													if (e.eid.localeCompare(start) > 0 && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
														totalCount++;
														pass.throttledWrite(e, done);
													} else { //otherwise it means we had a number in the middle of a file
														opts.debug && console.log("skipping");
														done();
													}
												}), (err) => {
													if (err) {
														console.log(err);
														done(err);
													} else {
														done();
													}
												});
											} else {
												done();
											}
										} else if (!item.gzip || item.gzip == true) {
											item.eid = item.kinesis_number;
											delete item.kinesis_number;
											if (item.gzip) {
												item.payload = JSON.parse(zlib.gunzipSync(item.payload));
											} else if (typeof item.payload === "string") {
												item.payload = JSON.parse(item.payload);
											}

											if (item.eid.localeCompare(start) > 0 && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
												totalCount++;
												pass.throttledWrite(item, done);
											} else { //otherwise it means we had a number in the middle of a file
												opts.debug && console.log("skipping");
												done();
											}
										} else if (item.gzip) {
											var gzip = zlib.createGunzip();
											pump(gzip, split(JSON.parse), ls.write((e, enc, done) => {
												e.eid = createEId(e.eid);

												if (e.eid.localeCompare(start) > 0 && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
													totalCount++;
													pass.throttledWrite(e, done);
												} else { //otherwise it means we had a number in the middle of a file
													opts.debug && console.log("skipping");
													done();
												}
											}), (err) => {
												if (err) {
													console.log(err);
													done(err);
												} else {
													opts.debug && console.log("gzipped event read finished");
													done();
												}
											});
											gzip.end(item.gzip);
										}
									},
									function (err) {
										opts.debug && console.log("done with this loop", err || "");
										if (err) {
											pass.emit("error", err);
										} else {
											done();
										}
									});
							});
						},
						(err) => {
							opts.debug && console.log("Calling Pass.end")
							if (err) console.log(err);
							pass.end();
						});
				} else {
					opts.debug && console.log("no events");
					pass.end();
					return;
				}
			});

			return pass;
		},
		toLeoMass: (queue, opts) => {
			return ls.pipeline(leoS3(ls, queue, opts))

		},
		toDynamoDB: function (table, opts) {
			opts = Object.assign({
				records: 25,
				size: 1024 * 1024 * 2,
				time: {
					seconds: 2
				}
			}, opts || {});

			var records, size, timeout, timeTrigger;

			function reset() {
				records = [];
				size = 0;
				clearTimeout(timeout);
				timeout = null;
				timeTrigger = false;
			}
			reset();

			var retry = backoff.fibonacci({
				randomisationFactor: 0,
				initialDelay: 1,
				maxDelay: 1000
			});
			retry.failAfter(10);
			retry.success = function () {
				retry.reset();
				retry.emit("success");
			};
			retry.run = function (callback) {
				retry.once('fail', (err) => {
					callback(err || 'failed');
				}).once('success', () => {
					reset();
					callback();
				});
				retry.backoff();
			};
			retry.on('ready', function (number, delay) {
				if (records.length === 0) {
					retry.success();
				} else {
					console.log("sending", records.length, number, delay);
					console.time("dynamodb request");
					dynamodb.docClient.batchWrite({
							RequestItems: {
								[table]: records.map((r) => {
									return {
										PutRequest: {
											Item: r
										}
									};
								})
							},
							"ReturnConsumedCapacity": 'TOTAL'
						},
						function (err, data) {
							console.log(data);
							if (err) {
								console.log(`All ${records.length} records failed`, err);
								retry.backoff();
							} else if (table in data.UnprocessedItems && Object.keys(data.UnprocessedItems[table]).length !== 0) {
								records = data.UnprocessedItems[table];
								retry.backoff();
							} else {
								console.log("saved");
								retry.success();
							}
						});
				}
			});
			return ls.write(function (obj, enc, done) {
				size += obj.gzipSize;
				records.push(obj);
				// console.log(obj);

				if (!timeout) { //make sure no event gets too old
					timeout = setTimeout(() => {
						timeTrigger = true;
					}, moment.duration(opts.time).asMilliseconds());
				}
				if (size > opts.size || timeTrigger || records.length > opts.records) {
					opts.debug && console.log(`DynamoDB emitting ${size>opts.size?'due to size':''} ${timeTrigger?'due to time':''} ${records.length>opts.records?'due to record count':''}  records:${records.length} size:${size}`);
					opts.debug && console.log("starting retry");
					retry.run(done);
				} else {
					done();
				}
			}, function flush(done) {
				console.log(`DynamoDB emitting due to stream end records:${records.length} size:${size}`);
				retry.run(done);
			});
		},
		batch: function (opts) {
			if (typeof opts === "number") {
				opts = {
					count: opts
				};
			}
			opts = Object.assign({
				count: undefined,
				bytes: undefined,
				time: undefined
			}, opts);

			var size = 0;
			var buffer = [];
			var timeTrigger = false;
			var timeout;

			opts.debug && console.log("Batch Options", opts);

			var stream = ls.through(function (obj, callback) {

				if (typeof obj === "string") {
					size += Buffer.byteLength(obj);
				}
				// TODO: add size if it is an object

				buffer.push(obj);

				if (false && !timeout && opts.time) { //make sure no event gets too old
					timeout = setTimeout(() => {
						timeTrigger = true;
						clearTimeout(timeout);
						timeout = null;
						if (buffer.length) {
							this.push({
								payload: buffer.splice(0),
								bytes: size
							});
							size = 0;
						}
					}, moment.duration(opts.time).asMilliseconds());
				}

				if ((opts.bytes && size >= opts.bytes) || (opts.count && buffer.length >= opts.count) || (!opts.bytes && !opts.count)) {
					opts.debug && console.log("Batch", buffer.length, opts.count, size, opts.bytes)
					this.push({
						payload: buffer.splice(0),
						bytes: size
					});
					size = 0;
				}
				callback();
			}, function flush(callback) {
				opts.debug && console.log("Batch On Flush");
				clearTimeout(timeout);
				timeout = null;
				if (buffer.length) {
					this.push({
						payload: buffer.splice(0),
						bytes: size
					});
					size = 0;
				}
				callback();
			});
			stream.options = opts;
			return stream;
		}
	};

	return ls;
}