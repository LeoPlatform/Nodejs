"use strict";
var moment = require("moment");
var chunkEventStream = require("./chunkEventStream.js");

const logger = require("../../logger")("leoS3");

var pad = "0000000";
var padLength = -1 * pad.length;
module.exports = function(ls, queue, configure) {
	var s3, count, e;
	configure = Object.assign({
		useS3Mode: true,
		debug: false,
		time: {
			seconds: 6
		}
	}, configure || {});
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

	function submit(stream, buildNewStream, done) {
		logger.info("submitting");
		let evnt = e;
		submitStream((err) => {
			if (err) {
				logger.error(err);
				done(err);
			} else {
				if (evnt.records > 0) {
					stream.push(evnt);
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
		let newFile = `bus/${queue}/z/${timestamp.format("YYYY/MM/DD/HH/mm/")+timestamp.valueOf()}-${postfix}`;
		s3 = ls.toS3(configure.bus.s3, newFile);
		e = {
			event: queue,
			start: 0,
			end: null,
			s3: {
				bucket: configure.bus.s3,
				key: newFile
			},
			offsets: [],
			gzipSize: 0,
			size: 0,
			records: 0,
			stats: {}
		};
		count = 0;
	}
	newStream();
	return ls.pipeline(chunkEventStream(ls, queue, configure), ls.through(function write(obj, done) {
		if (obj.s3) {
			submit(this, true, (err) => {
				if (!err) {
					this.push(obj);
				}
				done(err);
			});
		} else {
			//The previous stream is ready to be submitted
			var noBackPressure = s3.write(obj.gzip);
			delete obj.gzip;

			obj.offset = e.size;
			obj.gzipOffset = e.gzipSize;
			obj.start = e.records + obj.start;
			obj.end = e.records + obj.end;

			e.size += obj.size;
			e.gzipSize += obj.gzipSize;
			e.records += obj.records;
			e.end = obj.end;

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

			delete obj.stats;
			delete obj.correlations;
			e.offsets.push(obj);

			if (!noBackPressure) {
				s3.once('drain', () => {
					if (++count >= 10) {
						submit(this, true, (err) => {
							done(err);
						});
					} else {
						done();
					}
				});
			} else {
				if (++count >= 10) {
					submit(this, true, (err) => {
						done(err);
					});
				} else {
					done();
				}
			}
		}
	}, function flush(done) {
		logger.info("got flush", count);
		submit(this, false, (err) => {
			done(err);
		});
	}));
};