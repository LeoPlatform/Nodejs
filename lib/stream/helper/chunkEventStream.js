'use strict';
const logger = require('leo-logger')('chunkEventStream');
const refUtil = require('../../reference.js');
const zlib = require('zlib');

module.exports = function(ls, event, opts) {
	var tenMB = 1024 * 1024 * 10;
	var twoHundredK = 1024 * 200;
	opts = Object.assign({
		records: (opts && opts.records) || (opts && opts.useS3Mode ? Number.POSITIVE_INFINITY : 2000),
		size: (opts && opts.size) || (opts && opts.useS3Mode ? tenMB : twoHundredK),
		time: (opts && opts.time) || {
			seconds: opts && opts.useS3Mode ? 10 : (200 / 1000)
		},
		archive: false,
		debug: false,
		gzip: true,
		snapshot: undefined
	}, opts || {});

	var item, gzip;
	var totalWrites = 0;
	var totalRecords = 0;

	function resetGzip() {
		item = {
			event: event,
			gzip: Buffer.from(''),
			start: opts.archive ? null : 0,
			end: null,
			records: 0,
			size: 0,
			gzipSize: 0,
			stats: {},
			correlations: {}
		};
		gzip = opts.gzip ? zlib.createGzip() : require("stream").PassThrough();

		gzip.on('data', function(chunk) {
			item.gzip = Buffer.concat([item.gzip, chunk]);
			item.gzipSize += Buffer.byteLength(chunk);
		});
	}
	resetGzip();

	function emitChunk(last, callback) {
		gzip.once('end', () => {
			logger.debug(`Byte ratio  ${Buffer.byteLength(item.gzip)}/${item.size}  ${Buffer.byteLength(item.gzip) / item.size}`);
			logger.debug(`Capacity ratio  ${Math.ceil(Buffer.byteLength(item.gzip) / 1024)}/${item.records}  ${Math.ceil(Buffer.byteLength(item.gzip) / 1024) / item.records}`);
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
				correlations: item.correlations,
				snapshot: opts.snapshot
			};
			if (!last) {
				resetGzip();
			}
			callback(i);
		});
		gzip.end();
	}

	var eventStream = ls.buffer({
		label: "chunkEventStream",
		time: opts.time,
		size: opts.size,
		records: opts.records,
		buffer: opts.buffer,
		debug: opts.debug,
		addBufferDuration: opts.addBufferDuration
	}, function write(record, done) {
		let timestamp = record.timestamp = record.timestamp || Date.now();
		let start = record.event_source_timestamp = (record.event_source_timestamp || timestamp);

		function updateStats(id, stats) {
			if (!(id in item.stats)) {
				item.stats[id] = {
					start: 0,
					end: 0,
					units: 0,
					checkpoint: null,
					queues: {}
				};
			}
			let eventData = item.stats[id];
			eventData.units += (stats.units || 1);
			eventData.start = Math.max(start, eventData.start);
			eventData.end = Math.max(timestamp, eventData.end);
			eventData.checkpoint = stats.checkpoint || stats.eid;
			eventData.queues[stats.event] = (eventData.queues[stats.event] || 0) + ((stats.units != null) ? stats.units : 1);
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

				// Allow for partial start and end so we see correlation but don't checkpoint
				if (!c.start && c.partial_start) {
					c.start = c.partial_start;
					delete c.partial_start;
				}
				if (!c.end && c.partial_end) {
					c.end = c.partial_end;
					delete c.partial_end;
				}
			}
		}

		//If there is no payload but there is a correlation_id then we just need to skip this record but store the checkpoint as processed
		if ((!record.payload || record.dont_write === true) && record.correlation_id) {
			updateCorrelation(record.correlation_id);
			done(null, {});
			return;
		}

		if (record.s3) {
			if (opts.snapshot) {
				record.snapshot = opts.snapshot;
			}
			this.flush(() => {
				for (var id in record.stats) {
					updateStats(id, record.stats[id]);
				}
				this.push(record);
				done();
			});
		} else {
			if (opts.archive) {
				if (!item.start) {
					item.start = record.eid;
				}
				item.end = record.eid;
				item.records++;
			} else {
				item.end = record.eid = item.records++;
			}

			updateStats(record.id, record);
			updateCorrelation(record.correlation_id);

			var d = JSON.stringify(record) + "\n";
			var s = Buffer.byteLength(d);

			if (!opts.useS3Mode && s > opts.size * 3) {
				var newR = Object.assign({}, record, {
					event: refUtil.botRef(record.id).queue("error"),
					payload: {
						size: s,
						maxSize: opts.size * 3,
						error: `Event was too large ${s} > ${opts.size * 3}`,
						preview: d.substr(0, 2000)
					}
				});
				logger.log(newR.payload.error, `skipping`, record.id, record.eid, record.correlation_id, newR.payload.preview);

				d = JSON.stringify(newR) + "\n";
				s = Buffer.byteLength(d);

			}
			item.size += s;

			if (!gzip.write(d)) {
				gzip.once('drain', () => {
					done(null, {
						size: s,
						records: 1
					});
				});
			} else {
				done(null, {
					size: s,
					records: 1
				});
			}
		}
	}, function emit(done, data) {
		emitChunk(data.isLast, (value) => {
			if (value && (value.size || (value.correlations && Object.keys(value.correlations).length))) {
				this.push(value);
			}
			done();
		});
	}, function end(done) {
		logger.debug("done chunking");
		logger.debug("total", totalWrites, totalRecords, totalWrites / totalRecords);
		done();
	});

	return eventStream;
};
