"use strict";
var moment = require("moment");
var chunkEventStream = require("./chunkEventStream.js");

var pad = "0000000";
var padLength = -1 * pad.length;
module.exports = function (ls, queue, configure) {
	var s3, count, e;
	configure = Object.assign({
		debug: false,
		time: {
			seconds: 10
		}
	}, configure || {});
	let timeout;
	let fileCount = 0;

	function submitStream(callback) {
		if (count > 0) {
			s3.on("finish", (err) => {
				err && console.log(err);
				configure.debug && console.log("UPLOADED FILE");
				callback(err);
			});
			s3.end();
		} else {
			callback();
		}
	}

	function submit(stream, buildNewStream, done) {

		clearTimeout(timeout);
		timeout = null;
		let evnt = e;
		submitStream((err) => {
			if (err) {
				console.log(err);
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
		let newFile = `bus_v2/${queue}/z/${timestamp.format("YYYY/MM/DD/HH/mm/")+timestamp.valueOf()}-${postfix}`;
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
	return ls.pipeline(chunkEventStream(ls, queue, {
		useS3Mode: true,
		debug: configure.debug
	}), ls.through(function write(obj, done) {
		if (obj.s3) {
			submit(this, true, (err) => {
				if (!err) {
					this.push(obj);
				}
				done(err);
			});
		} else {
			//The previous stream is ready to be submitted
			s3.write(obj.gzip);
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

			if (!timeout && configure.time) {
				let self = this;
				timeout = setTimeout(() => {
					submit(self, true, (err) => {
						if (err) {
							self.emit("error", err);
						}
					});
				}, moment.duration(configure.time).asMilliseconds());
			}

			if (++count >= 10) {
				submit(this, true, (err) => {
					done(err);
				});
			} else {
				done();
			}
		}
	}, function flush(done) {
		submit(this, false, (err) => {
			done(err);
		});
	}));
};