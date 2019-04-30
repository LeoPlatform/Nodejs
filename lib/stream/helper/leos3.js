"use strict";
var moment = require("moment");
var chunkEventStream = require("./chunkEventStream.js");

const logger = require("../../logger")("leoS3");

var pad = "0000000";
var padLength = -1 * pad.length;
module.exports = function(ls, queue, configure, opts, onFlush) {
	var s3, count, e;
	opts = Object.assign({
		useS3Mode: true,
		debug: false,
		time: {
			seconds: 10
		},
		archive: false,
		sectionCount: 10
	}, opts || {});
	let fileCount = 0;

	function submitStream(callback) {
		if (count > 0) {
			s3.on("finish", (err) => {
				logger.error(err);
				logger.debug("UPLOADED FILE");
				callback(err);
			});
			s3.end();
		} else {
			callback();
		}
	}

	function submit(stream, buildNewStream, push, done) {
		logger.info("submitting");
		let evnt = e;
		submitStream((err) => {
			if (err) {
				logger.error(err);
				done(err);
			} else {
				if (evnt.correlations.length) {
					push(evnt);
				}
				done();
			}
		});
		if (buildNewStream) {
			newStream();
		} else {
			s3 = null;
		}
	}

	function newStream() {
		var timestamp = moment();
		let postfix = (pad + (++fileCount)).slice(padLength);
		let newFile;
		if (opts.archive) {
			newFile = `bus/_archive/q=${queue}/dt=${timestamp.format("YYYY-MM-DD")}/${timestamp.valueOf()}-${postfix}.gz`;
		} else if (opts.prefix) {
			newFile = `bus/${queue}/${opts.prefix}/${timestamp.valueOf()}-${postfix}.gz`;
		} else {
			newFile = `bus/${queue}/z/${timestamp.format("YYYY/MM/DD/HH/mm/")+timestamp.valueOf()}-${postfix}.gz`;
		}

		logger.info("S3 Location:", newFile);
		s3 = ls.toS3(configure.resources.LeoS3 || configure.s3, newFile);
		e = {
			event: queue,
			start: null,
			end: null,
			s3: {
				bucket: configure.resources.LeoS3 || configure.s3,
				key: newFile
			},
			offsets: [],
			gzipSize: 0,
			size: 0,
			records: 0,
			stats: {},
			correlations: []
		};
		count = 0;
	}
	newStream();
	var stream = ls.buffer({
		label: "toS3",
		time: Infinity, //We want the time passed through to chunkEventStream, not to here.
		size: opts.size,
		records: opts.sectionCount,
		buffer: opts.buffer,
	}, function(obj, done) {
		if (obj.s3) {
			this.flush((err) => {
				if (!err && !!obj.size) {
					this.push(obj);
				}
				done(err);
			});
		} else {
			//The previous stream is ready to be submitted
			var noBackPressure = true;
			if (!!obj.size) {
				count++;
				noBackPressure = s3.write(obj.gzip);

				obj.offset = e.size;
				obj.gzipOffset = e.gzipSize;
				if (!opts.archive) {
					obj.start = e.records + obj.start;
					obj.end = e.records + obj.end;
					e.end = obj.end;
				} else {
					if (!e.start) {
						e.start = obj.start;
					}
					e.end = obj.end;
					e.archive = true;
				}

				e.size += obj.size;
				e.gzipSize += obj.gzipSize;
				e.records += obj.records;
				e.offsets.push(obj);
			}

			for (var botid in obj.stats) {
				if (!(botid in e.stats)) {
					e.stats[botid] = obj.stats[botid];
				} else {
					var s = e.stats[botid];
					var r = obj.stats[botid];
					s.units += r.units;
					s.start = r.start;
					s.end = r.end;
					s.checkpoint = r.checkpoint;
				}
			}
			e.correlations = e.correlations.concat(obj.correlations);

			delete obj.gzip;
			delete obj.stats;
			delete obj.correlations;

			if (!noBackPressure) {
				s3.once('drain', () => {
					done(null, {
						size: 1,
						records: 1
					});
				});
			} else {
				done(null, {
					size: 1,
					records: 1
				});
			}
		}
	}, function(done) {
		submit(this, true, this.push.bind(this), (err) => {
			done(err);
		});
	}, function(done) {
		logger.info("got flush");
		submit(this, false, this.push.bind(this), (err) => {
			if (onFlush) {
				onFlush(done, this.push.bind(this));
			} else {
				done(err);
			}
		});
	});

	return ls.pipeline(chunkEventStream(ls, queue, opts), stream);
};
