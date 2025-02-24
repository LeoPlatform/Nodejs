"use strict";
const path = require("path");
const fs = require("fs");
var pump = require("pump");
var split = require("split2");
var zlib = require("zlib");
var write = require("flush-write-stream");

const { Kinesis } = require("@aws-sdk/client-kinesis");
const { Firehose } = require("@aws-sdk/client-firehose");
const { S3 } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { NodeHttpHandler } = require('@smithy/node-http-handler');

var https = require("https");
var PassThrough = require('stream').PassThrough;
var moment = require("moment");
var async = require("async");

var backoff = require("backoff");
var extend = require("extend");
const merge = require("lodash.merge");

var leoS3 = require("./helper/leos3.js");
var chunkEventStream = require("./helper/chunkEventStream.js");
var cronlib = require("../cron.js");
var dynamo = require("../dynamodb.js");
var refUtil = require("../reference.js");
var _streams = require("../streams");

const parserUtil = require("./helper/parser-util");
const logger = require("leo-logger")("leo-stream");
const es = require('event-stream');
const { addReadHooks } = require("./helper/leo-stream-helper");
const twoHundredK = 1024 * 200;

const FIVE_MB_IN_BYTES = 1024 * 1024 * 5;

module.exports = function(configure) {
	configure = configure || {};
	if (!configure.validate) {
		configure.validate = () => {
			throw new Error("Invalid Settings: Missing config");
		};
	}
	configure.onUpdate((newConfigure) => {
		console.log("leo-stream.js config changed");
		[kinesis, firehose, s3].map(service => service.config.update({
			region: newConfigure.aws.region,
			credentials: newConfigure.credentials
		}));
	});

	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});
	var leo = configure.leo;

	var CRON_TABLE = configure.resources.LeoCron;
	var EVENT_TABLE = configure.resources.LeoEvent;

	let awsResourceConfig = configure.awsResourceConfig || {};

	[awsResourceConfig.s3Config, awsResourceConfig.kinesisConfig, awsResourceConfig.dynamodbConfig, awsResourceConfig.firehoseConfig].forEach((config, index) => {
		if (config != null) {
			if (config.httpOptions && !config.requestHandler) {
				let httpOptions = config.httpOptions;
				delete config.httpOptions;
				Object.entries({
					"connectTimeout": "connectionTimeout",
					"timeout": "requestTimeout",
					"agent": "httpsAgent"
				}).forEach(([key, target]) => {
					if (httpOptions[key] != null && httpOptions[target] == null) {
						httpOptions[target] = httpOptions[key];
						delete httpOptions[key];
					}
				});

				// Add keepAlive to S3 (index 0) if it doesn't exist
				if (index === 0 && httpOptions.httpsAgent == null) {
					httpOptions.httpsAgent = new https.Agent({
						keepAlive: true
					});
				}
				config.requestHandler = new NodeHttpHandler(httpOptions);
			}
			if (config.maxRetries != null) {
				config.maxAttempts = config.maxRetries + 1;
			}
		}
	});

	var kinesis = new Kinesis({
		region: configure.aws.region,
		credentials: configure.credentials,
		...awsResourceConfig.kinesisConfig
	});
	var dynamodb = new dynamo(configure, awsResourceConfig.dynamodbConfig);
	var firehose = new Firehose({
		region: configure.aws.region,
		credentials: configure.credentials,
		...awsResourceConfig.firehoseConfig
	});


	// Allow httpOptions to be set while not specifying every default field
	let tmpS3Config = {
		...awsResourceConfig.s3Config
	};
	var s3 = new S3({
		apiVersion: '2006-03-01',
		region: configure.aws.region,
		requestHandler: new NodeHttpHandler({
			httpsAgent: new https.Agent({
				keepAlive: true
			})
		}),
		credentials: configure.credentials,
		...tmpS3Config
	});

	let sdkId = "-" + Math.floor(Math.random() * 10000).toString();
	let sdkTimeIndex = 1;
	var cron = cronlib(configure);
	var pad = "0000000";
	var padLength = -1 * pad.length;
	var ls = {
		tmpDir: process.env.RSTREAMS_TMP_DIR || "/tmp/rstreams",
		kinesis: kinesis,
		firehose: firehose,
		eventIdFromTimestamp: _streams.eventIdFromTimestamp,
		eventIdToTimestamp: _streams.eventIdToTimestamp,
		eventstream: es,
		s3: s3,
		dynamodb: dynamodb,
		cron: cron,
		configuration: configure,
		through: _streams.through,
		throughAsync: _streams.throughAsync,
		passThrough: PassThrough,
		write: _streams.writeWrapped,
		cmd: _streams.cmd,
		pipeline: _streams.pipeline,
		split: _streams.split,
		gzip: _streams.gzip,
		gunzip: _streams.gunzip,
		pipe: _streams.pipe,
		pipeAsync: _streams.pipeAsync,
		stringify: _streams.stringify,
		parse: _streams.parse,
		fromCSV: _streams.fromCSV,
		toCSV: _streams.toCSV,
		toGzipChunks: function(event, opts) {
			return chunkEventStream(this, event, opts);
		},
		toS3GzipChunks: function(event, opts, onFlush) {
			return leoS3(this, event, configure, opts, onFlush);
		},
		toS3: (Bucket, File) => {
			let pass = new PassThrough();
			let toS3Stream;

			// call Upload.done() to start it read from the stream
			// Only 1 catch will be called so capture any errors for later
			let uploadDonePromiseError;
			let emittedError = false;
			const uploadDonePromise = new Upload({
				client: s3,
				params: {
					Bucket: Bucket,
					Key: File,
					Body: pass,
				}
			}).done().catch(err => {
				uploadDonePromiseError = err;
				if (toS3Stream) {
					emittedError = true;
					toS3Stream.emit("error", uploadDonePromiseError);
				}
			});

			toS3Stream = write((s, enc, done) => {
				if (!pass.write(s)) {
					pass.once('drain', () => {
						done();
					});
				} else {
					done();
				}
			}, (callback) => {
				if (!emittedError) {
					pass.end(() => {
						uploadDonePromise.finally(() => callback(uploadDonePromiseError));
					});
				} else {
					callback(uploadDonePromiseError);
				}
			});
			return toS3Stream;
		},
		fromS3: (file, opts) => {
			let pass = new PassThrough();

			(async () => {
				let obj = await s3.getObject({
					Bucket: file.bucket || file.Bucket,
					Key: file.key || file.Key,
					Range: file.range || undefined
				});
				let stream = obj.Body;
				stream.destroy = stream.destroy || stream.close || (() => {
					obj.abort();
				});
				// [
				// 	"httpHeaders",
				// 	"httpUploadProgress",
				// 	"httpDownloadProgress"
				// ].map(event => {
				// 	obj.Body.on(event, (...args) => {
				// 		stream.emit(event, ...args);
				// 	});
				// });
				stream.on("error", async (err) => {
					let passAlong = true;
					if (err.code === "NoSuchKey" || err.name === "NoSuchKey") {
						try {
							await ls.tryFinalizeMultipartUpload(file);
							passAlong = false;
							stream.unpipe(pass);
							let newStream = (await s3.getObject({
								Bucket: file.bucket || file.Bucket,
								Key: file.key || file.Key,
								Range: file.range || undefined
							})).Body;
							newStream.on("error", err => pass.emit("error", err));
							ls.pipe(newStream, pass);
						} catch (err) {
							console.error("Error Looking for partial Multipart Upload", err);
						}
					}
					if (passAlong) {
						pass.emit("error", err);
					}
				});
				stream.pipe(pass);
			})();
			return pass;
		},
		fromS3_old: (file, opts) => {
			let pass = PassThrough();
			let obj = s3.getObject({
				Bucket: file.bucket || file.Bucket,
				Key: file.key || file.Key,
				Range: file.range || undefined
			});
			let stream = obj.createReadStream();
			stream.destroy = stream.destroy || stream.close || (() => {
				obj.abort();
			});
			[
				"httpHeaders",
				"httpUploadProgress",
				"httpDownloadProgress"
			].map(event => {
				obj.on(event, (...args) => {
					//console.log("Event:", event);
					stream.emit(event, ...args);
				});
			});
			stream.on("error", async (err) => {
				let passAlong = true;
				if (err.code === "NoSuchKey" || err.name === "NoSuchKey") {
					try {
						await ls.tryFinalizeMultipartUpload(file);
						passAlong = false;
						stream.unpipe(pass);
						let newStream = s3.getObject({
							Bucket: file.bucket || file.Bucket,
							Key: file.key || file.Key,
							Range: file.range || undefined
						}).createReadStream();
						newStream.on("error", err => pass.emit("error", err));
						ls.pipe(newStream, pass);
					} catch (err) {
						logger.error("Error Looking for partial Multipart Upload", err);
					}
				}
				if (passAlong) {
					pass.emit("error", err);
				}
			});
			stream.pipe(pass);
			return pass;
		},
		tryFinalizeMultipartUpload: async (file) => {
			logger.debug("MultipartUpload Start", file);
			let bucket = file.bucket || file.Bucket;
			let key = file.key || file.Key;
			let mpResponse = await s3.listMultipartUploads({
				Bucket: bucket,
				Prefix: key
			});
			if (mpResponse.Uploads.length) {
				let file = mpResponse.Uploads[0];
				let allParts = await s3.listParts({
					Bucket: bucket,
					Key: file.Key,
					UploadId: file.UploadId
				});
				let parts = allParts.Parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber }));
				if (parts.length > 0) {
					let params = {
						Bucket: bucket,
						Key: file.Key,
						UploadId: file.UploadId,
						MultipartUpload: {
							Parts: parts
						}
					};
					console.log("MultipartUpload params:", params);
					await s3.completeMultipartUpload(params);
					logger.log(`MultipartUpload Complete:`, bucket, file.Key, file.UploadId);
				}
			}
		},
		asEvent: _streams.asEvent,
		log: _streams.log,
		logSourceRead: function(id, inSystem, recordCount, opts, callback) {
			var types = {};

			[].slice.call(arguments).forEach(a => {
				var b = types[typeof (a)];
				if (!b) {
					b = types[typeof (a)] = [];
				}
				b.push(a);
			});

			/*
				id - the first string argument if there are 2 or more strings, otherwise it comes from config.registry.id
				inSystem - the second string argument if there are 2 or more strings, otherwise it is the first string
				callback - the first function argument
				opts - the  first object argument, otherwise {}
				recordCount - the first number, otherwise 0
			*/
			callback = types.function && types.function[0];
			opts = types.object && types.object[0] || {};
			id = types.string && types.string.length >= 2 && types.string[0] || configure.registry.id;
			inSystem = types.string && (types.string.length == 1 ? types.string[0] : types.string[1]);
			recordCount = types.number && types.number[0] || 0;
			opts = opts || {};

			inSystem = refUtil.ref(inSystem, "system").asQueue(opts.subqueue).id;
			id = refUtil.botRef(id).id;

			cron.checkpoint(id, inSystem, {
				eid: moment.now(),
				records: recordCount,
				started_timestamp: opts.timestamp,
				timestamp: opts.timestamp || moment.now(),
				source_timestamp: opts.source_timestamp || opts.event_source_timestamp || moment.now()
			}, function(err, data) {
				logger.error("logSourceRead.checkpoint", err, data);
				if (callback) callback();
			});
		},
		logTargetWrite: function(id, outSystem, recordCount, opts, callback) {
			logger.info(id, outSystem);
			id = refUtil.botRef(id).id;
			outSystem = refUtil.ref(outSystem, "system").asQueue(opts.subqueue).id;
			if (typeof opts == "function") {
				callback = opts;
				opts = {};
			}
			opts = opts || {};
			ls.putEvent(id, outSystem, {
				records: recordCount
			}, {
				metadata: {
					units: recordCount
				}
			}, callback);
		},
		devnull: _streams.devnull,
		counter: _streams.counter,
		load: function(id, outQueue, opts) {
			configure.validate();
			opts = Object.assign({
				useS3: false,
				autoDetectPayload: true,
				autoCheckpoint: true
			}, opts || {});
			var args = [];

			args.push(ls.through((obj, done) => {
				var e;
				if (opts.autoDetectPayload && (obj.payload || obj.correlation_id)) {
					e = obj;
				} else {
					e = {
						payload: obj
					};
				}
				e.id = e.id || id;
				e.event = e.event || outQueue;
				if (!e.event_source_timestamp) {
					e.event_source_timestamp = moment.now();
				}
				if (!e.timestamp) {
					e.timestamp = moment.now();
				}
				done(null, e);
			}));
			if (opts.useS3) {
				args.push(leoS3(ls, outQueue, configure, { prefix: opts.prefix || id, ...opts.s3Opts }));
			} else if (!opts.firehose) {
				// TODO: This should be part of auto switch
				args.push(ls.throughAsync(async (obj, push) => {
					let size = Buffer.byteLength(JSON.stringify(obj));
					if (size > twoHundredK * 3) {
						logger.info('Sending event to S3 because it exceeds the max size for DDB. ', size);
						await ls.pipeAsync(
							es.readArray([obj]),
							leoS3(ls, outQueue, configure, { prefix: opts.prefix || id }),
							ls.write((newobj, done) => {
								push(newobj);
								done();
							})
						);
					} else {
						push(obj);
					}
				}));
			}

			args.push(ls.toLeo(id, opts));
			// else {
			// 	args.push(ls.autoSwitch(outQueue, opts))
			// }
			if (opts.autoCheckpoint !== false) {
				args.push(ls.toCheckpoint({
					debug: opts.debug,
					force: opts.force,
					onCheckpoint: opts.onCheckpoint
				}));
			} else {
				args.push(ls.write({
					hasCommands: false,
					commands: {
						ignoreCommands: ["checkpoint"]
					}
				}, (_event, done) => done()));
			}

			return ls.pipeline.apply(ls, args);
		},
		enrich: function(opts, callback) {
			configure.validate();
			var id = opts.id;
			var inQueue = opts.inQueue;
			var outQueue = opts.outQueue;
			var func = opts.transform || opts.each;
			let config = opts.config || {};

			config.start = config.start || opts.start;
			config.debug = opts.debug;

			var args = [];
			args.push(ls.fromLeo(id, inQueue, config));

			if (opts.batch) {
				args.push(ls.batch(opts.batch));
			}

			args.push(ls.process(id, func, outQueue));
			if (opts.useS3) {
				args.push(leoS3(ls, outQueue, configure, { prefix: id }));
			}
			args.push(ls.toLeo(id, opts));
			args.push(ls.toCheckpoint({
				debug: opts.debug,
				force: opts.force,
				onCheckpoint: opts.onCheckpoint
			}));
			args.push(callback);
			return ls.pipe.apply(ls, args);
		},
		offload: function(opts, callback) {
			configure.validate();
			var id = opts.id;
			var inQueue = opts.inQueue || opts.queue;
			var func = opts.each || opts.transform;
			var batch = {
				size: 1,
				map: (payload, meta, done) => done(null, payload)
			};

			if (typeof opts.size != "object" && (opts.count || opts.records || opts.units || opts.time || opts.bytes)) {
				opts.size = {};
				opts.size.count = opts.count || opts.records || opts.units;
				opts.size.time = opts.time;
				opts.size.bytes = opts.size || opts.bytes;
				opts.size.highWaterMark = opts.highWaterMark || 2;

			}

			if (!opts.batch || typeof opts.batch === "number") {
				batch.size = opts.batch || batch.size;
			} else {
				batch.size = opts.batch.size || ((opts.batch.count || opts.batch.bytes || opts.batch.time || opts.batch.highWaterMark) && opts.batch) || batch.size;
				batch.map = opts.batch.map || batch.map;
			}
			if (typeof batch.size != "object") {
				batch.size = {
					count: batch.size
				};
			}
			batch.size.highWaterMark = batch.size.highWaterMark || 2;

			var batchSize = typeof batch.size === "number" ? batch.size : (batch.size.count || batch.size.records);
			return ls.pipe(
				ls.fromLeo(id, inQueue, opts),
				ls.through((obj, done) => {
					batch.map(obj.payload, obj, (err, r, rOpts) => {
						rOpts = rOpts || {};
						if (err || !r) {
							done(err);
						} else {
							obj.payload = r;
							done(null, obj);
						}
					});
				}),
				ls.batch(batch.size),
				ls.through({
					highWaterMark: 1
				}, (batch, done) => {
					batch.units = batch.payload.length;
					let last = batch.payload[batch.units - 1];
					if (batchSize == 1) {
						done(null, last);
					} else {
						batch.event_source_timestamp = last.event_source_timestamp;
						batch.event = last.event;
						batch.eid = last.eid;
						done(null, batch);
					}
				}),
				ls.process(id, func, null, undefined, {
					highWaterMark: 1
				}),
				ls.toCheckpoint({
					debug: opts.debug,
					force: opts.force,
					onCheckpoint: opts.onCheckpoint
				}), callback);
		},
		process: function(id, func, outQueue, onflush, opts = {}) {
			var firstEvent;
			var lastEvent;
			var units;
			opts = Object.assign({}, opts || {});

			if (typeof outQueue == "function") {
				onflush = outQueue;
				outQueue = undefined;
			}
			if (onflush) {
				let flush = onflush;
				onflush = function(done) {
					let context = {
						push: (r, rOpts) => {
							rOpts = rOpts || {};
							if (typeof rOpts == "string") {
								rOpts = {
									queue: rOpts
								};
							}
							if (r === true || r) {
								this.push({
									id: id,
									event: rOpts.queue || outQueue,
									payload: r === true ? undefined : r,
									event_source_timestamp: rOpts.event_source_timestamp || lastEvent.event_source_timestamp,
									correlation_id: {
										source: rOpts.event || lastEvent.event,
										[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || lastEvent.eid,
										units: rOpts.units || lastEvent.units || 1
									}
								});
							}
						}
					};
					flush.call(context, (err, r, rOpts) => {
						rOpts = rOpts || {};
						if (typeof rOpts == "string") {
							rOpts = {
								queue: rOpts
							};
						}
						if (err) {
							done(err);
						} else {
							context.push(r, rOpts);
							done();
						}
					});
				};
			}

			function reset() {
				firstEvent = null;
				units = 0;
			}
			reset();

			return ls.through({
				highWaterMark: opts.highWaterMark
			}, function(obj, done) {
				if (!firstEvent) {
					firstEvent = obj;
				}
				lastEvent = obj;
				units += obj.units || 1;
				let context = {
					push: (r, rOpts) => {
						rOpts = rOpts || {};
						if (typeof rOpts == "string") {
							rOpts = {
								queue: rOpts
							};
						}
						if (r === true) { //then we handled it, though it didn't create an object
							this.push({
								id: id,
								event_source_timestamp: rOpts.event_source_timestamp || obj.event_source_timestamp,
								eid: rOpts.eid || obj.eid,
								correlation_id: {
									source: obj.event,
									[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || obj.eid,
									units: rOpts.units || obj.units || 1
								}
							});
						} else if (r) { //then we are actually writing an object
							this.push({
								id: id,
								event: rOpts.queue || outQueue,
								payload: r,
								event_source_timestamp: rOpts.event_source_timestamp || obj.event_source_timestamp,
								eid: rOpts.eid || obj.eid,
								correlation_id: {
									source: obj.event,
									[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || obj.eid,
									units: rOpts.units || obj.units || 1
								}
							});
						}
					}
				};

				/**calledDone is so that we support the common pattern of i
				 * if(condition) {
				 *   return done();
				 *}
				 **/
				let calledDone = false;
				let result = func.call(context, obj.payload, obj, (err, r, rOpts) => {
					calledDone = true;
					rOpts = rOpts || {};
					if (typeof rOpts == "string") {
						rOpts = {
							queue: rOpts
						};
					}
					if (err) {
						done(err);
					} else if (r === true) { //then we handled it, though it didn't create an object
						done(null, {
							id: id,
							event_source_timestamp: rOpts.event_source_timestamp || obj.event_source_timestamp,
							eid: rOpts.eid || obj.eid,
							correlation_id: {
								source: obj.event,
								[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || obj.eid,
								units: rOpts.units || obj.units || 1
							}
						});
					} else if (r) { //then we are actually writing an object
						done(null, {
							id: id,
							event: rOpts.queue || outQueue,
							payload: r,
							event_source_timestamp: rOpts.event_source_timestamp || obj.event_source_timestamp,
							eid: rOpts.eid || obj.eid,
							correlation_id: {
								source: obj.event,
								[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || obj.eid,
								units: rOpts.units || obj.units || 1
							}
						});
					} else {
						done();
					}
				});
				//They did a promise
				if (result && result.then) {
					result.then((r) => {
						let rOpts = {};
						if (
							r != null &&
							typeof r === "object" &&
							r.options != null &&
							r.data != null &&
							Object.keys(r).length == 2) {
							rOpts = r.options;
							r = r.data;
						}

						let extra = {};

						let units = obj.units || 1;
						if (r === false) {
							done();
							return;
						} else if (r != null && typeof r == "object") {
							extra.event = rOpts.queue || outQueue;
							if (Array.isArray(r)) {
								r.slice(0, -1).forEach(data => {
									// TODO: Account for custom correlation_id start/end
									context.push(data, { partial: true });
								});

								// TODO: Account for true/false in array 
								// TODO: Account for custom correlation_id start/end
								extra.payload = r[r.length - 1];
								units = 1;
							} else {
								extra.payload = r;
							}
							if (extra.payload == null) {
								extra = {};
							}

						}

						done(null, {
							...extra,
							id: id,
							event_source_timestamp: rOpts.event_source_timestamp || obj.event_source_timestamp,
							eid: rOpts.eid || obj.eid,
							correlation_id: {
								source: obj.event,
								[rOpts.partial === true ? 'partial_start' : 'start']: rOpts.eid || obj.eid,
								units: rOpts.units || units
							}
						});
					}).catch(done);
				} else if (!calledDone && result) {
					done(null, {
						id: id,
						event: outQueue,
						payload: result,
						event_source_timestamp: obj.event_source_timestamp,
						eid: obj.eid,
						correlation_id: {
							source: obj.event,
							start: obj.eid,
							units: obj.units || 1
						}
					});
				}
			}, onflush);
		},
		toLeo: (ID, opts) => {
			opts = opts || {};
			let defaults = {
				s3: {
					records: 1,
					useS3: true,
					time: {
						milliseconds: 1000 * 10
					},
					chunk: {
						label: "chunk",
						useS3: true
					}
				},
				firehose: {
					records: 10000,
					size: 1024 * 900,
					useS3: false,
					time: {
						milliseconds: 1000
					}
				},
				kinesis: {
					records: 100,
					size: 1024 * 200,
					time: {
						milliseconds: 200
					}
				}
			};
			let loggerTimeId = sdkId + (sdkTimeIndex++).toString();
			var type = "kinesis";
			if (opts.useS3) {
				type = "s3";
			} else if (opts.firehose) {
				type = "firehose";
			}
			opts = Object.assign({
				label: "toLeo",
				debug: true,
				enableLogging: true,
				chunk: {
					label: "chunk"
				},
				checkpoint: false
			}, defaults[type], opts || {});

			var records, correlations;

			function reset() {
				records = [];
				correlations = [];
			}
			reset();

			var retry = backoff.fibonacci({
				randomisationFactor: 0,
				initialDelay: 10,
				maxDelay: 1000,
				...opts.backoff
			});
			retry.failAfter(10);
			retry.success = function() {
				retry.reset();
				retry.emit("success");
			};
			retry.run = function(callback) {
				let fail = (err) => {
					currentQueues.clear();
					retry.removeListener('success', success);
					callback(err || 'failed');
				};
				let success = () => {
					currentQueues.clear();
					retry.removeListener('fail', fail);
					var c = correlations;
					reset();
					p.emit("flushed", {
						id: ID,
						correlations: c
					});
					callback(null, {
						__cmd: "checkpoint",
						id: ID,
						correlations: c
					});
				};

				retry.once('fail', fail).once('success', success);
				retry.backoff();
			};
			retry.on('ready', function(number, delay) {
				if (records.length === 0) {
					retry.success();
				} else if (opts.firehose) {
					if (opts.useQueuePartition) {
						logger.error(`Stream using Firehose with 'useQueuePartition' enabled. May cause processing issues.`);
					}
					logger.debug("sending", records.length, number, delay);

					logger.time("firehose request" + loggerTimeId);
					firehose.putRecordBatch({
						Records: [{
							Data: Buffer.from(opts.gzipFirehose ? (records.map(r => r.toString("base64")).join('\n') + '\n') : records.join(''))
						}],
						DeliveryStreamName: configure.bus.firehose
					}, function(err, data) {
						logger.debug(process.memoryUsage());
						if (err) {
							logger.error("toLeo.firehose.putRecordBatch", err);
							retry.backoff();
						} else if (data.FailedPutCount && data.FailedPutCount > 0) {
							var left = [];
							for (var i = 0; i < data.RequestResponses.length; i++) {
								var row = data.RequestResponses[i];
								if (row.ErrorCode) {
									left.push(records[i]);
								}
							}
							logger.info(`Count failed firehose put record batch (failed, retry):(${data.FailedPutCount},${left.length})`);
							records = left;
							retry.backoff();
						} else {
							logger.timeEnd("firehose request" + loggerTimeId);
							retry.success();
						}
					});

				} else {
					logger.debug("sending", records.length, number, delay);
					logger.time("kinesis request" + loggerTimeId);
					let partitionKey = "0";
					let explicitHashKey = (opts.partitionHashKey || 0).toString();
					if (opts.useQueuePartition && currentQueues.size > 0) {

						let currentQueuesAsArray = Array.from(currentQueues);
						let queue = currentQueuesAsArray[0];

						if (currentQueuesAsArray.length > 1) {
							logger.error(`Stream with multiple queues with 'useQueuePartition' enabled. Using '${queue}' for partition. May cause processing issues. All queues [${currentQueuesAsArray.join(", ")}]`);
						}

						partitionKey = queue != null ? queue : "0";
						explicitHashKey = undefined;
					}
					kinesis.putRecords({
						Records: records.map((r) => {
							return {
								Data: r,
								PartitionKey: partitionKey,
								ExplicitHashKey: explicitHashKey
							};
						}),
						StreamName: configure.stream
					}, function(err, data) {
						if (err) {
							logger.error("toLeo.kinesis.putRecords", err);
							retry.backoff();
						} else if (data.FailedRecordCount && data.FailedRecordCount > 0) {
							var left = [];
							for (var i = 0; i < data.Records.length; i++) {
								var row = data.Records[i];
								if (row.ErrorCode) {
									left.push(records[i]);
								}
							}
							logger.info(`Count failed kinesis put records (failed, retry):(${data.FailedRecordCount},${left.length})`);
							records = left;
							retry.backoff();
						} else {
							logger.timeEnd("kinesis request" + loggerTimeId);
							retry.success();
						}
					});
				}
			});

			var chunkOpts = Object.assign({
				records: 100,
				size: 1024 * 200,
				time: {
					milliseconds: 200
				},
				debug: false,
				enableLogging: true,
				snapshot: opts.snapshot
			}, opts.chunk || {});
			chunkOpts.gzip = opts.gzipFirehose || !opts.firehose;

			let currentQueues = new Set();
			var p = ls.buffer(opts, function(obj, callback) {
				if (obj.stats) {
					Object.values(obj.stats).map(v => {
						let queues = v.queues || {};
						// We don't want queues to continue past here, so remove it
						delete v.queues;
						return Object.keys(queues);
					}).reduce((a, b) => a.concat(b), []).forEach(q => currentQueues.add(q));

				}
				if (obj.records > 0) {
					if (obj.gzip) {
						records.push(obj.gzip);
					} else if (obj.s3) {
						let data = JSON.stringify(obj) + "\n";
						if (chunkOpts.gzip) {
							records.push(zlib.gzipSync(data));
						} else {
							records.push(data);
						}
					}
				}
				if (obj.correlations) {
					if (Array.isArray(obj.correlations)) {
						correlations = correlations.concat(obj.correlations);
					} else {
						correlations.push(obj.correlations);
					}
				}
				delete obj.buffer;
				callback(null, (obj.gzip || obj.s3) && {
					records: 1,
					size: obj.gzipSize
				});
			}, retry.run, function flush(callback) {
				logger.info("toLeo On Flush");
				callback();
			});

			let streams = [];
			// streams.push(ls.through((event, done) => {
			// 	// Put the payload at the end to enable faster parsing
			// 	let payload = event.payload;
			// 	delete event.payload;
			// 	event.payload = payload;
			// 	done(null, event);
			// }));
			if (!opts.useS3) {
				streams.push(ls.throughAsync(async (obj, push) => {
					let size = Buffer.byteLength(JSON.stringify(obj));
					if (size > twoHundredK * 3) {
						logger.info('Sending event to S3 because it exceeds the max size for DDB. ', size);
						await ls.pipeAsync(
							es.readArray([obj]),
							leoS3(ls, obj.event, configure, { prefix: opts.prefix || obj.id }),
							ls.write((newobj, done) => {
								push(newobj);
								done();
							})
						);
					} else {
						push(obj);
					}
				}));
			}
			streams.push(chunkEventStream(ls, null, chunkOpts));
			streams.push(p);
			if (opts.checkpoint) {
				// streams.push(ls.cmd({
				// 	onCheckpoint: (obj, done) => {
				// 		console.log(obj);
				// 		done(null, obj);
				// 	}
				// }));
			}
			return ls.pipeline.apply(ls, streams);
		},
		toManualCheckpoint: (id, opts) => {
			var cp = ls.toCheckpoint(Object.assign({
				records: Number.POSITIVE_INFINITY,
				time: {
					days: 20
				},
				size: Number.POSITIVE_INFINITY
			}, opts));
			var pass = ls.pipeline(
				ls.process(id, (a, e, d) => d(null, true), null),
				ls.through((obj, done) => {
					var result = cp.write(obj);
					if (!result) {
						cp.once("drain", () => {
							done();
						});
					} else {
						done();
					}
					return;
				}));

			pass.finish = (cb) => cp.end(cb);
			pass.flush = (cb) => cp.flush(cb);
			pass.get = (bot, queue) => cp.get(bot, queue);
			return pass;
		},
		stats: (id, event, opts) => {
			let newStats = () => {
				return {
					eid: null,
					units: 0,
					source_timestamp: null,
					started_timestamp: null,
					ended_timestamp: null
				};
			};
			let stats = newStats();
			let stream = ls.through((event, done) => {
				let timestamp = Date.now();
				let start = (event.event_source_timestamp || timestamp);

				stats.source_timestamp = stats.source_timestamp ? Math.min(start, stats.source_timestamp) : start;
				stats.started_timestamp = stats.started_timestamp ? Math.max(timestamp, stats.started_timestamp) : timestamp;
				stats.ended_timestamp = stats.ended_timestamp ? Math.max(timestamp, stats.ended_timestamp) : timestamp;
				stats.eid = event.eid;
				stats.units += event.units || 1;
				stats.start_eid = stats.start_eid || event.eid;
				done(null, event);
			});

			stream.checkpoint = function(params, done) {
				if (typeof params === "function") {
					done = params;
					params = {};
				}
				let data = Object.assign(stats, params);
				logger.debug("Stats", data);
				if (id && event && data.units > 0) {
					cron.checkpoint(id, event, data, (err) => {
						err && console.log("Stats error:", err);
						stats = newStats();
						done(err, data);
					});
				} else {
					done(null, data);
				}
			};
			stream.checkpoint.stream = ls.through((o, d) => d(null, o), (done) => {
				stream.checkpoint(opts || {}, done);
			});
			stream.get = function() {
				return stats;
			};
			return stream;
		},
		checkpoint: (opts, stream) => {
			opts = Object.assign({
				records: 1000,
				time: {
					seconds: 10
				},
				debug: false
			}, opts || {});

			let newStats = () => {
				return {};
			};

			let getStats = (botId, queue) => {
				botId = refUtil.botRefId(botId);
				queue = refUtil.refId(queue);
				if (!(botId in stats)) {
					stats[botId] = {};
				}
				if (!(queue in stats[botId])) {
					stats[botId][queue] = {
						eid: null,
						units: 0,
						source_timestamp: null,
						started_timestamp: null,
						ended_timestamp: null
					};
				}

				return stats[botId][queue];
			};
			let stats = newStats();

			if (stream == null) {
				stream = ls.through(function(event, done) {
					done(null, event);
				});
			}

			stream.visit = (event, done) => {
				let timestamp = event.timestamp || Date.now();
				let start = (event.event_source_timestamp || timestamp);

				let stat = getStats(event.id, event.event);

				stat.source_timestamp = stat.source_timestamp ? Math.min(start, stat.source_timestamp) : start;
				stat.started_timestamp = stat.started_timestamp ? Math.max(timestamp, stat.started_timestamp) : timestamp;
				stat.ended_timestamp = stat.ended_timestamp ? Math.max(timestamp, stat.ended_timestamp) : timestamp;
				stat.eid = event.eid;
				stat.units += event.units || 1;
				stat.start_eid = stat.start_eid || event.eid;

				if (done) {
					done(null, event);
				}
			};

			stream.checkpoint = function(params, done) {
				if (typeof params === "function") {
					done = params;
					params = {};
				}

				logger.debug("Stats", stats);

				var tasks = [];
				for (var id in stats) {
					var bot = stats[id];
					for (var queue in bot) {
						let checkpoint = Object.assign(bot[queue], params);
						if (checkpoint.units > 0) {
							tasks.push((done) => {
								//cron.checkpoint(id, queue, checkpoint, done);
								console.log("Did checkpoint", id, queue, checkpoint);
								done();
							});
						}
					}
				}
				async.parallelLimit(tasks, 10, (err, results) => {
					err && console.log("Stats error:", err);
					stats = newStats();
					done(err);
				});
			};
			stream.checkpoint.stream = ls.through((o, d) => d(null, o), (done) => {
				stream.checkpoint(opts || {}, done);
			});
			stream.on("checkpoint", (opts) => {
				stream.checkpoint(opts || {}, () => { });
			});
			stream.getCheckpoint = function(botId, queue) {
				return getStats(botId, queue);
			};


			let write = stream._write;
			stream._write = function(event, enc, done) {
				let r = write(event, enc, (err, data) => {
					if (!err) {
						stream.visit(event);
					}
					return done(err, data);
				});
				return r;
			};
			stream.on("finish", function() {
				console.log("finish");
				stream.checkpoint(opts || {}, () => { });
			});
			stream.on("end", function() {
				console.log("end", arguments);
				stream.checkpoint(opts || {}, () => { });
			});

			return stream;
		},
		toCheckpoint: (opts) => {
			opts = Object.assign({
				records: 1000,
				time: {
					seconds: 10
				},
				debug: false
			}, opts || {});

			let onCheckpointHook = opts.onCheckpoint || (async () => { /* No Op */ });

			// If onCheckpoint isn't an async function wrap it in one
			if (onCheckpointHook.constructor.name !== "AsyncFunction") {
				let fn = onCheckpointHook;
				onCheckpointHook = async (...args) => fn(...args);
			}

			var checkpoints = {};

			function doCheckpoint(callback) {
				logger.debug(JSON.stringify(checkpoints, null, 2));

				var tasks = [];
				let hookCheckpoints = {};
				for (var id in checkpoints) {
					var bot = checkpoints[id];
					hookCheckpoints[id] = {};
					for (var event in bot) {
						var checkpoint = bot[event];
						hookCheckpoints[id][refUtil.refId(event)] = checkpoint.eid;
						tasks.push((done) => {
							cron.checkpoint(id, event, checkpoint, done);
						});
					}
				}
				async.parallelLimit(tasks, 10, (err, results) => {
					checkpoints = {};
					onCheckpointHook({
						error: err,
						checkpoints: hookCheckpoints
					})
						.then(() => callback(err)) // 
						.catch(error => callback(error || err));
				});
			}

			let result = ls.buffer({
				writeStream: true,
				label: "toCheckpoint",
				time: opts.time,
				size: opts.size,
				records: opts.records,
				buffer: opts.buffer,
				debug: opts.debug,
				commands: {
					ignoreCommands: ["checkpoint"]
				}
			}, function(update, callback) {
				var id = update.id;
				var correlations = update.correlations;

				if (!correlations && update.correlation_id && update.correlation_id.source) {

					let timestamp = update.timestamp || Date.now();
					let start = (update.event_source_timestamp || timestamp);
					correlations = [{
						[update.correlation_id.source]: {
							start: update.correlation_id.start || undefined,
							end: update.correlation_id.end || update.correlation_id.start,
							records: update.correlation_id.units || 1,
							source_timestamp: start,
							timestamp: timestamp
						}
					}];
				}

				if (!(id in checkpoints)) {
					checkpoints[id] = {};
				}
				var c = checkpoints[id];

				var records = 0;
				correlations.forEach((correlation) => {
					for (var event in correlation) {
						var u = correlation[event];
						if (!(event in c)) {
							c[event] = {
								eid: u.end,
								records: u.records,
								source_timestamp: u.source_timestamp,
								ended_timestamp: u.timestamp,
								started_timestamp: u.timestamp,
								force: opts.force
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

				callback(null, {
					records: records
				});

			}, doCheckpoint, function flush(callback) {
				logger.debug("all checkpointed");
				callback();
			});
			result.get = function(bot, queue) {
				let b = queue && bot && checkpoints[refUtil.botRef(bot).id];
				return b && b[refUtil.ref(queue).id];
			};
			return result;
		},
		fromLeo: (ID, queue, opts) => {
			opts = Object.assign({}, opts || {});
			queue = refUtil.ref(queue).queue(opts.subqueue).id;
			if (!opts.stopTime && configure.registry && configure.registry.context) {
				opts.stopTime = moment.now() + (configure.registry.context.getRemainingTimeInMillis() * 0.8);
			}
			if (!opts.stopTime && opts.runTime) {
				opts.stopTime = moment().add(opts.runTime).valueOf();
			}

			logger.info(opts);
			opts = Object.assign({
				buffer: 16,
				loops: 100,
				start: null,
				limit: Number.POSITIVE_INFINITY,
				size: Number.POSITIVE_INFINITY,
				debug: false,
				stopTime: moment().add(240, "seconds"),
				stream_query_limit: opts.fast_s3_read ? 1000 : 50,
				fast_s3_read: false,
				fast_s3_read_parallel_fetch_max_bytes: FIVE_MB_IN_BYTES,
				fast_s3_read_timeout_retry_count: 1,
				autoConfigure: false
			}, opts || {});

			if (opts.autoConfigure) {
				if (opts.parser == null) {
					// Add a parser so parser threads get used
					opts.parser = parserUtil.ParserName.JsonParse;
				}
				addReadHooks(
					opts,
					typeof opts.autoConfigure === "boolean" ? {} : opts.autoConfigure,
					{
						tmpDir: ls.tmpDir,
						awsS3Config: {
							region: configure.aws.region,
							credentials: configure.credentials
						}
					}
				);
			}

			logger.info(opts);



			// Setup processing hooks with input values or defaults
			const noopPromise = () => Promise.resolve();
			const noop = () => { };
			const optsHooks = opts.hooks || {};
			const hooks = {
				...optsHooks,
				onStart: optsHooks.onStart || noop,
				onEnd: optsHooks.onEnd || noopPromise,
				onBatchStart: optsHooks.onBatchStart || noop,
				onBatchEnd: optsHooks.onBatchEnd || noopPromise,
				onRecordStart: optsHooks.onRecordStart || noop,
				onRecordEnd: optsHooks.onRecordEnd || noop,
				getS3Stream: optsHooks.getS3Stream || undefined,
				onGetEvents: optsHooks.onGetEvents || noop
			};
			if (opts.fast_s3_read) {
				logger.info('using fast_s3_read');
			}

			// Create a parser and handle eid commands
			// Eid Commands are needed when merging multiple records
			// LeoStream records together as they have different starting eids
			let JSONparse = parserUtil.createParser({
				parser: opts.parser,
				opts: {
					...opts.parserOpts
				}
			});

			var pass = new PassThrough({
				highWaterMark: opts.buffer,
				objectMode: true
			});
			var hasTime = true;

			// tracks if we've passed destroy on the passthrough
			let isPassDestroyed = false;

			// Allow access to added stuff from outside this function
			pass.getOpts = () => opts;

			pass.destroy = function() {
				hasTime = false;
				// we have destroyed pass
				isPassDestroyed = true;
				clearStreamTimeout();
			};

			function clearStreamTimeout() {
				hasTimeTimeout && clearTimeout(hasTimeTimeout);
				hasTimeTimeout = null;
			}
			function emitError(err) {
				clearStreamTimeout();
				pass.emit("error", err);
				pass.end();
			}

			pass.on("end", () => {
				clearStreamTimeout();
			});
			let hasTimeTimeout = setTimeout(() => {
				pass.destroy();
				console.log("Called timeout");
			}, opts.stopTime - moment());

			let newStats = () => {
				return {
					eid: null,
					units: 0,
					source_timestamp: null,
					started_timestamp: null,
					ended_timestamp: null
				};
			};
			let stats = newStats();
			let updateStats = (event) => {
				let timestamp = Date.now();
				let start = (event.event_source_timestamp || timestamp);

				stats.source_timestamp = stats.source_timestamp ? Math.min(start, stats.source_timestamp) : start;
				stats.started_timestamp = stats.started_timestamp ? Math.max(timestamp, stats.started_timestamp) : timestamp;
				stats.ended_timestamp = stats.ended_timestamp ? Math.max(timestamp, stats.ended_timestamp) : timestamp;
				stats.eid = event.eid;
				stats.units += event.units || 1;
				stats.start_eid = stats.start_eid || event.eid;
			};
			pass.checkpoint = function(params, done) {
				if (typeof params === "function") {
					done = params;
					params = {};
				}
				let data = Object.assign(stats, params);
				logger.debug("Stats", data);
				if (ID && queue && data.units > 0) {
					cron.checkpoint(ID, queue, data, (err) => {
						err && console.log("Stats error:", err);
						stats = newStats();
						done(err, data);
					});
				} else {
					done(null, data);
				}
			};
			pass.get = function() {
				return stats;
			};
			dynamodb.docClient.batchGet({
				RequestItems: {
					[CRON_TABLE]: {
						Keys: [{
							id: ID
						}]
					},
					[EVENT_TABLE]: {
						Keys: [{
							event: queue
						}]
					}
				}
			}, function(err, docs) {
				if (err) {
					if (err.message == 'The provided key element does not match the schema') {
						console.log(ID, queue);
					}
					emitError(new Error(err));
					return;
				} else if (docs.UnprocessedKeys !== undefined && Object.keys(docs.UnprocessedKeys).length > 0) {
					emitError(new Error("Not enough capacity to read"));
					return;
				}


				var start = null;
				var leoEvent, leoCron;
				if (docs.Responses[EVENT_TABLE] && docs.Responses[EVENT_TABLE].length === 0 && queue.match(/\/_phantom$/)) {
					docs.Responses[EVENT_TABLE] = [{
						v: 2,
						max_eid: ls.eventIdFromTimestamp(Date.now(), "full", 0)
					}];
				}
				if (Object.keys(docs.UnprocessedKeys) >= 1) {
					pass.end();
					return;
				} else if (!docs.Responses || !docs.Responses[EVENT_TABLE] || docs.Responses[EVENT_TABLE].length === 0) { //There are no events that are processable
					pass.end();
					return;
				} else {
					leoEvent = docs.Responses[EVENT_TABLE][0];
				}


				//start from today earliest if no checkpoint specified.
				let defaultCheckpointStart = "z/" + moment().format("YYYY/MM/DD");
				let archive_end = null;

				let snapshotNext = null;
				let snapshotStart = null;
				let snapshotEnd = null;
				let usingSnapshot = false;
				let usingArchive = false;
				let originalQueue = queue;
				if (leoEvent) {
					if (leoEvent.snapshot) {
						snapshotNext = leoEvent.snapshot.next;
						snapshotStart = leoEvent.snapshot.start;
					}
					if (leoEvent.archive) {
						archive_end = leoEvent.archive.end;
					}
				}
				var queueRef = refUtil.refId(queue);
				leoCron = docs.Responses && docs.Responses[CRON_TABLE] && docs.Responses[CRON_TABLE][0];
				if (opts.start) {
					start = opts.start + " "; //we want it to start after this one
				} else if (configure.registry && configure.registry.__cron && configure.registry.__cron.starteid && configure.registry.__cron.starteid[queueRef]) {
					start = configure.registry.__cron.starteid[queueRef] + " ";
				} else if (docs.Responses && docs.Responses[CRON_TABLE] && docs.Responses[CRON_TABLE][0]) { //There are no cron jobs, not possible to stream
					if (leoCron.checkpoint && !leoEvent.v) {
						start = leoCron.checkpoint + " ";
					} else if (leoCron.checkpoints && leoCron.checkpoints.read && leoCron.checkpoints.read[queueRef]) {
						start = (leoCron.checkpoints.read[queueRef].checkpoint || defaultCheckpointStart) + " ";
					} else {
						start = defaultCheckpointStart;
					}
				} else {
					start = defaultCheckpointStart;
				}


				console.log("Reading event from", start);

				//We want to first use a _snapshot if it exists
				//This means they have to set it to "z/" manually in order to get a snapshot, we won't do a snapshot by default.
				if ((start == "z/" || start == "z/ ") && snapshotStart) {
					start = snapshotStart;
				}
				//If we are using the snapshot, we go to a special queue
				//This could be checkpointed OR because they specified "z/" and converted it
				if (start.match(/^_snapshot/)) {
					queue += "/_snapshot";
					usingSnapshot = true;

					//Don't want to move onto the next snapshot
					snapshotEnd = start.replace(/[^/]+$/, '9999999999');
				}

				if (archive_end && archive_end.localeCompare(start) > 0) {
					queue += "/_archive";
					usingArchive = true;
				}

				if (start === null) { //We will not run unless we got a start
					pass.end();
					return;
				}

				var checkpointData = ["registry", "__cron", "checkpoints", "read"].reduce((o, f) => o[f] = o[f] || {}, configure);
				checkpointData[queueRef] = leoCron && leoCron.checkpoints && leoCron.checkpoints.read && leoCron.checkpoints.read[queueRef];

				var count = 0;
				pass.throttledWrite = (obj, callback) => {
					count++;
					start = obj.eid + " "; //we want it to continue after this one
					updateStats(obj);
					obj.event = originalQueue;
					if (!pass.write(obj)) {
						logger.debug("back pressure");
						pass.once('drain', () => {
							logger.debug("back pressure done");
							callback();
						});
					} else {
						callback();
					}
				};

				function max() {
					var max = arguments[0];
					for (var i = 1; i < arguments.length; ++i) {
						if (arguments[i] != null && arguments[i] != undefined) {
							max = max > arguments[i] ? max : arguments[i];
						}
					}
					return max;
				}

				let getEvents;
				let getEventsInit = () => { };
				if (leoEvent.v >= 2 || !leoEvent.max_eid) {
					var max_eid = (configure.registry && configure.registry.__cron && configure.registry.__cron.maxeid) || opts.maxOverride || leoEvent.max_eid || ls.eventIdFromTimestamp(Date.now(), "full", 0);
					var table_name = configure.resources.LeoStream;
					var eid = "eid";
					var range_key = "end";

					let lastEvaluatedKey;
					let getEventsQuery = function(callback) {
						var params = {
							TableName: table_name,
							KeyConditionExpression: "#event = :event and #key between :start and :maxkey",
							ExpressionAttributeNames: {
								"#event": "event",
								"#key": range_key,
							},
							Limit: opts.stream_query_limit || 50,
							ExpressionAttributeValues: {
								":event": queue,
								":maxkey": usingSnapshot ? snapshotEnd.replace("_snapshot/", "") + 9 : max_eid,
								":start": usingSnapshot ? start.replace("_snapshot/", "") : start
							},
							ExclusiveStartKey: lastEvaluatedKey,
							"ReturnConsumedCapacity": 'TOTAL'
						};
						logger.debug(params);
						dynamodb.docClient.query(params, function(err, data) {
							logger.debug("Consumed Capacity", data && data.ConsumedCapacity);
							if (err) {
								logger.error("fromLeo.getEventsQuery.dynamodb.query", err);
								callback(err);
								return;
							}
							lastEvaluatedKey = data.LastEvaluatedKey;
							if (!hasEnded) {
								let onGetEventsResponse = hooks.onGetEvents(data.Items);
								if (onGetEventsResponse != null) {
									data.Items = onGetEventsResponse;
								}
							}
							callback(null, data.Items);
						});
					};

					// Bootstrap the process to query the table
					let nextGetEventPromise;
					getEventsInit = () => {
						nextGetEventPromise = new Promise((resolve) => getEventsQuery((err, data) => resolve({ err, data })));
					};

					getEvents = function(callback) {
						nextGetEventPromise.then((response) => {
							if (!isPassDestroyed && response.err == null) {
								// Get the next Chunk
								nextGetEventPromise = new Promise((resolve) => getEventsQuery((err, data) => resolve({ err, data })));
							}

							// Respond with the next chunk of data
							callback(response.err, response.data);
						});
					};
				} else {
					var max_eid = max(leoEvent.kinesis_number, leoEvent.s3_kinesis_number, leoEvent.initial_kinesis_number, leoEvent.s3_new_kinesis_number);
					var table_name = "Leo";
					var eid = "kinesis_number";
					var range_key = "kinesis_number";

					getEvents = function(callback) {
						let q = refUtil.ref(queueRef).queue().id;
						leo.getEvents(ID, q, Object.assign({}, opts, {
							start: start
						}), (err, events, checkpoint) => {
							err && logger.error("fromLeo.getEventsOld", err);
							callback(err, events);
						});
					};
				}

				var hasMoreEvents = true;
				var hasLoops = opts.loops;
				var totalCount = 0;
				var totalSize = 0;
				var hasEnded = false;

				hooks.onStart({
					queue: queue,
					eid: start
				});
				if (usingSnapshot || max_eid.localeCompare(start) > 0) {
					getEventsInit();
					async.whilst(() => {
						logger.debug("checking next loop, loops remaining ", hasLoops, ", Time Remaining:", opts.stopTime - moment.now());
						hasTime = hasTime && (opts.stopTime > moment.now());
						logger.debug(totalCount, opts.limit, totalSize, opts.size, hasMoreEvents, hasTime, hasLoops, max_eid, start, (usingSnapshot || max_eid.localeCompare(start)));
						return totalCount < opts.limit && totalSize < opts.size && hasMoreEvents && hasTime && hasLoops && (usingSnapshot || max_eid.localeCompare(start) > 0);
					}, (done) => {
						var count = 0;
						hasLoops--;
						getEvents(function(err, items) {
							if (err) {
								return done(err);
							}

							let onStartReturn = hooks.onBatchStart(items);
							if (Array.isArray(onStartReturn)) {
								items = onStartReturn;
							}
							logger.debug("found", items.length, "items");
							if (items.length == 0) {
								if (usingSnapshot) { //Then let's go back to the real queue
									queue = originalQueue;
									start = snapshotNext;
									usingSnapshot = false;
									return done();
								} else if (usingArchive) { //Then let's go back to the real queue
									queue = originalQueue;
									usingArchive = false;
									return done();
								} else {
									logger.debug("no more events");
									hasMoreEvents = false;
									return done();
								}
							}

							var counts = 0;
							var size = 0;
							var bytes = 0;
							let s3_streams = {};
							let last_s3_index = 0;

							let close_remaining_s3_streams = () => {
								logger.debug("closing all remaining s3 stream");
								Object.entries(s3_streams).forEach(([key, data]) => {
									if (data.stream) {
										data.stream.on('error', (err) => {
											// Ignore errors.  This stream was never used
											logger.debug("Error closing s3 stream:", key, err);
										});
										logger.debug("closing s3 stream:", key);
										data.stream.destroy();
									}
								});
							};
							let get_s3_stream = hooks.getS3Stream || ((_item, index) => {
								let agg_bytes = 0;
								// Connect to as many S3 files as possible while only holding the configured mbs of 
								// event data in front of it
								last_s3_index = Math.max(last_s3_index, index);
								for (; last_s3_index < items.length && bytes < opts.fast_s3_read_parallel_fetch_max_bytes; last_s3_index++) {
									agg_bytes += items[last_s3_index].size; // Accounts for any non S3 data between S3 files

									// Create a stream for this S3 file
									if (items[last_s3_index].s3 != null || items[last_s3_index].s3Like) {

										//logger.debug("creating s3 connection", bytes, last_s3_index, items[last_s3_index].end, items[last_s3_index].s3.key);
										// Add to the total bytes waiting to be processed
										bytes += agg_bytes;
										s3_streams[last_s3_index] = {
											bytes: agg_bytes,
											stream: create_s3_stream(items[last_s3_index], last_s3_index, start)
										};
										agg_bytes = 0;
									}
								}

								return s3_streams[index].stream.get();
							});

							// Remove this streams byte count from the bytes waiting to be processed
							let free_s3_stream = hooks.freeS3Stream || ((index) => {
								if (s3_streams[index] != null) {
									bytes -= s3_streams[index].bytes;
									logger.debug("free s3 connection", items[index].s3 && items[index].s3.key || `Gzip: ${index}`);
								}
								delete s3_streams[index];
							});


							let create_s3_stream = hooks.createS3Stream || ((item, index) => {
								if (item.s3 && item.end.localeCompare(start) > 0) {

									logger.debug(`creating s3, Index: ${last_s3_index}, eid: ${items[last_s3_index].s3.key}`);
									if (item.start) {
										var _parts = item.start.split(/-/);
										var prefix = _parts[0];
										var idOffset = parseInt(_parts[1]);
									}

									let createEId = null;
									if (usingSnapshot) {
										createEId = function(eid) {
											return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
										};
									} else {
										createEId = function(eid) {
											return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
										};
									}
									var fileOffset = null;
									var fileEnd = item.gzipSize;

									for (let i = 0; i < item.offsets.length; i++) {
										var offset = item.offsets[i];

										let endEID;
										if (item.archive) {
											endEID = offset.end;
										} else {
											endEID = createEId(offset.end);
										}

										if (start.localeCompare(endEID) < 0) {
											if (fileOffset == null) {
												fileOffset = offset.gzipOffset;
												idOffset += offset.start;
											}
										}
									}

									var file = item.s3;
									file.range = `bytes=${fileOffset}-${fileEnd}`;

									let s3ReturnStream;
									let timeoutCount = 0;
									//let startRequestId = (configure.registry && configure.registry.context && configure.registry.context.awsRequestId) || "";
									let setS3ReturnStream = function(catchTimeoutErrors = true) {

										// Create the file stream and attach the id offset to know where the eids start for this file
										let localFile = path.resolve(ls.tmpDir, `s3/${item.event}/${item.end.replace(/\//g, "_")}-${fileOffset}-${fileEnd}.jsonl.gz`);
										if (fs.existsSync(localFile)) {
											s3ReturnStream = fs.createReadStream(localFile);
										} else {
											s3ReturnStream = ls.fromS3(file);
										}
										s3ReturnStream.idOffset = idOffset;

										if (catchTimeoutErrors) {

											// Attach an error listener to catch timeouts and pre connect again if allowed
											s3ReturnStream.on("error", err => {

												// Potential future enhancement - ignore error if the file was started on a different aws request
												// let currentRequestId = (configure.registry && configure.registry.context && configure.registry.context.awsRequestId) || "";
												// if (startRequestId != currentRequestId) {
												// 	// Cross invocation request.  Don't throw the error
												// 	return;
												// }


												// If the file has been consumed we don't want to catch errors
												if ((err.code === "TimeoutError" || err.name === "TimeoutError") && !s3ReturnStream.consumed) {
													timeoutCount++;
													logger.log(`Caught S3 timeout (${timeoutCount}/${opts.fast_s3_read_timeout_retry_count}) Index: ${index} Range: ${item.start} - ${item.end} Key: ${file.key}`);

													if (timeoutCount > opts.fast_s3_read_timeout_retry_count) {
														// Max pre connect timeout retries.  So wait until the events are actaully needed. 
														s3ReturnStream.timedout = true;
													} else {
														// pre connect again
														setS3ReturnStream();
													}
												} else {
													// Save the error for when the stream is consumed
													s3ReturnStream.errorToEmitOnPipe = err;
												}
											});
										}
									};

									// Start the connection to S3
									setS3ReturnStream();

									// Wrapper around retrieving the stream to allow for fixing errored s3 files
									return {
										get: function() {
											if (s3ReturnStream.timedout) {
												// The file consumed all the retries so connect now
												setS3ReturnStream(false);
											}

											// Marked as consumed so we pass along any errors correctly
											s3ReturnStream.consumed = true;

											// Emit any errors if needed when a downstream connects
											if (s3ReturnStream.errorToEmitOnPipe) {
												let pipe = s3ReturnStream.pipe.bind(s3ReturnStream);
												s3ReturnStream.pipe = function(dest, opts) {
													let ret = pipe(dest, opts);
													dest.emit("error", s3ReturnStream.errorToEmitOnPipe);
													return ret;
												};
											}

											return s3ReturnStream;
										},
										on: function(...args) {
											return s3ReturnStream.on(...args);
										},
										destroy: function(...args) {
											return s3ReturnStream.destroy(...args);
										}
									};
								}
								return null;
							});

							async.eachOfSeries(items, (item, i, done) => {

								if (totalCount >= opts.limit || totalSize >= opts.size || !hasTime || isPassDestroyed) {
									return done();
								}

								let odone = done;
								done = (...args) => {
									free_s3_stream(i);
									hooks.onRecordEnd(item, i);
									odone(...args);
								};
								hooks.onRecordStart(item, i);

								let prefix;
								let idOffset;
								function setBaseEid(newEid) {
									let _parts = newEid.split(/-/);
									prefix = _parts[0];
									idOffset = parseInt(_parts[1]);
								}
								if (item.start) {
									setBaseEid(item.start);
								}

								let createEId = null;
								if (usingSnapshot) {
									createEId = function(eid) {
										return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
									};
								} else {
									createEId = function(eid) {
										return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
									};
								}


								let readStream;
								if (item.end.localeCompare(start) > 0) {
									if (item.stream) {
										readStream = item.stream;
										idOffset = readStream.idOffset || idOffset;
									} else if (item.s3 || item.s3Like) {
										//let's figure out where we should jump into this file.
										let s3Stream;


										if (hooks.getS3Stream) {
											s3Stream = hooks.getS3Stream(item, i);
											idOffset = s3Stream.idOffset;
										} else if (opts.fast_s3_read) {
											s3Stream = get_s3_stream(item, i);
											idOffset = s3Stream.idOffset;
										} else if (hooks.createS3Stream) {
											s3Stream = hooks.createS3Stream(item, i, item.start).get();
											idOffset = s3Stream.idOffset;
										} else {
											var fileOffset = null;
											var fileEnd = item.gzipSize;
											var recordOffset = 0;

											for (let i = 0; i < item.offsets.length; i++) {
												var offset = item.offsets[i];

												let endEID;
												if (item.archive) {
													endEID = offset.end;
												} else {
													endEID = createEId(offset.end);
												}

												if (start.localeCompare(endEID) < 0) {
													logger.debug(start, offset.start, offset.end);
													counts += offset.records; //is this right?
													size += offset.size; //this isn't exact when getting in the middle of a file, but close enough
													if (fileOffset == null) {
														fileOffset = offset.gzipOffset;
														idOffset += offset.start;
													}
													// Took out trying to pre-emptively end the file. The benefit wasn't there, and it was causing
													// readers to skip 1000's of events if they were using a limit.
												}
											}

											var file = item.s3;
											file.range = `bytes=${fileOffset}-${fileEnd}`;
											logger.debug(file.bucket, file.key, file.range);
											let localFile = path.resolve(ls.tmpDir, `s3/${item.event}/${item.end.replace(/\//g, "_")}-${fileOffset}-${fileEnd}.jsonl.gz`);
											if (fs.existsSync(localFile)) {
												s3Stream = fs.createReadStream(localFile);
											} else {
												s3Stream = ls.fromS3(file);
											}
										}
										var eid = 0;
										let gzipStream;

										// Unzip if the stream if it isn't already
										if (s3Stream.isUnzipped) {
											gzipStream = ls.passThrough({ objectMode: true });
										} else {
											gzipStream = zlib.createGunzip();
											gzipStream.setEncoding('utf8');
											gzipStream.on('error', function(err) {
												logger.debug("Skipping gzip");
											});
										}

										// Get a stream to split and parse the incoming data
										let splitParseStream = hooks.createSplitParseStream ? hooks.createSplitParseStream(JSONparse, item) : null;
										splitParseStream = splitParseStream || split((value) => {
											try {
												let obj = JSONparse(value);
												return obj;
											} catch (e) {
												//If we cancel the download early, we don't want to die here.
												return null;
											}
										});

										readStream = ls.pipeline(s3Stream, gzipStream, splitParseStream);
									} else if (item.gzip) {
										var gzip = zlib.createGunzip();
										gzip.setEncoding('utf8');
										gzip.on('error', function(err) {
											logger.debug("Skipping gzip");
										});

										gzip.end(item.gzip);
										let splitParseStream = hooks.createSplitParseStream ? hooks.createSplitParseStream(JSONparse, item) : null;

										splitParseStream = splitParseStream || split((value) => {
											try {
												let obj = JSONparse(value);
												return obj;
											} catch (e) {
												//If we cancel the download early, we don't want to die here.
												return null;
											}
										});

										readStream = ls.pipeline(gzip, splitParseStream);
									}
								}

								if (readStream) {
									readStream.setBaseEid = setBaseEid;
									var eid = 0;
									ls.pipe(
										readStream,
										ls.write((e, sinkDone) => {
											// Respond to changing the eid and offset
											if (e._cmd == "setBaseEid") {
												setBaseEid(e.eid);
												eid = 0;
												return sinkDone();
											}
											if (!item.archive) {
												e.eid = createEId(eid++);
											}
											let isGreaterThanStart = e.eid.localeCompare(start) > 0;

											if (!isPassDestroyed && isGreaterThanStart && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
												totalCount++;
												if (opts.size != null && e.size == null) {
													// Figure out the size if it doesn't exist and they want size
													e.size = Buffer.byteLength(JSON.stringify(e));
													logger.debug("Event didn't parse with size!!!");
												}
												totalSize += (e.size || 0);
												pass.throttledWrite(e, sinkDone);
											} else { //otherwise it means we had a number in the middle of a file
												if (isPassDestroyed || totalCount >= opts.limit || totalSize >= opts.size) {
													//we might as well close this this stream;
													pass.destroy();
													readStream.destroy();
												}
												logger.debug("skipping generic stream", start, e.eid, `isGreaterThanStart: ${isGreaterThanStart}, records: ${totalCount} >= ${opts.limit}, sie ${totalSize} >= ${opts.size}`);
												sinkDone();
											}
										}), (err) => {
											if (err &&
												err.code != "RequestAbortedError" &&
												!(isPassDestroyed && err.code == "Z_BUF_ERROR") &&
												!(isPassDestroyed && err.message == "premature close")) {
												logger.error("fromLeo.stream.pipe.error", err);
												done(err);
											} else {
												done();
											}
										}
									);
								} else {
									done();
								}
							}, function(err) {
								start = items[items.length - 1].end + " ";
								logger.debug("done with this loop", err || "");
								close_remaining_s3_streams();
								hooks.onBatchEnd(items).finally(() => {
									if (err) {
										done(err);
									} else {
										done();
									}
								});
							});
						});
					}, (err) => {
						logger.debug("Calling Pass.end");
						if (err) logger.error("fromLeo.stream.pipe.end", err);
						hasEnded = true;
						hooks.onEnd().finally(() => {
							if (err) {
								pass.emit("error", err);
							}
							pass.end();
						});
					});
				} else {
					logger.debug("no events");
					hooks.onEnd().finally(() => {
						pass.end();
					});
					return;
				}
			});

			return pass;
		},
		toLeoMass: (queue, configure) => {
			return ls.pipeline(leoS3(ls, queue, configure));
		},
		toDynamoDB: function(table, opts) {
			opts = Object.assign({
				records: 25,
				size: 1024 * 1024 * 2,
				time: {
					seconds: 2
				}
			}, opts || {});

			var records, size;

			let keysArray = [opts.hash];
			opts.range && keysArray.push(opts.range);
			let key = opts.range ? (obj) => {
				return `${obj[opts.hash]}-${obj[opts.range]}`;
			} : (obj) => {
				return `${obj[opts.hash]}`;
			};
			let assign = (self, key, obj) => {
				self.data[key] = obj;
				return false;
			};
			if (opts.merge) {
				assign = (self, key, obj) => {
					if (key in self.data) {
						self.data[key] = merge(self.data[key], obj);
						return true;
					} else {
						self.data[key] = obj;
						return false;
					}
				};
			}

			function reset() {
				if (opts.hash || opts.range) {
					records = {
						length: 0,
						data: {},
						push: function(obj) {
							this.length++;
							return assign(this, key(obj), obj);
						},
						map: function(each) {
							return Object.keys(this.data).map(key => each(this.data[key]));
						}
					};
				} else {
					records = [];
				}
			}
			reset();


			let loggerTimeId = sdkId + (sdkTimeIndex++).toString();
			var retry = backoff.fibonacci({
				randomisationFactor: 0,
				initialDelay: 100,
				maxDelay: 1000
			});
			retry.failAfter(10);
			retry.success = function() {
				retry.reset();
				retry.emit("success");
			};
			retry.run = function(callback) {
				let fail = (err) => {
					retry.removeListener('success', success);
					callback(err || 'failed');
				};
				let success = () => {
					retry.removeListener('fail', fail);
					reset();
					callback();
				};
				retry.once('fail', fail).once('success', success);

				retry.fail = function(err) {
					retry.reset();
					callback(err);
				};
				retry.backoff();
			};
			retry.on('ready', function(number, delay) {
				if (records.length === 0) {
					retry.success();
				} else {
					logger.info("sending", records.length, number, delay);
					logger.time("dynamodb request" + loggerTimeId);

					let keys = [];
					let lookup = {};
					let all = records.map((r) => {
						let wrapper = {
							PutRequest: {
								Item: r
							}
						};
						if (opts.merge && opts.hash) {
							lookup[key(r)] = wrapper;
							keys.push({
								[opts.hash]: r[opts.hash],
								[opts.range]: opts.range && r[opts.range]
							});
						}
						return wrapper;
					});
					let getExisting = opts.merge ? ((done) => {
						dynamodb.batchGetTable(table, keys, {}, done);
					}) : done => done(null, []);

					let tasks = [];
					for (let ndx = 0; ndx < all.length; ndx += 25) {
						let myRecords = all.slice(ndx, ndx + 25);
						tasks.push(function(done) {
							let retry = {
								backoff: (err) => {
									done(null, {
										backoff: err || "error",
										records: myRecords
									});
								},
								fail: (err) => {
									done(null, {
										fail: err || "error",
										records: myRecords
									});
								},
								success: () => {
									done(null, {
										success: true,
										//records: myRecords
									});
								}
							};
							dynamodb.docClient.batchWrite({
								RequestItems: {
									[table]: myRecords
								},
								"ReturnConsumedCapacity": 'TOTAL'
							}, function(err, data) {
								if (err) {
									logger.info(`All ${myRecords.length} records failed! Retryable: ${err.retryable}`, err);
									logger.error("toDynamoDB.batchWrite", myRecords);
									if (err.retryable) {
										retry.backoff(err);
									} else {
										retry.fail(err);
									}
								} else if (table in data.UnprocessedItems && Object.keys(data.UnprocessedItems[table]).length !== 0) {
									//reset();
									//data.UnprocessedItems[table].map(m => records.push(m.PutRequest.Item));
									myRecords = data.UnprocessedItems[table];
									retry.backoff();
								} else {
									logger.info(table, "saved");
									retry.success();
								}
							});
						});
					}
					getExisting((err, existing) => {
						if (err) {
							return retry.fail(err);
						}
						existing.map(e => {
							let newObj = lookup[key(e)];
							newObj.PutRequest.Item = merge(e, newObj.PutRequest.Item);
						});
						async.parallelLimit(tasks, 10, (err, results) => {
							if (err) {
								retry.fail(err);
							} else {
								let fail = false;
								let backoff = false;
								reset();
								results.map(r => {
									fail = fail || r.fail;
									backoff = backoff || r.backoff;
									if (!r.success) {
										r.records.map(m => records.push(m.PutRequest.Item));
									}
								});

								if (fail) {
									retry.fail(fail);
								} else if (backoff) {
									retry.backoff(backoff);
								} else {
									retry.success();
								}
							}
						});
					});
				}
			});
			return ls.buffer({
				writeStream: true,
				label: "toDynamoDB",
				time: opts.time,
				size: opts.size,
				records: opts.records,
				buffer: opts.buffer,
				debug: opts.debug
			}, function(obj, done) {
				size += obj.gzipSize;
				records.push(obj);

				done(null, {
					size: obj.gzipSize,
					records: 1
				});
			}, retry.run, function flush(done) {
				logger.info("toDynamoDB On Flush");
				done();
			});
		},
		buffer: _streams.buffer,
		bufferBackoff: _streams.bufferBackoff,
		batch: _streams.batch,
		joinExternal: _streams.joinExternal,
		putEvent: function(id, event, obj, opts, callback) {
			if (typeof opts == "function") {
				callback = opts;
				opts = {};
			}

			var stream = ls.load(id, event, opts);
			stream.write(obj);
			stream.end(err => {
				err && logger.info("Error:", err);
				callback(err);
			});

		},
		magic: function(streams, opts) {
			let sublogger = logger.sub("autoswitch");
			streams.map((s, i) => {
				s.minDurationMS = s.minDurationMS || moment.duration(s.minDuration || {
					seconds: 5
				}).asMilliseconds();

				if (typeof s.canSustainLoad == "number") {
					let maxRecordsPerSecond = s.canSustainLoad;
					s.canSustainLoad = (stats) => {
						var result = stats.recordsPerSecondAvg <= maxRecordsPerSecond && (stats.recordsPerSecond <= maxRecordsPerSecond || stats.recordsPerSecondHistory[0] <= maxRecordsPerSecond);
						return result;
					};
				}
				s.canSustainLoad = s.canSustainLoad || (() => false);
				s.label = s.label || i.toString();
			});


			opts = Object.assign({
				historyLength: 5,
				sampleInterval: {
					milliseconds: 500
				}
			}, opts);

			let sampleIntervalMS = moment.duration(opts.sampleInterval).asMilliseconds();
			let stats = {
				recordsPerSecondHistory: [0],
				recordsPerSecond: 0,
				recordsPerSecondAvg: 0,
				records: 0,
				start: moment.now()
			};
			let lastSwitch = Date.now();

			let current;
			let getBestStream = () => {
				if (current && (Date.now() - lastSwitch) < current.minDurationMS) {
					return current;
				}
				return (streams.find((s) => s.canSustainLoad(stats)) || streams[streams.length - 1]);
			};
			current = getBestStream();


			let startStream = ls.through((obj, done) => {
				stats.records++;
				let now = stats.now = moment.now();
				let nextStream = getBestStream();
				if (now - stats.start >= sampleIntervalMS) {
					stats.recordsPerSecondHistory.unshift(stats.recordsPerSecond);
					if (stats.recordsPerSecondHistory.length > opts.historyLength) {
						stats.recordsPerSecondHistory.pop();
					}
					stats.recordsPerSecondAvg = stats.recordsPerSecondHistory.reduce((sum, cur) => sum + cur) / stats.recordsPerSecondHistory.length;
					stats.recordsPerSecond = stats.records / ((now - stats.start) || 1) * 1000;
					sublogger.debug("Stats:", JSON.stringify(stats, null, 2));
					stats.start = now;
					stats.records = 0;
				}

				if (nextStream != current) {
					sublogger.log(`Switching from ${current.label} to ${nextStream.label}`, JSON.stringify(stats, null, 2));
					// Stop source from writting new events
					startStream.unpipe(current.stream);

					// Wait for current to drain
					current.stream.once("switch", () => {
						sublogger.log(`Flushed ${current.label} complete, switched to ${nextStream.label}`);
						lastSwitch = Date.now();

						// Switch the streams
						current.stream.unpipe();
						current = nextStream;
						startStream.pipe(current.stream);
						current.stream.pipe(endStream);
						done(null, obj);
					});
					current.stream.write({
						__cmd: "flush",
						from_auto_switch: true
					});
				} else {
					done(null, obj);
				}
			}, (done) => {
				// End all streams except current
				let errors = [];
				async.eachOf(streams, (s, i, done) => {
					if (s == current) {
						done();
					} else {
						s.stream.end((err) => {
							if (err) {
								errors.push(err);
							}
							done();
						});
					}
				}, () => {
					done(errors.length ? errors : null);
				});
			});
			let endStream = ls.through({
				"cmdFlush": (obj, done) => {
					sublogger.log("ready to switch");
					current.stream.emit("switch");
					done(null, obj.from_auto_switch ? undefined : obj);
				}
			}, (obj, done) => done(null, obj));

			// Hook up all event listeners
			// unpipe so data isn't flowing to everything yet
			streams.map(s => {
				if (s != current) {
					ls.pipe(startStream, s.stream, endStream);
					startStream.unpipe(s.stream);
					s.stream.unpipe();
				}
			});

			// Hook up everything for the current stream
			return ls.pipeline(startStream, current.stream, endStream);
		},
		autoSwitch: function(outQueue, opts) {
			opts = Object.assign({
				recordsPerSecond: 100,
				sampleInterval: {
					milliseconds: 100
				}
			}, opts);

			let sampleIntervalMS = moment.duration(opts.sampleInterval).asMilliseconds();
			let stats = {
				isS3: false,
				recordsPerSecond: 0,
				records: 0,
				lastSwitch: moment.now(),
				start: moment.now()
			};
			let toLeo = ls.toLeo(opts);
			let end = ls.through((obj, done) => done(null, obj), (done) => {
				logger.info("Calling flush for end");
				done();
			});

			let cnt = 0;
			let kinesisStream = ls.pipeline(toLeo, end);
			let leoS3S = leoS3(ls, outQueue, configure); //TODO: if this ever gets used, pass in a opts paramater with a prefix of the botId
			let s3Stream = ls.pipeline(leoS3S, kinesisStream);
			let stream = kinesisStream; //ls.pipeline(toLeo, end);

			let start = ls.through(function(obj, done) {
				stats.records++;
				let now = stats.now = moment.now();
				stats.recordsPerSecond = stats.records / ((now - stats.start) || 1) * 1000;
				logger.info(now - stats.start, sampleIntervalMS, stats.records, stats.recordsPerSecond);
				if (now - stats.start >= sampleIntervalMS) {
					cnt++;
					logger.debug("Stats:", JSON.stringify(stats));
					stats.start = now;
					stats.records = 0;
				}

				if (!stats.isS3 && stats.recordsPerSecond >= opts.recordsPerSecond) {
					logger.debug("Switching to S3 stream", JSON.stringify(stats));
					//stream.end((err) => {
					//	logger.info("Back", err)
					stats.isS3 = true;
					stats.lastSwitch = moment.now();
					//	stream = ls.pipeline(leoS3(ls, outQueue, configure), toLeo, end);
					stream = s3Stream;
					stream.write(obj);
					done();
					//});
					// stream.end((err) => {
					// 	logger.info("Back:", err)
					// 	stats.isS3 = true;
					// 	stats.lastSwitch = moment.now();
					// 	logger.debug("Switching", JSON.stringify(stats));
					// 	stream = ls.pipeline(leoS3(), toLeo, end);
					// 	stream.write(obj);
					// 	done(err);
					// });
				} else if (stats.isS3 && stats.recordsPerSecond < opts.recordsPerSecond) {
					logger.debug("Switching to Kinesis stream", JSON.stringify(stats));

					leoS3S.once("drain", () => {
						//stream.end((err) => {
						//	logger.info("Back", err)
						stats.isS3 = false;
						stats.lastSwitch = moment.now();
						//stream = ls.pipeline(toLeo, end);
						stream = kinesisStream;
						stream.write(obj);
						done();
						//});
					});
					// stream.end((err) => {
					// 	stats.isS3 = false;
					// 	stats.lastSwitch = moment.now();
					// 	logger.debug("Switching", JSON.stringify(stats));
					// 	stream = ls.pipeline(toLeo, end);
					// 	stream.write(obj);
					// 	done(err);
					// });
				} else {
					logger.info("Normal Write");
					stream.write(obj);
					done();
				}
			}, function flush(done) {
				logger.debug("On Flush Stats:", JSON.stringify(stats));
				done();
			});
			let s = ls.pipeline(start, end);
			s.on("error", (err) => {
				logger.info("Kinesis Stream error:", err);
			})
				.on("end", () => logger.info("ending kinesis stream"))
				.on("finish", () => logger.info("finishing kinesis stream"));

			return s;
		},
		createCorrelation: function(startEvent, endEvent, units, opts) {
			let isArray = Array.isArray(startEvent);
			if (isArray) {
				// Array of events to use for correlation
				opts = endEvent;
				units = startEvent.reduce((sum, one) => sum + (typeof one.units === "number" ? one.units : 1), 0);

				// Only need endEvent if length is > 1
				if (startEvent.length > 1) {
					endEvent = startEvent[startEvent.length - 1];
				} else {
					endEvent = null;
				}
				startEvent = startEvent[0];
			} else if (opts == null && units == null) {
				// Single event to use as correlation
				opts = endEvent;
				units = (startEvent != null && typeof startEvent.units === "number") ? startEvent.units : 1;
			}

			opts = {
				partial: false,
				...opts
			};

			if (startEvent == null) {
				throw new Error(isArray ? "startEvent must not be empty" : "startEvent is required");
			}
			return {
				source: startEvent.event,
				[opts.partial ? 'partial_start' : 'start']: startEvent.eid,
				[opts.partial ? 'partial_end' : 'end']: endEvent && endEvent.eid,
				units: units
			};
		}
	};

	//mergeV2(ls);

	if (global.isOverride) {
		global.isOverride(ls);
	}
	return ls;
};
