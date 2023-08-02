"use strict";
const { promisify } = require("util");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { NodeHttpHandler } = require('@aws-sdk/node-http-handler');

var https = require("https");
let extend = require("extend");
const async = require("async");
const logger = require("leo-logger")("dynamodb");

module.exports = function(configure, connectionConfig = {}) {
	configure = configure || {};
	configure.onUpdate((newConfigure) => {
		logger.log("lib/dynamodb.js config changed");
		docClient.service.config.update({
			region: newConfigure.aws.region,
			credentials: newConfigure.credentials
		});
	});

	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});

	// Allow httpOptions to be set while not specifying every default field
	let httpOptions;
	let tmpConfig = {
		...connectionConfig
	};
	if (tmpConfig.httpOptions) {
		httpOptions = tmpConfig.httpOptions;
		delete tmpConfig.httpOptions;
	}
	if (tmpConfig.maxRetries) {
		//https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/migrating/notable-changes/
		tmpConfig.maxAttempts = tmpConfig.maxRetries + 1;
		delete tmpConfig.maxRetries;
	}
	if (httpOptions) {
		Object.entries({
			"connectTimeout": "connectionTimeout",
			"timeout": "requestTimeout",
			"agent": "httpsAgent"
		}).forEach(([key, target]) => {
			if (httpOptions[key] != null && httpOptions[target] == null) {
				httpOptions[target] = httpOptions[key];
				delete httpOptions[key];
			}
		});

	}

	var docClient = DynamoDBDocument.from(new DynamoDBClient({
		region: configure.region || (configure.aws && configure.aws.region),
		maxAttempts: 3,
		requestHandler: new NodeHttpHandler({
			connectionTimeout: parseInt(process.env.DYNAMODB_CONNECT_TIMEOUT_MS, 10) || 2000,
			requestTimeout: parseInt(process.env.DYNAMODB_TIMEOUT_MS, 10) || 5000,
			httpsAgent: new https.Agent({
				ciphers: 'ALL',
			}),
			...httpOptions
		}),
		credentials: configure.credentials,
		...tmpConfig
	}), {
		marshallOptions: {
			convertEmptyValues: true
		}
	});
	let ddbLib = {
		docClient: docClient,

		get: function(table, id, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			docClient.get({
				TableName: table,
				Key: {
					[opts.id || 'id']: id
				},
				ConsistentRead: true,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function(err, data) {
				if (err) {
					logger.error(err);
					callback(err);
				} else {
					callback(null, data.Item);
				}
			});
		},

		put: function(table, id, item, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			item[opts.id || 'id'] = id;
			docClient.put({
				TableName: table,
				Key: {
					[opts.id || 'id']: id
				},
				Item: item,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function(err) {
				if (err) {
					logger.error(err);
					callback(err);
				} else {
					callback(null, "Success");
				}
			});
		},

		merge: function(table, id, obj, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			this.get(table, id, opts, (err, data) => {
				if (err) {
					return callback(err);
				}
				var data = extend(true, data, obj);
				this.put(table, id, data, opts, callback);
			});
		},

		update: function(table, key, set, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			var sets = [];
			var names = {};
			var attributes = {};

			for (var k in set) {
				if (set[k] != undefined) {
					var fieldName = k.replace(/[^a-z]+/ig, "_");
					var fieldOpts = opts.fields && opts.fields[k] || {};
					if (fieldOpts.once) {
						sets.push(`#${fieldName} = if_not_exists(#${fieldName}, :${fieldName})`);
					} else {
						sets.push(`#${fieldName} = :${fieldName}`);
					}
					names[`#${fieldName}`] = k;
					attributes[`:${fieldName}`] = set[k];
				}
			}

			if (Object.keys(attributes) == 0) {
				attributes = undefined;
			}
			if (Object.keys(names) == 0) {
				names = undefined;
			}

			var command = {
				TableName: table,
				Key: key,
				UpdateExpression: sets.length ? 'set ' + sets.join(", ") : undefined,
				ExpressionAttributeNames: names,
				ExpressionAttributeValues: attributes,
				"ReturnConsumedCapacity": 'TOTAL'
			};
			if (opts.ReturnValues) {
				command.ReturnValues = opts.ReturnValues;
			}
			docClient.update(command, callback);
		},
		updateMulti: function(items, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			opts = Object.assign({
				limit: 20
			}, opts);

			var funcs = [];
			items.forEach((item) => {
				funcs.push((done) => {
					this.update(item.table, item.key, item.set, opts, done);
				});
			});
			async.parallelLimit(funcs, opts.limit, callback);
		},
		scan: function(table, filter, callback) {
			docClient.scan({
				TableName: table,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function(err, data) {
				if (err) {
					logger.error(err);
					callback(err);
				} else {
					callback(null, data.Items);
				}
			});
		},

		saveSetting: function(setting_id, value, callback) {
			this.put(configure.resources.LeoSettings, setting_id, {
				value: value
			}, callback);
		},
		getSetting: function(setting_id, callback) {
			this.get(configure.resources.LeoSettings, setting_id, {}, callback);
		},
		query: function query(params, configuration, stats) {
			var config = Object.assign({}, {
				mb: 2,
				count: null,
				method: "query",
				progress: function(data, stats, callback) {
					callback(true);
					return true;
				}
			}, configuration);
			stats = Object.assign({}, {
				mb: 0,
				count: 0
			}, stats);
			let method = config.method == "scan" ? "scan" : "query";
			var deferred = new Promise((resolve, reject) => {
				//logger.log(params);
				docClient[method](params, function(err, data) {
					if (err) {
						reject(err);
					} else {
						stats.mb++;
						stats.count += data.Count;
						//logger.log(config, stats)
						config.progress(data, stats, function(shouldContinue) {
							shouldContinue = shouldContinue == null || shouldContinue == undefined || shouldContinue;
							if (shouldContinue && data.LastEvaluatedKey && stats.mb < config.mb && (config.count == null || stats.count < config.count)) {
								//logger.log("Running subquery with start:", data.LastEvaluatedKey)
								params.ExclusiveStartKey = data.LastEvaluatedKey;
								query(params, config, stats).then(function(innerData) {
									data.Items = data.Items.concat(innerData.Items);
									data.ScannedCount += innerData.ScannedCount;
									data.Count += innerData.Count;
									data.LastEvaluatedKey = innerData.LastEvaluatedKey;
									if (data.ConsumedCapacity && innerData.ConsumedCapacity) {
										data.ConsumedCapacity.CapacityUnits += innerData.ConsumedCapacity.CapacityUnits;
									}
									data._stats = innerData._stats;
									resolve(data);
								}).catch(function(err) {
									reject(err);
								});

							} else {
								data._stats = stats;
								resolve(data);
							}
						});

					}
				});
			});

			return deferred;
		},
		batchGetHashkey: function(table, hashkey, ids, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			this.batchGetTable(table, ids.map(function(e) {
				var ret = {};
				ret[hashkey] = e;
				return ret;
			}), opts, function(err, results) {
				if (err) {
					callback(err);
				} else {
					var result = {};
					for (var i = 0; i < results.length; i++) {
						var row = results[i];
						result[row[hashkey]] = row;
					}
					callback(null, result);
				}
			});
		},
		batchGetTable: function(table, keys, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			opts = Object.assign({
				chunk_size: 100,
				concurrency: 3
			}, opts || {});
			var uniquemap = {};

			var results = [];
			var chunker = chunk(function(items, done) {
				logger.log(`Batch getting for table: ${table} - ${items.length}`);
				if (items.length > 0) {
					var params = {
						RequestItems: {},
						"ReturnConsumedCapacity": 'TOTAL'
					};
					params.RequestItems[table] = {
						Keys: items
					};
					docClient.batchGet(params, function(err, data) {
						if (err) {
							logger.error(err);
							done(err, items);
						} else {
							logger.log(`found ${data.Responses[table].length}`);
							results = results.concat(data.Responses[table]);
							done(null, []);
						}
					});
				} else {
					done(null, []);
				}
			}, opts);

			for (var i = 0; i < keys.length; i++) {
				var identifier = JSON.stringify(keys[i]);
				if (!(identifier in uniquemap)) {
					uniquemap[identifier] = 1;
					chunker.add(keys[i]);
				}
			}

			chunker.end(function(err, rs) {
				logger.log(err, rs);
				if (err) {
					logger.error("Error", err);
				} else {
					logger.log(`Total Found ${results.length}`);
					callback(null, results);
				}
			});
		},
		createTableWriteStream: function(table, opts) {
			logger.log("opts are", opts);
			opts = Object.assign({
				chunk_size: 25,
				data_size: 400000,
				concurrency: 10,
				concurrency_delay: 100,
				keys: []
			}, opts || {});

			var chunker = chunk((items, done) => {
				if (opts.keys.length) {
					var hash = opts.keys[0];
					var range = opts.keys[1];

					var seen = {};
					//Process in reverse, so that the newest record goes through and so I can delete without readjusting keys
					for (var i = items.length - 1; i >= 0; i--) {
						var id = items[i].PutRequest.Item[hash] + "" + items[i].PutRequest.Item[range];
						if (id in seen) {
							items.splice(i, 1);
						} else {
							seen[id] = 1;
						}
					}
				}
				if (items.length > 0) {
					this.batchTableWrite(table, items, function(err, unprocessedItems) {
						if (err) {
							done("could not write records", unprocessedItems, err);
						} else {
							done();
						}
					});
				} else {
					done();
				}
			}, opts);

			return {
				put: function(item) {
					chunker.add({
						PutRequest: {
							Item: item
						}
					});
				},
				end: chunker.end
			};
		},
		batchTableWrite: function(table, records, callback) {
			logger.log(`Sending ${records.length} records`);
			var request = {
				RequestItems: {},
				"ReturnConsumedCapacity": 'TOTAL'
			};
			request.RequestItems[table] = records;
			docClient.batchWrite(request, function(err, data) {
				if (err) {
					logger.log(`All ${records.length} records failed`, err);
					callback(err, records);
				} else if (table in data.UnprocessedItems && Object.keys(data.UnprocessedItems[table]).length !== 0) {
					logger.log(`Unprocessed ${data.UnprocessedItems[table].length} records`);
					callback("unprocessed records", data.UnprocessedItems[table]);
				} else {
					callback(null, []);
				}
			});
		},
	};


	ddbLib.getSettingPromise = promisify(ddbLib.getSetting).bind(ddbLib);
	ddbLib.setSettingPromise = promisify(ddbLib.saveSetting).bind(ddbLib);
	return ddbLib;
};



// TODO: Should this be included?  Do we need to convert it to a stream?
let chunk = function(func, opts) {
	opts = Object.assign({
		chunk_size: 25,
		retry: 2,
		retryDelay: 100,
		concurrency: 2,
		concurrency_delay: 100,
		combine: false,
		data_size: null
	}, opts || {});
	// logger.log("opts are ", opts);
	var records = [];
	var calls = 0;
	var completedCalls = 0;
	var requestEnd = false;

	var retries = 0;
	var errors = 0;
	var hadErrors = false;
	var batches = 0;
	var delaying = false;

	function sendAvailable() {
		var sendSize;
		if (records.length > 0 && retries <= opts.retry && completedCalls == calls && !delaying) {
			if (errors == 0) { //let's reset because last round completed successfully
				batches++;
				if (!hadErrors) {
					retries = 0;
				}
				hadErrors = false;
				logger.log(`-------------------New Batch #${batches}----------------`);
				if (opts.chunk_size < 10 || opts.concurrency > 25) {
					logger.log(`chunking ${opts.chunk_size} - ${opts.concurrency} times`);

				}
			} else {
				logger.log(`-------------------Retrying: ${errors} records failed, retrying in ${opts.retryDelay * retries}ms, retry #${opts.retry - (opts.retry - retries) + 1}----------------`);
				retries++;
				errors = 0;
				hadErrors = true;
				delaying = true;
				setTimeout(function() {
					delaying = false;
					sendAvailable();
				}, opts.retryDelay * retries);
				return;
			}
			if (retries > opts.retry) {
				checkDone();
				return;
			}
			while (records.length > 0 && completedCalls > calls - opts.concurrency) {
				calls++;
				var dataSizeBased = false;
				if (opts.data_size) {
					sendSize = 0;
					var runningSize = 0;
					for (var i = 0; i < opts.chunk_size && i < records.length; i++) {
						var r = records[i];
						runningSize += r.size;
						if (runningSize > opts.data_size) {
							dataSizeBased = true;
							break;
						}
						sendSize++;
					}
				} else {
					sendSize = opts.chunk_size;
				}
				if (opts.combine) {
					var items = records.splice(0, sendSize);
					var toProcess = [];
					var size = 0;
					var groupStart = 0;

					for (var i = 0; i < items.length; i++) {
						var item = items[i];
						if (item.size + size >= opts.record_size) {
							logger.log(`grouping items from ${groupStart + 1} to ${i} of ${items.length} of size: ${size}`);
							toProcess.push(items.slice(groupStart, i).map((e) => {
								return e.record;
							}).join(''));
							groupStart = i;
							size = item.size;
						} else {
							size += item.size;
						}
					}
					if (groupStart != items.length) {
						logger.log(`grouping items from ${groupStart + 1} to ${items.length} of ${items.length} of size: ${size}`);
						toProcess.push(items.slice(groupStart, items.length).map((e) => {
							return e.record;
						}).join(''));
					}

				} else {
					var toProcess = records.splice(0, sendSize).map(function(e) {
						return e.record;
					});
				}

				if (toProcess.length > 0) {
					if (opts.chunk_size >= 10 && opts.concurrency <= 25) {
						logger.log(`chunking ${toProcess.length} records (${dataSizeBased ? 'Data Size' : 'Count Size'})`);
					}
					func(toProcess, function(err, unprocessedItems) {
						if (err) {
							logger.log(`Records not processed, ${unprocessedItems.length}`);

							process.nextTick(function() {
								//Don't want to add the records or change completed calls until after the current While loop is done...otherwise a nasty infinite loop could happen
								completedCalls++;
								records = unprocessedItems.map(function(e) {
									var size;
									if (!size) {
										if (typeof e === "string") {
											size = Buffer.byteLength(e);
										} else {
											size = Buffer.byteLength(JSON.stringify(e));
										}
									}
									return {
										size: size,
										record: e
									};
								}).concat(records);
								errors += unprocessedItems.length;
								setTimeout(sendAvailable, opts.concurrency_delay);
							});
						} else if (records.length) {
							completedCalls++;
							setTimeout(sendAvailable, opts.concurrency_delay);
						} else {
							completedCalls++;
							sendAvailable();
						}
					});
				} else {
					completedCalls++;
				}
			}
		} else {
			checkDone();
		}
	}

	function checkDone() {
		if (requestEnd !== false && completedCalls == calls && (records.length == 0 || retries >= opts.retry)) {
			if (records.length > 0) {
				requestEnd("Cannot process all the entries", records.length);
				requestEnd = false;
			} else {
				requestEnd(null, []);
				requestEnd = false;
			}
		}
	}

	return {
		add: function(item) {
			requestEnd = false;
			var size;
			if (!size) {
				if (typeof item === "string") {
					size = Buffer.byteLength(item);
				} else {
					size = Buffer.byteLength(JSON.stringify(item));
				}
			}

			if (opts.record_size && size > opts.record_size) {
				logger.error("record size is too large", size, opts.record_size);
			} else if (opts.data_size && size > opts.data_size) {
				logger.error("data size is too large");
			} else {
				records.push({
					size: size,
					record: item
				});
				if (records.length >= opts.chunk_size * opts.concurrency) {
					sendAvailable();
				}
			}
		},
		end: function(callback) {
			requestEnd = callback;
			sendAvailable();
		}
	};
};
