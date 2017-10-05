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
// var async = require("async");

var backoff = require("backoff");

var refUtil = require("./reference.js");

let ls = module.exports = {
	through: (opts, func, flush) => {
		if (typeof opts === "function") {
			flush = flush || func;
			func = opts;
			opts = undefined;
		}
		return through(opts, function (obj, enc, done) {
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
					console.log(err, obj);
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
	log: function (prefix) {
		var log = console.log;
		if (prefix) {
			log = () => {
				console.log.apply(null, [prefix].concat(arguments));
			}
		}
		return through(function (obj, enc, callback) {
			if (typeof obj == "string") {
				log(obj);
			} else {
				log(JSON.stringify(obj, null, 2));
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
		var timeout;

		opts.debug && console.log("Batch Options", opts);

		let push = (stream) => {
			clearTimeout(timeout);
			timeout = null;

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
					bytes: size,
					correlation_id: correlation_id,
					event_source_timestamp: payload[0].event_source_timestamp,
					timestamp: payload[payload.length - 1].timestamp
				});
				size = 0;
			}
		};
		var stream = ls.through(function (obj, callback) {

			if (typeof obj === "string") {
				size += Buffer.byteLength(obj);
			} else if (opts.field) {
				var o = obj && obj[opts.field];
				size += Buffer.byteLength(typeof o === "string" ? o : JSON.stringify(o));
			} else {
				size += Buffer.byteLength(JSON.stringify(obj));
			}

			buffer.push(obj);

			if (!timeout && opts.time) { //make sure no event gets too old
				timeout = setTimeout(() => {
					push(this);
				}, moment.duration(opts.time).asMilliseconds());
			}

			if ((opts.bytes && size >= opts.bytes) || (opts.count && buffer.length >= opts.count) || (!opts.bytes && !opts.count)) {
				opts.debug && console.log("Batch", buffer.length, opts.count, size, opts.bytes)
				push(this);
			}
			callback();
		}, function flush(callback) {
			opts.debug && console.log("Batch On Flush");
			push(this);
			callback();
		});
		stream.options = opts;
		return stream;
	},

};