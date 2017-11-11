"use strict";
var AWS = require('aws-sdk');
var https = require("https");
let extend = require("extend")
const async = require("async");

module.exports = function (configure) {
	configure = configure || {};
	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});
	var docClient = new AWS.DynamoDB.DocumentClient({
		region: configure.region || (configure.aws && configure.aws.region),
		maxRetries: 2,
		convertEmptyValues: true,
		// logger: process.stdout,
		httpOptions: {
			agent: new https.Agent({
				ciphers: 'ALL',
				secureProtocol: 'TLSv1_method',
				// keepAlive: true
			})
		},
		accessKeyId: configure.accessKeyId || (configure.bus && configure.bus.accessKeyId),
		secretAccessKey: configure.secretAccessKey || (configure.bus && configure.bus.secretAccessKey)
	});
	return {
		docClient: docClient,

		get: function (table, id, opts, callback) {
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
			}, function (err, data) {
				if (err) {
					console.log(err);
					callback(err);
				} else {
					callback(null, data.Item);
				}
			});
		},

		put: function (table, id, item, opts, callback) {
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
			}, function (err) {
				if (err) {
					console.log(err);
					callback(err);
				} else {
					callback(null, "Success");
				}
			});
		},

		merge: function (table, id, obj, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			this.get(table, id, opts, (err, data) => {
				if (err) {
					return callback(err);
				}
				var data = extend(true, data, obj);
				this.put(table, id, data, opts, callback)
			});
		},

		update: function (table, key, set, opts, callback) {
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
		updateMulti: function (items, opts, callback) {
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
		scan: function (table, filter, callback) {
			docClient.scan({
				TableName: table,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function (err, data) {
				if (err) {
					console.log(err);
					callback(err);
				} else {
					callback(null, data.Items);
				}
			});
		},

		saveSetting: function (setting_id, value, callback) {
			this.put(configure.resources.LeoSettings, setting_id, {
				value: value
			}, callback);
		},
		getSetting: function (setting_id, callback) {
			this.get(configure.resources.LeoSettings, setting_id, {}, callback);
		},
		query: function query(params, configuration, stats) {
			var config = Object.assign({}, {
				mb: 2,
				count: null,
				method: "query",
				progress: function (data, stats, callback) {
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
				//console.log(params);
				docClient[method](params, function (err, data) {
					if (err) {
						reject(err);
					} else {
						stats.mb++;
						stats.count += data.Count;
						//console.log(config, stats)
						config.progress(data, stats, function (shouldContinue) {
							shouldContinue = shouldContinue == null || shouldContinue == undefined || shouldContinue;
							if (shouldContinue && data.LastEvaluatedKey && stats.mb < config.mb && (config.count == null || stats.count < config.count)) {
								//console.log("Running subquery with start:", data.LastEvaluatedKey)
								params.ExclusiveStartKey = data.LastEvaluatedKey;
								query(params, config, stats).then(function (innerData) {
									data.Items = data.Items.concat(innerData.Items)
									data.ScannedCount += innerData.ScannedCount;
									data.Count += innerData.Count;
									data.LastEvaluatedKey = innerData.LastEvaluatedKey
									if (data.ConsumedCapacity && innerData.ConsumedCapacity) {
										data.ConsumedCapacity.CapacityUnits += innerData.ConsumedCapacity.CapacityUnits;
									}
									data._stats = innerData._stats;
									resolve(data)
								}).catch(function (err) {
									reject(err);
								}).done();

							} else {
								data._stats = stats;
								resolve(data);
							}
						})

					}
				});
			});

			return deferred;
		}
	};
}