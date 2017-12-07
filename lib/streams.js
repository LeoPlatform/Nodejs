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

const logger = require("./logger")("stream");

let ls = module.exports = {
	through: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}
		return through(opts, function(obj, enc, done) {
			try {
				func.call(this, obj, done, this.push.bind(this));
			} catch (err) {
				logger.error(err);
				done(err);
			}
		}, flush ? function(done) {
			flush.call(this, done);
		} : null);
	},
	writeWrapped: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}
		return write.obj(opts, function(obj, enc, done) {
			try {
				func.call(this, obj, done);
			} catch (err) {
				logger.error(err);
				done(err);
			}
		}, flush ? function(done) {
			flush.call(this, done);
		} : null);
	},
	buffer: (opts, each, emit, flush) => {
		opts = Object.assign({
			time: {
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

		let label = opts.label ? (opts.label + ' ') : ''
		var emitting = false;
		var size = 0;
		var records = 0;
		var timeout = null;

		var buffered = null;

		let isSizeConstrained = false;
		let isRecordConstrained = false;
		let isTimeConstrained = false;

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
				logger.debug(`${label}emitting ${last?'due to stream end':''} ${isSizeConstrained?'due to size':''} ${isTimeConstrained?'due to time':''}  ${isRecordConstrained?'due to record count':''}  records:${records} size:${size}`);
				emitting = true;
				let data = {
					records: records,
					size: size,
					isLast: last
				};
				reset();

				emit.call(stream, (err, obj) => {
					emitting = false;
					logger.debug(label + "emitting done");
					if (obj != undefined) {
						stream.push(obj)
					}
					if (done) {
						done(err);
					} else if (err) {
						stream.emit("error", err);
					}
					if (buffered) {
						logger.debug(label + "had a buffered one");
						doEach(buffered.o, buffered.done);
						buffered = null;
					}
				}, data);
			} else {
				logger.debug(label + "Stream ended");
				done(null, null);
			}
		}

		function doEach(o, done) {
			each.call(stream, o, (err, obj) => {
				if (obj) {
					if (obj.reset === true) {
						reset();
					}
					records += obj.records || 1;
					size += obj.size || 1;
					if (!timeout) {
						timeout = setTimeout(() => {
							isTimeConstrained = true;
							doEmit(false);
						}, Math.min(2147483647, moment.duration(opts.time).asMilliseconds())); // Max value allowed by setTimeout 
					}
					isSizeConstrained = size >= opts.size;
					isRecordConstrained = records >= opts.records;
					if (isSizeConstrained || isRecordConstrained || obj.flush === true) {
						doEmit(false, done);
					} else {
						done(err, null);
					}
				} else {
					done(err, null);
				}
			});
		}
		var stream = streamType(function(o, done) {
			if (emitting) {
				buffered = {
					o: o,
					done: done
				};
			} else {
				doEach(o, done);
			}
		}, (done) => {
			doEmit(true, () => {
				if (flush) {
					flush(done);
				} else {
					done();
				}
			})
		});

		stream.reset = reset;
		stream.flush = function(done) {
			doEmit(false, done);
		};
		return stream;
	},
	pipeline: pumpify,
	split: split,
	gzip: zlib.createGzip,
	gunzip: zlib.createGunzip,
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
					done(err);
					return;
				}
				done(null, obj);
			}
		}));
	},
	fromCSV: function(fieldList, opts) {
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
			logger.error(arguments);
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
		opts = Object.assign({}, opts);
		return (opts.s3 || s3).getObject({
			Bucket: file.bucket || file.Bucket,
			Key: file.key || file.Key,
			Range: file.range || undefined
		}).createReadStream();
	},
	asEvent: function(opts) {
		opts = Object.assign({
			id: "unknown"
		}, opts);
		if (typeof opts.kinesis_number != "function") {
			var kn = opts.kinesis_number;
			opts.kinesis_number = function() {
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
	log: function(prefix) {
		var log = console.log;
		if (prefix) {
			log = function() {
				console.log.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
			}
		}
		return through(function(obj, enc, callback) {
			if (typeof obj == "string") {
				log(obj);
			} else {
				log(JSON.stringify(obj, null, 2));
			}
			callback(null, obj);
		});
	},
	devnull: function() {
		return new stream.Writable({
			objectMode: true,
			write(chunk, encoding, callback) {
				callback();
			}
		});
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
		opts = Object.assign({
			count: undefined,
			bytes: undefined,
			time: undefined
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

};