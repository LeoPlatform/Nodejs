"use strict";
var zlib = require("zlib");
var moment = require("moment");

module.exports = function (ls, event, opts) {
	var tenMB = 1024 * 1024 * 10;
	var twoHundredK = 1024 * 200;
	opts = Object.assign({
		records: opts && opts.useS3Mode ? Number.POSITIVE_INFINITY : 2000,
		size: opts && opts.useS3Mode ? tenMB : twoHundredK,
		time: {
			seconds: opts && opts.useS3Mode ? 300 : 10
		},
		archive: false,
		debug: false
	}, opts || {});
	var item, gzip;
	var totalWrites = 0;
	var totalRecords = 0;

	function resetGzip() {
		item = {
			event: event,
			gzip: new Buffer(0),
			start: opts.isArchive ? null : 0,
			end: null,
			records: 0,
			size: 0,
			gzipSize: 0,
			stats: {},
			correlations: {}
		};
		gzip = zlib.createGzip();

		gzip.on('data', function (chunk) {
			item.gzip = Buffer.concat([item.gzip, chunk]);
			item.gzipSize += Buffer.byteLength(chunk);
		});
	}
	resetGzip();

	var timeTrigger = false;
	var timeout = null;

	function emitChunk(last, callback) {
		opts.debug && console.log(`emitting ${last?'due to stream end':''} ${item.size>opts.size?'due to size':''} ${timeTrigger?'due to time':''}  ${item.records>opts.records?'due to record count':''}  records:${item.records} size:${item.size}`);
		timeTrigger = false;
		clearTimeout(timeout);
		timeout = null;
		gzip.end();
		gzip.once('end', () => {
			opts.debug && console.log(`Byte ratio  ${Buffer.byteLength(item.gzip)}/${item.size}  ${Buffer.byteLength(item.gzip)/item.size}`);
			opts.debug && console.log(`Capacity ratio  ${Math.ceil(Buffer.byteLength(item.gzip)/1024)}/${item.records}  ${Math.ceil(Buffer.byteLength(item.gzip)/1024)/item.records}`);
			totalWrites += Math.ceil(Buffer.byteLength(item.gzip) / 1024);
			totalRecords += item.records;
			var i = {
				event: item.event,
				start: item.start,
				end: item.end,
				records: item.records,
				gzip: item.gzip,
				gzipSize: item.gzipSize,
				size: item.size,
				stats: item.stats,
				correlations: item.correlations
			};
			if (!last) {
				resetGzip();
			}
			callback(i);
		});
	}

	var eventStream = ls.through(function write(record, done) {
			// opts.debug && console.log(record);
			let timestamp = record.timestamp || Date.now();
			let start = (record.event_source_timestamp || timestamp);

			if (!timeout) { //make sure no event gets too old
				timeout = setTimeout(() => {
					timeTrigger = true;
				}, moment.duration(opts.time).asMilliseconds());
			}

			function updateStats(id, stats) {
				if (!(id in item.stats)) {
					item.stats[id] = {
						start: 0,
						end: 0,
						units: 0,
						checkpoint: null
					};
				}
				let eventData = item.stats[record.id];
				eventData.units += (stats.units || 1);
				eventData.start = Math.max(start, eventData.start);
				eventData.end = Math.max(timestamp, eventData.end);
				eventData.checkpoint = stats.checkpoint || stats.eid;
			}

			function updateCorrelation(c) {
				if (c) {
					var source = c.source;
					if (!(source in item.correlations)) {
						item.correlations[source] = {
							source: source,
							start: null,
							end: null,
							records: 0,
							source_timestamp: start,
							timestamp: timestamp
						};
					}
					let correlation = item.correlations[source];
					correlation.end = c.end || c.start;
					correlation.records += c.units || 1;
					if (!correlation.start) {
						correlation.start = c.start;
					}
					correlation.source_timestamp = start;
					correlation.timestamp = timestamp;
				}
			}

			//If there is no payload but there is a correlation_id then we just need to skip this record but store the checkpoint as processed
			if (!record.payload && record.correlation_id) {
				updateCorrelation(record.correlation_id);
				done();
				return;
			}

			/**
			 * @todo  Check if this is a special S3 record and log it by itself
			 * PSEUDO CODE, never tested
			 */
			if (record.s3) {
				for (var id in record.stats) {
					updateStats(id, record.stats[id]);
				}
				delete record.stats;
				if (item.size) {
					emitChunk(false, (value) => {
						this.push(value);
						done(null, record);
					});
				} else {
					done(null, record);
				}
			} else {
				if (opts.isArchive) { //Then we want to use the original kinesis_number
					if (!item.start) {
						item.start = record.eid;
					}
					item.end = record.eid;
				} else {
					item.end = record.eid = item.records++;
				}

				updateStats(record.id, record);
				updateCorrelation(record.correlation_id);

				var d = JSON.stringify(record) + "\n";
				item.size += Buffer.byteLength(d);

				if (!gzip.write(d)) {
					gzip.once('drain', () => {
						if (item.size >= opts.size || timeTrigger || item.records >= opts.records) {
							emitChunk(false, (value) => {
								done(null, value);
							});
						} else {
							done();
						}
					});
				} else if (item.size >= opts.size || timeTrigger || item.records >= opts.records) {
					emitChunk(false, (value) => {
						done(null, value);
					});
				} else {
					done();
				}
			}
		},
		function end(done) {
			emitChunk(true, (value) => {
				this.push(value);
				opts.debug && console.log("done chunking");
				opts.debug && console.log("total", totalWrites, totalRecords, totalWrites / totalRecords);
				done();
			});
		});

	return eventStream;
};