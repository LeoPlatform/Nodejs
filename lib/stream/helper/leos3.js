"use strict";
var moment = require("moment");
var chunkEventStream = require("./chunkEventStream.js");

module.exports = function (ls, queue, configure) {
	var timestamp = moment();
	var s3, count, e;
	configure = Object.assign({
		debug: false
	}, configure || {});

	function submitStream(callback) {
		if (count > 0) {
			s3.on("finish", (err) => {
				console.log(err);
				configure.debug && console.log("UPLOADED FILE");

				s3 = null;
				callback(err);
			});
			s3.end();
		} else {
			callback();
		}
	}

	function newStream() {
		let newFile = `bus_v2/${queue}/z/${timestamp.format("YYYY/MM/DD/HH/mm/")+timestamp.valueOf()}`;
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
			submitStream((err) => {
				if (err) {
					console.log(err);
					done(err);
				} else {
					if (count > 0) {
						this.push(e);
					}
					this.push(obj)
					newStream();
					done();
				}
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

			if (++count >= 10) {
				submitStream((err) => {
					if (err) {
						done(err);
					} else {
						this.push(e);
						newStream();
						done();
					}
				});
			} else {
				done();
			}
		}
	}, function flush(done) {
		submitStream((err) => {
			if (err) {
				console.log("Error Ending Stream:", err);
				done(err);
			} else {
				if (count > 0) {
					this.push(e);
				}
				done();
			}
		});
	}));
};