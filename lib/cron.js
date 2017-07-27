"use strict";

var moment = require("moment");
var zlib = require("zlib");
var extend = require("extend");
var dynamo = require("./dynamodb.js");

var CRON_TABLE = "Leo_cron";

module.exports = function (configure = {}) {
	var dynamodb = new dynamo({
		region: configure.region || (configure.aws && configure.aws.region)
	});
	return {
		trigger: function (cron, callback) {
			var params = {
				TableName: "Leo_cron",
				Key: {
					id: cron.id
				},
				UpdateExpression: 'set #trigger=:now',
				ExpressionAttributeNames: {
					"#trigger": "trigger"
				},
				ExpressionAttributeValues: {
					":now": Date.now()
				},
				"ReturnConsumedCapacity": 'TOTAL'
			};
			dynamodb.docClient.update(params, function (err) {
				callback(err, {
					refId: cron.id
				});
			});
		},
		checkLock: function (cron, runid, remainingTime, callback) {
			if (cron.ignoreLock) {
				callback();
			} else {
				var command = {
					TableName: CRON_TABLE,
					Key: {
						id: cron.id
					},
					UpdateExpression: 'set #instances.#index.#startTime = :startTime, #instances.#index.#requestId = :requestId, #instances.#index.#maxDuration = :maxDuration',
					ConditionExpression: '#instances.#index.#token = :token AND attribute_not_exists(#instances.#index.#startTime) AND attribute_not_exists(#instances.#index.#requestId)',
					ExpressionAttributeNames: {
						"#instances": "instances",
						"#index": cron.iid.toString(),
						"#token": "token",
						"#startTime": "startTime",
						"#requestId": "requestId",
						"#maxDuration": "maxDuration"
					},
					ExpressionAttributeValues: {
						":token": cron.ts,
						":startTime": Date.now(),
						":requestId": runid,
						":maxDuration": remainingTime
					},
					"ReturnConsumedCapacity": 'TOTAL'
				};
				if (cron.force) {
					delete command.ConditionExpression;
					command.UpdateExpression += ", #instances.#index.#token = :token";
				}
				dynamodb.docClient.update(command, function (err, data) {
					if (err) {
						console.log(err);
					}
					callback(err, data);
				});
			}
		},
		reportComplete(cron, runid, status, log, opts, callback) {
			if (cron.ignoreLock) {
				callback();
				return;
			}
			opts = Object.assign({}, opts || {});

			var command = {
				TableName: CRON_TABLE,
				Key: {
					id: cron.id
				},
				UpdateExpression: 'set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result',
				ConditionExpression: '#instances.#index.#token = :token', // AND #instances.#index.#requestId = :requestId',
				ExpressionAttributeNames: {
					"#instances": "instances",
					"#index": cron.iid.toString(),
					"#completedTime": "completedTime",
					"#requestId": "requestId",
					"#token": "token",

					"#status": "status",
					"#log": "log",
					"#result": "result"
				},
				ExpressionAttributeValues: {
					":completedTime": Date.now(),
					//":requestId": runid,
					":token": cron.ts,
					":status": status,
					":log": zlib.gzipSync(JSON.stringify(log)),
					":result": (cron.result != undefined && cron.result != null) ? zlib.gzipSync(JSON.stringify(cron.result)) : null
				},
				"ReturnConsumedCapacity": 'TOTAL'
			};

			if (runid == undefined) {
				command.ConditionExpression += " AND attribute_not_exists(#instances.#index.#requestId)";
			} else {
				command.ConditionExpression += " AND #instances.#index.#requestId= :requestId";
				command.ExpressionAttributeValues[":requestId"] = runid;
			}

			if (configure.registry.cron_run_again === true && !cron.preventRunAgain) {
				console.log("Cron Run Again Flag Set:", moment.now());
				command.UpdateExpression += ", #trigger = :trigger";
				command.ExpressionAttributeNames["#trigger"] = "trigger";
				command.ExpressionAttributeValues[":trigger"] = moment.now();
			}

			configure.registry.cron_message = cron.message || configure.registry.cron_message || null;
			command.UpdateExpression += ", #msg = :msg";
			command.ExpressionAttributeNames["#msg"] = "message";
			command.ExpressionAttributeValues[":msg"] = configure.registry.cron_message;

			dynamodb.docClient.update(command, function (err, data) {
				if (err && err.errorType != "ConditionalCheckFailedException") {
					console.log(err);
					callback(err);
				} else {
					if (err) {
						console.log("Lock Token and Request changed during execution!");
					}
					callback();
				}
			});
		},
		createLock: function (id, runid, maxDuration, callback) {
			id = "lock_" + id;
			dynamodb.docClient.put({
				TableName: "Leo_setting",
				Key: {
					id: id
				},
				Item: {
					id: id,
					ts: Date.now(),
					expires: Date.now() + maxDuration,
					value: runid
				},
				ConditionExpression: "attribute_not_exists(id) OR expires <= :now",
				ExpressionAttributeValues: {
					":now": Date.now()
				},
				"ReturnConsumedCapacity": 'TOTAL'
			}, function (err) {
				console.log(err);
				if (err) {
					callback(err);
				} else {
					callback(null);
				}
			});
		},
		removeLock: function (id, runid, callback) {
			id = "lock_" + id;
			dynamodb.docClient.delete({
				TableName: "Leo_setting",
				Key: {
					id: id
				},
				ConditionExpression: "#value = :runid",
				ExpressionAttributeNames: {
					"#value": "value"
				},
				ExpressionAttributeValues: {
					":runid": runid
				},
				"ReturnConsumedCapacity": 'TOTAL'
			}, function (err) {
				if (err) {
					callback(err);
				} else {
					callback(null);
				}
			});
		},
		checkpoint: function (id, event, params, callback) {
			var type = params.type == "write" ? "write" : "read";
			var opts = {};

			var checkpointData = {
				checkpoint: params.eid || params.kinesis_number,
				source_timestamp: params.source_timestamp,
				started_timestamp: params.started_timestamp,
				ended_timestamp: params.ended_timestamp,
				records: params.units || params.records
			};

			id = id.replace(/_reader$/, "");
			var cronCheckpointCommand = {
				TableName: "Leo_cron",
				Key: {
					id: id
				},
				UpdateExpression: 'set #checkpoints.#type.#event = :value',
				ExpressionAttributeNames: {
					"#checkpoints": "checkpoints",
					"#checkpoint": "checkpoint",
					"#type": type,
					"#event": event
				},
				ExpressionAttributeValues: {
					":value": checkpointData
				},
				"ReturnConsumedCapacity": 'TOTAL'
			};

			var expected = params.expected || (configure.registry &&
				configure.registry.__cron &&
				configure.registry.__cron.checkpoints &&
				configure.registry.__cron.checkpoints[type] &&
				configure.registry.__cron.checkpoints[type][event] &&
				configure.registry.__cron.checkpoints[type][event].checkpoint) || undefined;

			if (expected) {
				cronCheckpointCommand.ConditionExpression = '#checkpoints.#type.#event.#checkpoint = :expected';
				cronCheckpointCommand.ExpressionAttributeValues[":expected"] = expected;
			} else {
				cronCheckpointCommand.ConditionExpression = 'attribute_not_exists(#checkpoints.#type.#event.#checkpoint)';
			}

			var updateInMemoryCheckpoint = () => {
				// this path is not guaranteed to be in config so do a safe set
				var c = ["registry", "__cron", "checkpoints", type].reduce((o, f) => o[f] = o[f] || {}, configure);
				c[event] = checkpointData;
			};

			opts.debug && console.log(JSON.stringify(cronCheckpointCommand, null, 2));
			dynamodb.docClient.update(cronCheckpointCommand, function (err, data) {
				if (err && err.code == "ConditionalCheckFailedException") {
					opts.debug && console.log("Error: Stale Checkpoint:", checkpointData.checkpoint);
					callback("Stale Checkpoint");
				} else if (err) {
					//console.log("Error Checkpointing in Cron Table", err);
					// Try to get the entry
					dynamodb.get("Leo_cron", id, {}, function (getErr, getData) {
						// Err getting entry
						if (getErr) {
							console.log("error", getErr);
							callback(getErr);
						} else if (getData == undefined) {
							console.log("Bot Didn't exist in Cron.  Saving Cron Entry");
							var entry = {
								id: id,
								checkpoints: {
									read: {},
									write: {}
								},
								requested_kinesis: {},
								lambda: {},
								time: null,
								instances: {},
								lambdaName: null,
								paused: false,
								name: id,
								description: null
							};
							entry.checkpoints[type][event] = checkpointData;
							dynamodb.put("Leo_cron", id, entry, function (err, data) {
								if (err) {
									callback("Couldn't save bot in cron.  Failed to checkpoint!");
								} else {
									updateInMemoryCheckpoint();
									callback();
								}
							});
						} else {
							opts.debug && console.log("Record Exists but couldn't Checkpoint" + getData, err);
							callback("Error Updating Cron table");
						}
					});
				} else {
					opts.debug && console.log("Checkpointed in Cron Table", data);
					updateInMemoryCheckpoint();
					callback();
				}
			});
		},
		update: function (bot, callback) {
			return new Promise((resolve, reject) => {
				var res = resolve;
				var rej = reject;
				resolve = (data) => {
					if (callback) {
						callback(null, data);
					}
					res(data);
				};
				reject = (err) => {
					if (callback) {
						callback(err);
					}
					rej(err);
				};

				var done = (err, data) => {
					if (err) {
						reject(err);
					} else {
						resolve(data);
					}
				};
				dynamodb.merge("Leo_cron", bot.id, bot, done);
			});
		},
		runAgain: function () {
			configure.registry.cron_run_again = true;
		},
		getLastResult: function () {
			var r = configure.registry.__cron && configure.registry.__cron.lastResult;
			return (r != undefined && r != null) ? JSON.parse(zlib.gunzipSync(new Buffer(r, "base64"))) : null;
		},
		setMessage: function (message) {
			if (typeof message == "string") {
				message = [{
					msg: message
				}];
			}
			configure.registry.cron_message = message;
		},
		getAttachedSystemByAlias: function (alias) {
			var systems = configure.registry && configure.registry.__cron && configure.registry.__cron.systems || {};
			return Object.keys(systems).map(key => systems[key]).filter(system => system.aliases.indexOf(alias) > -1)[0];
		},
		getAttachedSystem: function (id) {
			var id = id.replace(/^system./, "");
			var systems = configure.registry && configure.registry.__cron && configure.registry.__cron.systems || {};
			return systems[id];
		}
	};
};