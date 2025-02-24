"use strict";
const merge = require('lodash.merge');
var through = require('through2').obj;
var pump = require("pump");
var pumpify = require("pumpify").obj;
var split = require("split2");
var zlib = require("zlib");
var fastCsv = require("fast-csv");
var write = require("./flushwrite.js");
const { S3 } = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require('@smithy/node-http-handler');

var https = require("https");
var PassThrough = require('stream').PassThrough;
var s3 = new S3({
	apiVersion: '2006-03-01',
	requestHandler: new NodeHttpHandler({
		httpsAgent: new https.Agent({
			keepAlive: true
		})
	}),
});
var stream = require("stream");
var moment = require("moment");
var backoff = require("backoff");
const { promisify, callbackify } = require('util');
const es = require('event-stream');

const logger = require('leo-logger')('stream');

let ls = module.exports = {
	eventstream: es,
	eventIdFromTimestamp: function(timestamp, granularity = "full", record = null) {
		const pad = "0000000";
		const padLength = -1 * pad.length;
		let formats = {
			full: "[z/]YYYY/MM/DD/HH/mm/",
			year: "[z/]YYYY/",
			month: "[z/]YYYY/MM/",
			date: "[z/]YYYY/MM/DD/",
			hour: "[z/]YYYY/MM/DD/HH/",
			minute: "[z/]YYYY/MM/DD/HH/mm/",
			second: "[z/]YYYY/MM/DD/HH/mm/",
			millisecond: "[z/]YYYY/MM/DD/HH/mm/"
		};

		if (!(granularity in formats)) {
			granularity = "full";
		}
		let eventIdFormat = formats[granularity] || formats.full;
		let momentTimestamp = moment.utc(timestamp);

		if (granularity == "second") {
			momentTimestamp.startOf("second");
		}

		let suffix = "";
		if (granularity === "full" || granularity === "millisecond" || granularity === "second") {
			suffix = momentTimestamp.valueOf();
			if (record != null && (granularity === "full" || granularity === "millisecond")) {
				suffix += "-" + (pad + record).slice(padLength);
			}
		}
		return momentTimestamp.format(eventIdFormat) + suffix;
	},
	eventIdToTimestamp: function(eid) {
		if (typeof eid !== "string") {
			throw new Error("Invalid Event Id.  Should be a string.");
		}

		let [z, year, month, date, hour, minute, timestamp] = eid.split(/[/-]/);

		let readPosition;
		if (z === "z") {
			if (timestamp && timestamp > 10000) { // Safeguard for timestamps that aren't actual timestamps
				readPosition = moment(parseInt(timestamp, 10));
			} else {

				// Use all the revelant parts of the eid to get the best current position
				let okIndex = 5;
				const parts = [year, parseInt(month, 10) - 1, date, hour, minute].filter((i, ndx) => {
					if (i == null || isNaN(i) || i === "") {
						okIndex = ndx;
					}
					return ndx < okIndex;
				}).map(i => parseInt(i, 10));

				// if there are parts set the position
				if (parts.length > 0) {
					readPosition = moment.utc(parts);
				}
			}
		}

		if (readPosition == null) {
			throw new Error(`Unable to get timestamp for Event Id: ${eid}`);
		}
		return readPosition.valueOf();
	},
	previousEventId: function(id) {
		return id.slice(0, -1) + String.fromCodePoint(id.codePointAt(id.length - 1) - 1);
	},
	commandWrap: function(opts, func) {
		if (typeof opts === "function") {
			func = opts;
			opts = {};
		}
		opts = merge({
			hasCommands: '__cmd',
			ignoreCommands: {}
		}, opts || {});

		if (Array.isArray(opts.ignoreCommands)) {
			opts.ignoreCommands = opts.ignoreCommands.reduce((all, one) => {
				all[one] = true;
				return all;
			}, {});
		}


		let commands = {};
		//By Default just pass the command along
		commands['cmd'] = opts.cmd || ((obj, done) => {
			done(null, obj);
		});
		for (var key in opts) {
			if (key.match(/^cmd/)) {
				let cmd = key.replace(/^cmd/, '').toLowerCase();
				commands[cmd] = opts[key];
			}
		}
		let throughCommand;
		//They need to specify false to turn this off
		if (opts.hasCommands !== false) {
			throughCommand = function(obj, enc, done) {
				//Only available on through streams (not on write streams);
				let push = this.push && this.push.bind(this);
				try {
					if (obj && obj.__cmd && opts.ignoreCommands[obj.__cmd] !== true) {
						let cmd = obj.__cmd.toLowerCase();
						if (cmd in commands) {
							commands[cmd].call(this, obj, done, push);
						} else {
							commands.cmd.call(this, obj, done, push);
						}
					} else {
						func.call(this, obj, done, push);
					}
				} catch (err) {
					logger.error(err);
					done(err);
				}
			};
		} else {
			throughCommand = function(obj, enc, done) {
				//Only available on through streams (not on write streams);
				let push = this.push && this.push.bind(this);
				try {
					func.call(this, obj, done, push);
				} catch (err) {
					logger.error(err);
					done(err);
				}
			};
		}

		return throughCommand;
	},
	passthrough: (opts) => {
		return new PassThrough(opts);
	},
	through: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}
		return through(opts, ls.commandWrap(opts, func), flush ? function(done) {
			flush.call(this, done, this.push.bind(this));
		} : null);
	},
	throughAsync: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}

		// Non standard callback pattern.  Hash push after callback.
		let origFunc = func;
		func = origFunc && async function(obj, cb, push) {
			let error;
			let data;
			try {
				data = await origFunc.call(this, obj, push);
			} catch (err) {
				error = err;
			}
			cb(error, data);
		};
		flush = flush && callbackify(flush);

		return through(opts, ls.commandWrap(opts, func), flush ? function(done) {
			flush.call(this, done, this.push.bind(this));
		} : null);
	},
	writeWrapped: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}
		return write.obj(opts, ls.commandWrap(opts, func), flush ? function(done) {
			flush.call(this, done);
		} : null);
	},
	cmd: (watchCommands, singleFunc) => {
		if (typeof singleFunc == "function") {
			watchCommands = {
				[watchCommands]: singleFunc
			};
		}
		for (var key in watchCommands) {
			if (!key.match(/^cmd/) && typeof watchCommands[key] == "function") {
				watchCommands["cmd" + key] = watchCommands[key];
			}
		}
		return ls.through(watchCommands, (obj, done) => done(null, obj));
	},
	buffer: (opts, each, emit, flush) => {
		opts = merge({
			time: opts && opts.time || {
				seconds: 10
			},
			size: 1024 * 200,
			records: 1000,
			buffer: 1000,
			debug: true
		}, opts);

		let streamType = ls.through;
		if (opts.writeStream) {
			streamType = ls.writeWrapped;
		}

		let label = opts.label ? (opts.label + ' ') : '';
		var size = 0;
		var records = 0;
		var timeout = null;

		let isSizeConstrained = false;
		let isRecordConstrained = false;
		let isTimeConstrained = false;
		let startTime;
		function reset() {
			isSizeConstrained = false;
			isRecordConstrained = false;
			isTimeConstrained = false;
			records = 0;
			size = 0;
			clearTimeout(timeout);
			timeout = null;
		}

		function doEmit(last = false, done) {
			if (records) {
				logger.debug(`${label}emitting ${last ? 'due to stream end' : ''} ${isSizeConstrained ? 'due to size' : ''} ${isTimeConstrained ? 'due to time' : ''}  ${isRecordConstrained ? 'due to record count' : ''}  records:${records} size:${size} duration:${Date.now() - startTime}`);
				let data = {
					records: records,
					size: size,
					isLast: last
				};
				reset();
				emit.call(stream, (err, obj) => {
					logger.debug(label + "emitting done", err);
					if (obj != undefined) {
						stream.push(obj);
					}
					if (err) {
						stream.emit("error", err);
					}
					if (done) {
						done(err);
					}
				}, data);
			} else {
				reset();
				logger.debug(label + "Stream ended");
				if (done) {
					done(null, null);
				}
			}
		}

		var stream = streamType(merge({
			cmdFlush: (obj, done) => {
				if (opts.onlyFlushSelf && (!obj.getOwner || obj.getOwner() !== stream)) {
					return done();
				}
				delete obj.getOwner;

				doEmit(false, () => {
					//want to add the flush statistics and send it further
					done(null, obj);
				});
			},
			highWaterMark: opts.highWaterMark || undefined
		}, opts.commands), function(o, done) {
			// Capture duration but don't let it pass to the handler
			let bufferDuration = (o.bufferDuration || 0);
			delete o.bufferDuration;
			each.call(stream, o, (err, obj) => {
				if (obj) {
					if (obj.reset === true) {
						reset();
					}
					records += obj.records || 1;
					size += obj.size || 1;
					if (!timeout) {
						startTime = Date.now();
						let optsTimeMS = moment.duration(opts.time).asMilliseconds();
						let sleepMS = Math.max(0, Math.min(2147483647, optsTimeMS - bufferDuration)); // Max value allowed by setTimeout
						logger.debug(`${label}setTimeout ${sleepMS}, time:${optsTimeMS}, prevTime:${bufferDuration}`);

						timeout = setTimeout(() => {
							isTimeConstrained = true;
							stream.writable && stream.write({
								__cmd: "flush",
								timeout: true,
								flush: true,
								...(opts.onlyFlushSelf ? { getOwner: () => stream } : undefined)
							});
						}, sleepMS);
					}
					isSizeConstrained = size >= opts.size;
					isRecordConstrained = records >= opts.records;
					if (isSizeConstrained || isRecordConstrained) {
						doEmit(false, done);
					} else {
						done(err, null);
					}
				} else {
					done(err, null);
				}
			});
		}, (done) => {
			doEmit(true, () => {
				if (flush) {
					flush.call(stream, done);
				} else {
					done();
				}
			});
		});
		if (opts.addBufferDuration && stream.push != null) {
			let streamPush = stream.push.bind(stream);
			stream.push = function(...args) {
				let event = args[0];
				if (event != null) {
					event.bufferDuration = Date.now() - startTime;
				}
				return streamPush(...args);
			};
		}
		stream.reset = reset;
		stream.flush = function(done) {
			doEmit(false, done);
		};
		stream.updateLimits = (limits) => {
			opts = merge(opts, limits);
		};
		return stream;
	},
	bufferBackoff: function(each, emit, retryOpts, opts, flush) {
		retryOpts = merge({
			randomisationFactor: 0,
			initialDelay: 1,
			maxDelay: 1000,
			failAfter: 10
		}, retryOpts);
		opts = merge({
			records: 25,
			size: 1024 * 1024 * 2,
			time: opts.time || {
				seconds: 2
			}
		}, opts || {});

		var records, size;

		function reset() {
			records = [];
		}
		reset();

		let lastError = null;

		var retry = backoff.fibonacci({
			randomisationFactor: 0,
			initialDelay: 1,
			maxDelay: 1000
		});
		retry.failAfter(retryOpts.failAfter);
		retry.success = function() {
			retry.reset();
			retry.emit("success");
		};
		retry.run = function(callback) {
			let fail = (err) => {
				retry.removeListener('success', success);
				callback(lastError || 'failed');
			};
			let success = () => {
				retry.removeListener('fail', fail);
				reset();
				callback();
			};
			retry.once('fail', fail).once('success', success);
			retry.backoff();
		};
		retry.on('ready', function(number, delay) {
			if (records.length === 0) {
				retry.success();
			} else {
				logger.info("sending", records.length, number, delay);
				emit(records, (err, records) => {
					if (err) {
						lastError = err;
						logger.info(`All records failed`, err);
						retry.backoff();
					} else if (records.length) {
						lastError = err;
						logger.info(`${records.length} records failed`, err);
						retry.backoff();
					} else {
						logger.info("Success");
						retry.success();
					}
				});
			}
		});
		return this.buffer({
			writeStream: true,
			label: opts.label,
			time: opts.time,
			size: opts.size,
			records: opts.records,
			buffer: opts.buffer,
			debug: opts.debug,
			commands: opts.commands
		}, (record, done) => {
			each(record, (err, obj, units = 1, size = 1) => {
				if (err) {
					done(err);
				} else {
					records.push(obj);
					done(null, {
						size: size,
						records: units
					});
				}
			});
		}, retry.run, function(done) {
			logger.info(opts.label + " On Flush");
			if (flush) {
				flush.call(stream, done);
			} else {
				done();
			}
		});
	},
	pipeline: pumpify,
	split: split,
	gzip: zlib.createGzip,
	gunzip: zlib.createGunzip,
	write: write.obj,
	pipe: pump,
	pipeAsync: promisify(pump),
	stringify: () => {
		return ls.through((obj, done) => {
			done(null, JSON.stringify(obj) + "\n");
		});
	},
	parse: (skipErrors = false) => {
		return pumpify(split(), ls.through((obj, done) => {
			if (!obj) {
				done();
			} else {
				try {
					obj = JSON.parse(obj);
				} catch (err) {
					done(skipErrors ? undefined : err);
					return;
				}
				done(null, obj);
			}
		}));
	},
	fromCSV: function(fieldList, opts) {
		opts = merge({
			headers: fieldList,
			ignoreEmpty: true,
			trim: true,
			escape: '\\',
			nullValue: "\\N",
			delimiter: '|'
		}, opts || {});

		var parse = fastCsv.parse(opts);
		var transform = ls.through((obj, done) => {
			for (var i in obj) {
				if (obj[i] === opts.nullValue) {
					obj[i] = null;
				}
			}
			done(null, obj);
		});

		parse.on("error", function(...args) {
			logger.error(...args);
		});

		return pumpify(parse, transform);
	},
	toCSV: (fieldList, opts) => {
		opts = merge({
			nullValue: "\\N",
			delimiter: ',',
			escape: '"'
		}, opts || {});
		return fastCsv.format({
			headers: fieldList,
			delimiter: opts.delimiter,
			escape: opts.escape,
			quote: opts.quote,
			transform: function(row) {
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
		s3.upload({
			Bucket: Bucket,
			Key: File,
			Body: pass
		}, (err) => {
			logger.log("done uploading", err);
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
		opts = merge({}, opts);
		return (opts.s3 || s3).getObject({
			Bucket: file.bucket || file.Bucket,
			Key: file.key || file.Key,
			Range: file.range || undefined
		}).createReadStream();
	},
	asEvent: function(opts) {
		opts = merge({
			id: "unknown"
		}, opts);
		if (typeof opts.kinesis_number != "function") {
			var kn = opts.kinesis_number;
			opts.kinesis_number = function() {
				return kn;
			};
		}
		return ls.through((data, done) => {
			done(null, {
				id: opts.id,
				event: opts.event,
				payload: data,
				kinesis_number: opts.kinesis_number(data)
			});
		});
	},
	log: function(prefix) {
		var log = console.log;
		if (prefix) {
			log = function() {
				console.log.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
			};
		}
		return ls.through({
			cmd: (obj, done) => {
				if (typeof obj == "string") {
					log(obj);
				} else {
					log(JSON.stringify(obj, null, 2));
				}
				done(null, obj);
			}
		}, (obj, callback) => {
			if (typeof obj == "string") {
				log(obj);
			} else {
				log(JSON.stringify(obj, null, 2));
			}
			callback(null, obj);
		});
	},
	devnull: function(shouldLog = false) {
		let s = new stream.Writable({
			objectMode: true,
			write(chunk, encoding, callback) {
				callback();
			}
		});
		if (shouldLog) {
			return ls.pipeline(ls.log(shouldLog === true ? "devnull" : shouldLog), s);
		} else {
			return s;
		}
	},
	counter: function(label, records = 10000) {
		if (typeof label === "number") {
			records = label;
			label = null;
		}
		if (label != null) {
			label += " ";
		} else {
			label = "";
		}
		let count = 0;
		let bytes = 0;
		let start = Date.now();
		let lastEid = "";

		let calcRPS = function(count, bytes, duration) {
			let rps = (count / (duration / 1000));
			let bps = (bytes / (duration / 1000));
			let r = {
				rps: "",
				bps: "",
				rpsNum: rps,
				bpsNum: bps,
				totalRecords: count,
				totalBytes: bytes,
				duration,
				lastEid
			};
			if (rps > 0) {
				r.rps = Math.floor(rps).toString();
			} else {
				r.rps = rps.toFixed(2);
			}
			if (bps > 0) {
				r.bps = Math.floor(bps).toString();
			} else {
				r.bps = bps.toFixed(2);
			}
			return r;
		};
		let getMessage = function() {
			let now = Date.now();
			let duration = now - start;

			let rps = calcRPS(count, bytes, duration);
			ret.counterData = rps;
			return `${label}${count} RPS: ${rps.rps} BPS: ${rps.bps} ${duration}ms ${lastEid || ""}`;
		};

		let ret = ls.through((o, d) => {
			let prevCount = count;
			count += o.records ?? 1;
			bytes += o.size ?? 0;
			lastEid = o.eid;

			((count % records === 0) || (count % records < prevCount % records)) && console.log(getMessage());
			d(null, o);
		}, (d) => {
			console.log("Total", getMessage());
			d();
		});
		return ret;
	},
	process: function(id, func, outQueue) {
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
			func(obj.payload, obj, (err, r, rOpts) => {
				rOpts = rOpts || {};
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
	batch: function(opts) {
		if (typeof opts === "number") {
			opts = {
				count: opts
			};
		}
		opts = merge({
			count: undefined,
			bytes: undefined,
			time: undefined,
			highWaterMark: 2
		}, opts);

		var buffer = [];

		logger.debug("Batch Options", opts);

		let push = (stream, data) => {

			if (buffer.length) {
				let payload = buffer.splice(0);
				let first = payload[0].correlation_id || {};
				let last = payload[payload.length - 1].correlation_id || {};
				let correlation_id = {
					source: first.source,
					start: first.start,
					end: last.end || last.start,
					units: payload.length
				};
				stream.push({
					id: payload[0].id,
					payload: payload,
					bytes: data.size,
					correlation_id: correlation_id,
					event_source_timestamp: payload[0].event_source_timestamp,
					timestamp: payload[payload.length - 1].timestamp,
					event: payload[0].event,
					eid: payload[payload.length - 1].eid,
					units: payload.length
				});
			}
		};
		var stream = ls.buffer({
			label: "batch",
			time: opts.time,
			size: opts.size || opts.bytes,
			records: opts.records || opts.count,
			buffer: opts.buffer,
			highWaterMark: opts.highWaterMark,
			debug: opts.debug
		}, function(obj, callback) {
			let size = 0;
			if (typeof obj === "string") {
				size += Buffer.byteLength(obj);
			} else if (opts.field) {
				var o = obj && obj[opts.field];
				size += Buffer.byteLength(typeof o === "string" ? o : JSON.stringify(o));
			} else {
				size += Buffer.byteLength(JSON.stringify(obj));
			}

			buffer.push(obj);
			callback(null, {
				size: size,
				records: 1
			});
		}, function emit(callback, data) {
			push(stream, data);
			callback();
		}, function flush(callback) {
			logger.debug("Batch On Flush");
			callback();
		});
		stream.options = opts;
		return stream;
	},
	joinExternal: function(fetcher) {
		return ls.pipeline(
			ls.batch({
				count: 1000,
				bytes: Number.POSITIVE_INFINITY,
				time: {
					seconds: 60
				},
				...fetcher.batchOptions
			}),
			ls.through(function(event, done) {
				// Because of the batch step payload is an array of full event
				fetcher.join(event.payload).then((joinedData) => {
					joinedData.forEach(e => {
						this.push(e);
					});
					done();
				}).catch(done);
			})
		);
	}
};
