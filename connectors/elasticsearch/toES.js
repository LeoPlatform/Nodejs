'use strict';

const aws = require('../../lib/leo-aws');
const extend = require('extend');
const elasticsearch = require('elasticsearch');
const refUtil = require('../../lib/reference.js');
const moment = require('moment');
const https = require('https');
const async = require('async');
const logger = require('leo-logger');

module.exports = function (configure) {
	configure = configure || {};
	let leo = require('../../index')(configure);
	let ls = leo.streams;

	const s3 = new aws.S3({
		apiVersion: '2006-03-01',
		credentials: configure.credentials,
		httpOptions: {
			agent: new https.Agent({
				keepAlive: true,
			}),
		},
	});

	function getClient (settings) {
		let client;
		if (settings.client) {
			client = settings.client;
		} else {
			let config = new aws.Config({
				credentials: configure.credentials,
				region: configure.aws.region,
			});
			let esSettings = extend(true, {
				awsConfig: config,
				connectionClass: require('http-aws-es'),
			}, settings);
			client = elasticsearch.Client(esSettings);
		}

		return client;
	}

	let self = {
		stream: function (settings) {
			let connection = settings.connection || settings;
			let client = getClient(connection);
			let requireType = settings.requireType || false;
			let total = settings.startTotal || 0;
			let fileCount = 0;
			let format = ls.through({
				highWaterMark: 16
			}, function (event, done) {
				let data = event.payload || event;

				if (!data || !data.index || (requireType && !data.type) || !data.id) {
					logger.error('Invalid data. index, type, & id are required', JSON.stringify(data || ''));
					done('Invalid data. index, type, & id are required ' + JSON.stringify(data || ''));
					return;
				}
				let meta = Object.assign({}, event);
				delete meta.payload;
				const deleteByQuery = [];
				if (data.delete) {
					if (!data.field || data.field === '_id') {
						this.push(meta, {
							delete: {
								_id: data.id,
								_index: data.index,
								_type: data.type,
							},
						});
					} else {
						const ids = Array.isArray(data.id) ? data.id : [data.id];
						const size = ids.length;
						const chunk = 1000;
						for (let i = 0; i < size; i += chunk) {
							deleteByQuery.push({
								index: data.index,
								query: {
									terms: {
										[data.field]: ids.slice(i, i + chunk),
									},
								},
								type: data.type,
							});
						}
					}
				} else {
					this.push(meta, {
						update: {
							_id: data.id,
							_index: data.index,
							_type: data.type,
						},
					}, {
						doc: data.doc,
						doc_as_upsert: true,
					});
				}
				if (deleteByQuery.length) {
					self.getIds(deleteByQuery, client, (err, ids) => {
						if (err) {
							done(err);
						} else {
							ids.forEach(id => this.push(meta, {
								delete: {
									_id: id,
									_index: data.index,
									_type: data.type,
								},
							}));
							this.push(meta);
							done();
						}
					});
				} else {
					done();
				}
			}, function flush (callback) {
				logger.debug('Transform: On Flush');
				callback();
			});

			format.push = (function (self, push) {
				return function (meta, command, data) {
					if (meta == null) {
						push.call(self, null);
						return;
					}
					let result = '';
					if (command != undefined) {
						result = JSON.stringify(command) + '\n';
						if (data) {
							result += JSON.stringify(data) + '\n';
						}
					}
					push.call(self, Object.assign({}, meta, {
						payload: result,
					}));
				};
			})(format, format.push);

			let systemRef = refUtil.ref(settings.system, 'system');
			let send = ls.through({
				highWaterMark: 16,
			}, (input, done) => {
				if (input.payload && input.payload.length) {
					let meta = Object.assign({}, input);
					meta.event = systemRef.refId();
					delete meta.payload;

					total += input.payload.length;
					settings.logSummary && logger.info('ES Object Size:', input.bytes, input.payload.length, total);
					let body = input.payload.map(a => a.payload).join('');
					if (process.env.dryrun) {
						done(null, Object.assign(meta, {
							payload: {
								body,
								response: data,
							},
						}));
					} else {
						if (!body.length) {
							done(null, Object.assign(meta, {
								payload: {
									message: 'All deletes.  No body to run.',
								},
							}));
							return;
						}
						client.bulk({
							_source: false,
							body,
							fields: settings.fieldsUndefined ? undefined : false,
						}, function (err, data) {
							if (err || data.errors) {
								if (data && data.Message) {
									err = data.Message;
								} else if (data && data.items) {
									logger.error(data.items.filter((r) => {
										return 'error' in r.update;
									}).map(e => JSON.stringify(e, null, 2)));
									err = 'Cannot load';
								} else {
									logger.error(err);
									err = 'Cannot load';
								}
							}
							if (err) {
								logger.error(err);
							}

							let timestamp = moment();
							let rand = Math.floor(Math.random() * 1000000);
							let key = `files/elasticsearch/${(systemRef && systemRef.id) || 'unknown'}/${meta.id || 'unknown'}/${timestamp.format('YYYY/MM/DD/HH/mm/') + timestamp.valueOf()}-${++fileCount}-${rand}`;

							if (!settings.dontSaveResults) {
								logger.debug(leo.configuration.bus.s3, key);
								s3.upload({
									Body: JSON.stringify({
										body,
										response: data,
									}),
									Bucket: leo.configuration.bus.s3,
									Key: key,
								}, (uploaderr, data) => {
									done(err, Object.assign(meta, {
										payload: {
											error: err || undefined,
											file: data && data.Location,
											uploadError: uploaderr || undefined,
										},
									}));
								});
							} else {
								done(err);
							}
						});
					}
				} else {
					done();
				}
			}, function flush (callback) {
				logger.debug('Elasticsearch Upload: On Flush');
				callback();
			});

			return ls.pipeline(format, ls.batch({
				bytes: 10485760 * 0.95, // 9.5MB
				count: 1000,
				field: 'payload',
				time: {
					milliseconds: 200,
				},
			}), send);
		},

		streamParallel: function (settings) {
			let parallelLimit = (settings.warmParallelLimit != undefined ? settings.warmParallelLimit : settings.parallelLimit) || 1;
			let connection = settings.connection || settings;
			let client = getClient(connection);
			let requireType = settings.requireType || false;
			let total = settings.startTotal || 0;
			let startTime = Date.now();
			let duration = 0;
			let lastDuration = 0;
			let lastStartTime = Date.now();
			let lastAvg = 0;
			let fileCount = 0;
			let format = ls.through({
				highWaterMark: 16
			}, function (event, done) {
				let data = event.payload || event;

				if (!data || !data.index || (requireType && !data.type) || data.id == undefined) {
					logger.error('Invalid data. index, type, & id are required', JSON.stringify(data || ''));
					done('Invalid data. index, type, & id are required ' + JSON.stringify(data || ''));
					return;
				}
				let meta = Object.assign({}, event);
				delete meta.payload;
				const deleteByQuery = [];
				if (data.delete) {
					if (!data.field || data.field === '_id') {
						this.push(meta, {
							delete: {
								_id: data.id,
								_index: data.index,
								_type: data.type,
							},
						});
					} else {
						const ids = Array.isArray(data.id) ? data.id : [data.id];
						const size = ids.length;
						const chunk = 1000;
						for (let i = 0; i < size; i += chunk) {
							deleteByQuery.push({
								index: data.index,
								query: {
									terms: {
										[data.field]: ids.slice(i, i + chunk),
									},
								},
								type: data.type,
							});
						}
					}
				} else {
					this.push(meta, {
						update: {
							_id: data.id,
							_index: data.index,
							_type: data.type,
						}
					}, {
						doc: data.doc,
						doc_as_upsert: true,
					});
				}
				if (deleteByQuery.length) {
					self.getIds(deleteByQuery, client, (err, ids) => {
						if (err) {
							done(err);
						} else {
							ids.forEach(id => this.push(meta, {
								delete: {
									_id: id,
									_index: data.index,
									_type: data.type,
								},
							}));
							this.push(meta);
							done();
						}
					});
				} else {
					done();
				}
			}, function flush (callback) {
				logger.debug('Transform: On Flush');
				callback();
			});

			format.push = (function (self, push) {
				return function (meta, command, data) {
					if (meta == null) {
						push.call(self, null);
						return;
					}
					let result = '';
					if (command != undefined) {
						result = JSON.stringify(command) + '\n';
						if (data) {
							result += JSON.stringify(data) + '\n';
						}
					}
					push.call(self, Object.assign({}, meta, {
						payload: result
					}));
				};
			})(format, format.push);

			let systemRef = refUtil.ref(settings.system, 'system');
			let toSend = [];
			let firstStart = Date.now();

			let sendFunc = function (done) {
				parallelLimit = settings.parallelLimit || parallelLimit;
				batchStream.updateLimits(bufferOpts);
				let cnt = 0;
				logger.time('es_emit');
				let batchCnt = 0;
				lastDuration = 0;
				async.map(toSend, (input, done) => {
					let index = ++cnt + ' ';
					let meta = Object.assign({}, input);
					meta.event = systemRef.refId();
					delete meta.payload;

					settings.logSummary && logger.info(index + 'ES Object Size:', input.bytes, input.payload.length, total, (Date.now() - startTime) / total, lastAvg, Date.now() - firstStart, duration, duration / total);
					batchCnt += input.payload.length;
					total += input.payload.length;
					let body = input.payload.map(a => a.payload).join('');
					if (process.env.dryrun) {
						done(null, Object.assign(meta, {
							payload: {
								body: body,
								response: data
							}
						}));
					} else {
						if (!body.length) {
							done(null, Object.assign(meta, {
								payload: {
									message: 'All deletes.  No body to run.'
								}
							}));
							return;
						}
						logger.time(index + 'es_emit');
						logger.time(index + 'es_bulk');
						client.bulk({
							body: body,
							fields: settings.fieldsUndefined ? undefined : false,
							_source: false
						}, function (err, data) {
							logger.timeEnd(index + 'es_bulk');
							logger.info(index, !err && data.took);

							if (data && data.took) {
								lastDuration = Math.max(lastDuration, data.took);
							}
							if (err || data.errors) {
								if (data && data.Message) {
									err = data.Message;
								} else if (data && data.items) {
									logger.error(data.items.filter((r) => {
										return 'error' in r.update;
									}).map(e => JSON.stringify(e, null, 2)));
									err = 'Cannot load';
								} else {
									logger.error(err);
									err = 'Cannot load';
								}
							}
							if (err) {
								logger.error(err);
							}

							let timestamp = moment();
							let rand = Math.floor(Math.random() * 1000000);
							let key = `files/elasticsearch/${(systemRef && systemRef.id) || 'unknown'}/${meta.id || 'unknown'}/${timestamp.format('YYYY/MM/DD/HH/mm/') + timestamp.valueOf()}-${++fileCount}-${rand}`;

							if (!settings.dontSaveResults) {

								logger.time(index + 'es_save');
								logger.debug(leo.configuration.bus.s3, key);
								s3.upload({
									Body: JSON.stringify({
										body,
										response: data,
									}),
									Bucket: leo.configuration.bus.s3,
									Key: key,
								}, (uploaderr, data) => {
									logger.timeEnd(index + 'es_save');
									logger.timeEnd(index + 'es_emit');
									done(err, Object.assign(meta, {
										payload: {
											error: err || undefined,
											file: data && data.Location,
											uploadError: uploaderr || undefined,
										},
									}));
								});
							} else {
								logger.timeEnd(index + 'es_emit');
								done(err, Object.assign(meta, {
									payload: {
										error: err || undefined,
									},
								}));
							}
						});
					}
				}, (err, results) => {
					toSend = [];
					if (!err) {
						results.map(r => {
							this.push(r);
						});
					}
					duration += lastDuration;
					lastAvg = (Date.now() - lastStartTime) / batchCnt;
					lastStartTime = Date.now();
					logger.timeEnd('es_emit');
					logger.info(lastAvg);
					done && done(err);
				});
			};
			let send = ls.through({
					highWaterMark: 16,
				}, function (input, done) {
					if (input.payload && input.payload.length) {
						toSend.push(input);
						if (toSend.length >= parallelLimit) {
							sendFunc.call(this, done);
						} else {
							done();
						}
					} else {
						done();
					}
				},
				function flush (callback) {
					logger.debug('Elasticsearch Upload: On Flush');
					if (toSend.length) {
						sendFunc.call(this, callback);
					} else {
						callback();
					}
				});

			let bufferOpts = typeof (settings.buffer) === 'object' ? settings.buffer : {
				records: settings.buffer || undefined
			};
			let batchStream = ls.batch({
				records: settings.warmup || bufferOpts.records,
				bytes: bufferOpts.bytes || 10485760 * 0.95, // 9.5MB
				time: bufferOpts.time || {
					milliseconds: 200
				},
				field: 'payload'
			});
			return ls.pipeline(format, batchStream, send);
		},

		getIds: function (queries, client, done) {
			// Run any deletes and finish
			var allIds = [];
			async.eachSeries(queries, (data, callback) => {
				this.query({
					index: data.index,
					type: data.type,
					query: data.query,
					source: ['_id'],
					scroll: '15s',
				}, {
					client: client
				}, (err, ids) => {
					if (err) {
						callback(err);
						return;
					}
					allIds = allIds.concat(ids.items.map(id => id._id));
					callback();
				});

			}, (err) => {
				if (err) {
					logger.error(err);
					done(err);
				} else {
					done(null, allIds);
				}
			});
		},
		query: function (data, settings, callback) {
			if (!callback) {
				callback = settings;
				settings = {};
			}

			const client = getClient(settings.connection || settings);
			const results = {
				items: [],
				qty: 0,
				scrolls: [],
				took: 0,
			};

			const max = (data.max >= 0) ? data.max : 100000;
			let transforms = {
				full: (item) => item,
				source: (item) => item._source,
			};

			let transform;
			if (typeof data.return === 'function') {
				transform = data.return;
			} else {
				transform = transforms[data.return || 'full'] || transforms.full;
			}

			let scroll = data.scroll;

			function getUntilDone (err, data) {
				if (err) {
					logger.error(err);
					callback(err);
					return;
				}
				if (data.aggregations) {
					results.aggregations = data.aggregations;
				}
				let info = data.hits;
				info.qty = info.hits.length;
				results.qty += info.qty;
				results.took += data.took;

				info.hits.forEach(item => {
					results.items.push(transform(item));
				});
				delete info.hits;

				results.total = info.total;
				results.scrolls.push(info);

				delete results.scrollid;

				if (info.qty > 0 && info.total !== results.qty) {
					results.scrollid = data._scroll_id;
				}

				if (scroll && info.total !== results.qty && max > results.qty && results.scrollid) {
					client.scroll({
						scroll,
						scrollId: data._scroll_id,
					}, getUntilDone);
				} else {
					callback(null, results);
				}
			}

			if (data.scrollid) {
				logger.debug('Starting As Scroll');
				client.scroll({
					scroll,
					scrollId: data.scrollid,
				}, getUntilDone);
			} else {
				logger.debug('Starting As Query');
				const searchObj = {
					body: {
						_source: data.source,
						aggs: data.aggs,
						from: data.from || 0, // From doesn't seem to work properly.  It appears to be ignored
						query: data.query,
						size: Math.min(max, data.size >= 0 ? data.size : 10000),
						sort: data.sort,
						track_total_hits: data.track_total_hits,
					},
					index: data.index,
					scroll,
					type: data.type,
				};
				logger.debug(JSON.stringify(searchObj, null, 2));
				client.search(searchObj, getUntilDone);
			}
		},
		get: function (data, settings, callback) {
			if (typeof settings === 'function') {
				callback = settings;
				settings = {};
			}

			let client = getClient(settings);

			return new Promise((resolve, reject) => {
				client.get(data, function (err, data) {
					if (callback) {
						callback(err, data);
					} else if (err) {
						reject(err);
					}

					resolve(data);
				});
			});
		},
	};

	return self;
};
