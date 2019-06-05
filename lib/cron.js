"use strict";

var moment = require("moment");
var zlib = require("zlib");
var extend = require("extend");
var dynamo = require("./dynamodb.js");
var refUtil = require("./reference.js");
const logger = require("./logger.js")("leo-cron");


module.exports = function(configure) {
	configure = configure || {};
	var dynamodb = new dynamo(configure);

	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});

	var CRON_TABLE = configure.resources.LeoCron;
	var SETTINGS_TABLE = configure.resources.LeoSettings;
	var SYSTEM_TABLE = configure.resources.LeoSystem;
	return {
		trigger: function(cron, callback) {
			var params = {
				TableName: CRON_TABLE,
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
			dynamodb.docClient.update(params, function(err) {
				callback(err, {
					refId: cron.id
				});
			});
		},
		schedule: function(id, duration) {
			if (duration == undefined) {
				duration = id;
				id = configure.registry.__cron && configure.registry.__cron.id
			}
			if (!id) {
				return Promise.reject("id is required");
			}
			let time;
			// Determine if it is an exact value or a duration
			if (typeof duration == "number" || duration instanceof Date || moment.isMoment(duration)) {
				time = duration.valueOf();
			} else {
				time = moment.now() + moment.duration(duration);
			}
			var params = {
				TableName: CRON_TABLE,
				Key: {
					id: id
				},
				UpdateExpression: 'set #scheduledTrigger=:value',
				ExpressionAttributeNames: {
					"#scheduledTrigger": "scheduledTrigger"
				},
				ExpressionAttributeValues: {
					":value": time
				},
				"ReturnConsumedCapacity": 'TOTAL'
			};
			return new Promise((resolve, reject) => {
				dynamodb.docClient.update(params, function(err) {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				})
			});
		},
		checkLock: function(cron, runid, remainingTime, callback) {
			if (cron.time && (Date.now() - cron.time) > 2000) {
				callback("Old Run: Skipping");
			} else if (cron.ignoreLock) {
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
						"#index": (cron.iid || 0).toString(),
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

					let now = Date.now();
					let index = (cron.iid || 0).toString();

					command.UpdateExpression = 'set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused';
					command.ExpressionAttributeNames = {
						"#instances": "instances",
						"#index": index,
						"#invokeTime": "invokeTime",
						"#checkpoint": "checkpoint",
						"#ignorePaused": "ignorePaused"
					};
					command.ExpressionAttributeValues = {
						":value": {
							token: cron.ts,
							requestId: runid,
							startTime: now,
							invokeTime: now,
							maxDuration: remainingTime,
							status: (cron && cron.instances && cron.instances[index] && cron.instances[index].status) || null
						},
						":invokeTime": now
					};

					// command.ExpressionAttributeNames["#completedTime"] = "completedTime";
					// command.ExpressionAttributeNames["#invokeTime"] = "invokeTime";
					// command.ExpressionAttributeValues[":invokeTime"] = Date.now();
					// command.UpdateExpression += ", #instances.#index.#token = :token, #instances.#index.#invokeTime = :invokeTime, #invokeTime = :invokeTime";
				}
				dynamodb.docClient.update(command, function(err, data) {
					if (err && (err.code == "" || cron.force)) {
						var entry = {
							id: cron.id,
							checkpoints: {
								read: {},
								write: {}
							},
							requested_kinesis: {},
							lambda: {},
							time: null,
							instances: {
								[(cron.iid || 0).toString()]: {
									token: cron.ts,
									startTime: Date.now(),
									requestId: runid,
									maxDuration: remainingTime
								}
							},
							lambdaName: null,
							paused: false,
							name: cron.id,
							description: null
						};
						logger.log("Bot Didn't exist in Cron.  Saving Cron Entry");
						dynamodb.put(CRON_TABLE, cron.id, entry, function(err, data) {
							if (err) {
								callback("Couldn't save bot in cron.");
							} else {
								callback(null, data);
							}
						});
					} else if (err) {
						logger.error(err.code)
						logger.error(command, err);
						callback(err, data);
					} else {
						callback(null, data)
					}
				});
			}
		},
		reportComplete(cron, runid, status, log, opts, callback) {
			if (cron.ignoreLock) {
				callback();
				return;
			}
			opts = Object.assign({}, opts || {});

			var command;
			if (opts.forceComplete) {
				command = {
					TableName: CRON_TABLE,
					Key: {
						id: cron.id
					},
					UpdateExpression: 'set #instances.#index = :value',
					ExpressionAttributeNames: {
						"#instances": "instances",
						"#index": (cron.iid || 0).toString(),
					},
					ExpressionAttributeValues: {
						":value": {
							completedTime: Date.now(),
							status: status,
							log: zlib.gzipSync(JSON.stringify(log)),
							result: (cron.result != undefined && cron.result != null) ? zlib.gzipSync(JSON.stringify(cron.result)) : null,
							message: cron.message || configure.registry.cron_message || null
						}
					},
					"ReturnConsumedCapacity": 'TOTAL'
				};
				if (global.cron_run_again === true && !cron.preventRunAgain && !global.preventRunAgain) {
					logger.log("Cron Run Again Flag Set:", moment.now());
					command.ExpressionAttributeValues[":value"].trigger = moment.now();
				}
			} else {
				command = {
					TableName: CRON_TABLE,
					Key: {
						id: cron.id
					},
					UpdateExpression: 'set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result',
					ConditionExpression: '#instances.#index.#token = :token', // AND #instances.#index.#requestId = :requestId',
					ExpressionAttributeNames: {
						"#instances": "instances",
						"#index": (cron.iid || 0).toString(),
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

				if (global.cron_run_again === true && !cron.preventRunAgain && !global.preventRunAgain) {
					logger.log("Cron Run Again Flag Set:", moment.now());
					command.UpdateExpression += ", #trigger = :trigger";
					command.ExpressionAttributeNames["#trigger"] = "trigger";
					command.ExpressionAttributeValues[":trigger"] = moment.now();
				}

				configure.registry.cron_message = cron.message || configure.registry.cron_message || null;
				command.UpdateExpression += ", #msg = :msg";
				command.ExpressionAttributeNames["#msg"] = "message";
				command.ExpressionAttributeValues[":msg"] = configure.registry.cron_message;
			}

			command.ExpressionAttributeNames["#err"] = "errorCount";

			if (status === 'error') {
				command.UpdateExpression += " ADD #err :err";
				command.ExpressionAttributeValues[":err"] = 1;

			} else {
				command.UpdateExpression += ", #err = :err";
				command.ExpressionAttributeValues[":err"] = 0;
			}

			dynamodb.docClient.update(command, function(err, data) {
				if (err && err.errorType != "ConditionalCheckFailedException") {
					logger.error("Cannot report complete", err);
					callback(err);
				} else {
					if (err) {
						logger.error("Lock Token and Request changed during execution!");
					}
					callback();
				}
			});
		},
		createLock: function(id, runid, maxDuration, callback) {
			id = "lock_" + id;
			dynamodb.docClient.put({
				TableName: SETTINGS_TABLE,
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
			}, function(err) {
				if (err) {
					logger.error(err);
					callback(err);
				} else {
					callback(null);
				}
			});
		},
		removeLock: function(id, runid, callback) {
			id = "lock_" + id;
			dynamodb.docClient.delete({
				TableName: SETTINGS_TABLE,
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
			}, function(err) {
				if (err) {
					callback(err);
				} else {
					callback(null);
				}
			});
		},
		checkpoint: function(id, event, params, callback) {
			event = refUtil.refId(event);
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
				TableName: CRON_TABLE,
				Key: {
					id: id
				},
				UpdateExpression: 'set #checkpoints.#type.#event = :value',
				ExpressionAttributeNames: {
					"#checkpoints": "checkpoints",
					"#type": type,
					"#event": event
				},
				ExpressionAttributeValues: {
					":value": checkpointData
				},
				"ReturnConsumedCapacity": 'TOTAL'
			};

			if (type == "read" && !params.force && (!configure.registry ||
					!configure.registry.__cron || !configure.registry.__cron.force) && (params.expected || (configure.registry && configure.registry.__cron))) {
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

				cronCheckpointCommand.ExpressionAttributeNames["#checkpoint"] = "checkpoint";
			}

			var updateInMemoryCheckpoint = () => {
				// this path is not guaranteed to be in config so do a safe set
				var c = ["registry", "__cron", "checkpoints", type].reduce((o, f) => o[f] = o[f] || {}, configure);
				c[event] = checkpointData;
			};

			let checkpointLocation = (configure.registry && configure.registry.__cron && configure.registry.__cron.cploc);
			if (checkpointLocation) {
				cronCheckpointCommand.ExpressionAttributeNames[`#checkpoints`] = checkpointLocation;
				cronCheckpointCommand.ExpressionAttributeNames["#type"] = configure.registry.__cron.iid.toString();

				delete cronCheckpointCommand.ExpressionAttributeNames["#checkpoint"];
				delete cronCheckpointCommand.ExpressionAttributeValues[":expected"];
				delete cronCheckpointCommand.ConditionExpression;

			}

			logger.info(JSON.stringify(cronCheckpointCommand, null, 2));
			dynamodb.docClient.update(cronCheckpointCommand, function(err, data) {
				if (err && err.code == "ConditionalCheckFailedException") {
					logger.error("Error: Stale Checkpoint:", checkpointData, cronCheckpointCommand, err);
					callback("Stale Checkpoint");
				} else if (err) {
					//console.log("Error Checkpointing in Cron Table", err);
					// Try to get the entry
					dynamodb.get(CRON_TABLE, id, {}, function(getErr, getData) {
						// Err getting entry
						if (getErr) {
							logger.error("error", getErr);
							callback(getErr);
						} else if (getData == undefined) {
							logger.info("Bot Didn't exist in Cron.  Saving Cron Entry");
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
							if (checkpointLocation) {
								entry[checkpointLocation] = {
									[configure.registry.__cron.iid]: {
										[event]: checkpointData
									}
								};
							} else {
								entry.checkpoints[type][event] = checkpointData;
							}
							dynamodb.put(CRON_TABLE, id, entry, function(err, data) {
								if (err) {
									callback("Couldn't save bot in cron.  Failed to checkpoint!");
								} else {
									updateInMemoryCheckpoint();
									callback();
								}
							});
						} else {
							logger.error("Record Exists but couldn't Checkpoint" + getData, err);
							callback("Error Updating Cron table");
						}
					});
				} else {
					logger.log("Checkpointed in Cron Table", data);
					updateInMemoryCheckpoint();
					callback();
				}
			});
		},
		getCheckpoint: async function(botId, queue) {
			configure.registry = configure.registry || {};
			if (queue == undefined) {
				queue = botId;
				botId = (configure.registry.__cron && configure.registry.__cron.id);
			}
			let id = refUtil.refId(queue);
			if (!configure.registry.__cron || !configure.registry.__cron.checkpoints) {
				let data = await new Promise((resolve, reject) => {
					this.get(botId || configure.registry.__cron.id, {}, (err, data) => {
						if (err) {
							reject(err);
						} else {
							resolve(data);
						}
					})
				});
				configure.registry.__cron = configure.registry.__cron || data.__cron;
				configure.registry.__cron.checkpoints = data.__cron.checkpoints
			}
			var checkpointData = ["registry", "__cron", "checkpoints", "read"].reduce((o, f) => o[f] = o[f] || {}, configure);
			return checkpointData[id] && checkpointData[id].checkpoint;

		},
		update: function(bot, callback) {
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
				dynamodb.merge(CRON_TABLE, bot.id, bot, done);
			});
		},
		subscribe: function(id, queue, data) {
			if (!id || !queue) {
				return Promise.reject(new Error("'id' and 'queue' are required"));
			}
			data = Object.assign({}, data, {
				id: id,
				triggers: Array.isArray(queue) ? queue : [queue],
				settings: {
					source: queue
				}
			});
			return this.createBot(id, data).then(() => ({
				refId: refUtil.botRefId(id)
			}));
		},
		runAgain: function() {
			global.cron_run_again = true;
		},
		getLastResult: function() {
			var r = configure.registry.__cron && configure.registry.__cron.lastResult;
			return (r != undefined && r != null) ? JSON.parse(zlib.gunzipSync(Buffer.from(r, "base64"))) : null;
		},
		setMessage: function(message) {
			if (typeof message == "string") {
				message = [{
					msg: message
				}];
			}
			configure.registry.cron_message = message;
		},
		getAttachedSystemByAlias: function(alias) {
			var systems = configure.registry && configure.registry.__cron && configure.registry.__cron.systems || {};
			return Object.keys(systems).map(key => systems[key]).filter(system => system.aliases.indexOf(alias) > -1)[0];
		},
		getAttachedSystem: function(id) {
			var id = refUtil.ref(id).id.replace(/^system\./, "");
			var systems = configure.registry && configure.registry.__cron && configure.registry.__cron.systems || {};
			return systems[id];
		},
		get: function(id, opts, callback) {
			opts = Object.assign({
				instance: 0,
				register: true
			}, opts || {});
			id = refUtil.botRef(id).id;
			dynamodb.get(CRON_TABLE, id, (err, data) => {
				if (err) {
					callback(err);
				} else {
					data = extend(true, {}, data || {
						id: id
					}, {
						lambda: {
							settings: [opts.overrides || {}]
						}
					});
					if (opts.register) {
						process.__config = process.__config || configure;
						process.__config.registry = process.__config.registry || {};
						configure.registry = extend(true, process.__config.registry, configure.registry || {});
						var checkpointData = ["registry", "__cron", "checkpoints", "read"].reduce((o, f) => o[f] = o[f] || {}, configure);
						Object.assign(checkpointData, data.checkpoints && data.checkpoints.read || {});
					}
					let single = !opts.instances;
					this.buildPayloads(data, {}, {
						instances: opts.instances || [opts.instance || "0"]
					}).then(r => callback(null, single ? r[0] : r)).catch(callback);
				}
			});
		},
		buildPayloads: function(cron, prev, opts) {
			opts = Object.assign({}, opts);
			return new Promise((resolve, reject) => {
				var payload = {
					__cron: {
						id: cron.id,
						name: cron.lambdaName,
						ts: cron.trigger,
						time: Date.now(),
						checkpoints: cron.checkpoints,
						botName: cron.name,
						instances: cron.instances
					}
				};
				var setting = cron.lambda && cron.lambda.settings || {};
				if (Array.isArray(setting)) {
					setting = setting[0]
				}
				//console.log("Building payloads", cron, setting)
				var systemIds = {};

				if (setting.destination) {
					let sref = refUtil.ref(setting.destination);
					if (sref.type === "system") {
						var s = systemIds[sref.id] = systemIds[sref.id] || [];
						s.push("destination");
					}
				}

				if (setting.source) {
					let sref = refUtil.ref(setting.source);
					if (sref.type === "system") {
						var s = systemIds[sref.id] = systemIds[sref.id] || [];
						s.push("source");
					}

					// Update the requested checkpoint to send
					if (!!cron.checkpoint) {
						extend(true, payload.__cron, {
							checkpoints: {
								read: {
									[setting.source]: {
										checkpoint: cron.checkpoint
									}
								}
							}
						});
					}
				}

				var applyInstances = function(cronSettings) {
					var results = [];
					var instanceIds = opts.instances || ["0"];
					for (var index in instanceIds) {
						var iPayload = extend(true, {}, cronSettings, setting, (cron.namedSettings || {})[instanceIds[index].toString()]);
						iPayload.__cron.iid = instanceIds[index].toString();
						iPayload.botId = cron.id;
						results.push(iPayload);
					}
					//console.log(JSON.stringify(results, null, 2));
					resolve(results);
				};

				// Add systems
				if (cron.system && cron.system.id) {
					let sref = refUtil.ref(cron.system.id, "system");
					var s = systemIds[sref.id] = systemIds[sref.id] || [];
					s.push("default");
				}
				//console.log(systemIds)
				if (Object.keys(systemIds).length) {
					dynamodb.docClient.batchGet({
						RequestItems: {
							[SYSTEM_TABLE]: {
								Keys: Object.keys(systemIds).map(id => {
									return {
										id: id
									}
								})
							}
						}
					}, (err, data) => {
						if (err) {
							reject(err);
						} else {
							payload.__cron.systems = {}
							var lookup = {}
							let response = data.Responses[SYSTEM_TABLE];
							Object.keys(systemIds).map(id => {
								let system = response[id] || {
									id: id
								};
								payload.__cron.systems[system.id] = {
									id: system.id,
									label: system.label || system.id,
									settings: system.settings,
									aliases: systemIds[system.id] || []
								}
							});
							applyInstances(payload);
						}
					});
				} else {
					applyInstances(payload)
				}
			});
		},
		shouldRun: function(oldImage, newImage, cache, callback) {
			let hasCode = newImage.lambdaName || cache._remoteCode;
			var executionTypes = {
				"step-function": "step-function",
				"stepfunction": "step-function",
				"lambda": "lambda"
			};
			var delay = newImage.delay && moment.duration(newImage.delay).asMilliseconds() || 0;
			var completedTime = 0;
			var isRunning = false;
			var timeout = 0;
			var invokeTime = newImage.invokeTime || 0;
			var instances = cache._instances[newImage.id];

			if (newImage.errorCount > 10 || (newImage.paused && !newImage.ignorePaused) || !hasCode) {

				callback({
					value: false,
					msg: `${newImage.id} - ${newImage.name}
					passes: false
		
					!paused: ${!newImage.paused}
					lambdaName: ${newImage.lambdaName}
					hasCode: ${hasCode}
					`
				})
			} else if (newImage.executionType && executionTypes[newImage.executionType] == "step-function") {
				callback({
					msg: "Step functions not supported yet",
					value: false
				});
			} else if (newImage.namedTrigger) {
				// Add Default Trigger at index 0
				newImage.namedTrigger["0"] = Math.max(newImage.namedTrigger["0"] || 0, newImage.trigger || 0);
				var sync = true;
				var anyRunning = false;
				var results = Object.keys(newImage.namedTrigger).map(key => {
					var source = (newImage.namedSettings && newImage.namedSettings[key] && newImage.namedSettings[key].source) || (newImage.lambda && newImage.lambda.settings && newImage.lambda.settings[0] && newImage.lambda.settings[0].source) || undefined;
					var moreToDo = this.hasMoreToDo(oldImage, newImage, source);
					let trigger = newImage.namedTrigger[key];
					let instance = instances[key] || {};
					let isRunning = instances[key] && !instance.completedTime;
					let completedTime = instance.completedTime || 0;
					let timeout = instance.maxDuration || newImage.timeout || 300000; // 300000 = 5 minutes, the max lambda timeout;
					let invokeTime = instance.invokeTime || 0;
					let sameToken = instance.token == trigger;

					anyRunning = anyRunning || isRunning;
					var now = moment.now();
					var result = (
						(!isRunning || (invokeTime + timeout < now)) &&
						hasCode &&
						(!sameToken || moreToDo) &&
						(
							trigger > (invokeTime + delay) || moreToDo
						)
					)

					return {
						iid: key,
						value: result,
						timedout: invokeTime + timeout < now,
						lastInvoke: invokeTime,
						msg: `${newImage.id} - ${newImage.name} - ${key}
						passes: ${result}
			
						!paused: ${!newImage.paused} || ignorePaused: ${!!newImage.ignorePaused}
						(!running: ${!isRunning} or timedout: ${invokeTime + timeout < now})
						(!sameToken: ${!sameToken} or moreToDo: ${moreToDo})
						(triggered: ${trigger > (invokeTime + delay)} or moreToDo: ${moreToDo})
			
						invokeTime: ${invokeTime}
						completedTime: ${completedTime}
						trigger: ${trigger}
						instanceToken: ${instance.token}
						`
					};

				});

				if (sync) {
					var first = true;
					results = results.sort((a, b) => a.lastInvoke - b.lastInvoke).map(a => {
						if (a.value) {
							a.value = a.value && first;
							first = false;
						}
						return a;
					});
				}
				callback(results);

			} else {

				var sameToken = false;
				for (var i in instances) {
					let instance = instances[i];
					isRunning = isRunning || !instance.completedTime;
					completedTime = Math.max(completedTime, instance.completedTime || 0);
					timeout = Math.max(timeout, instance.maxDuration || 0);
					invokeTime = Math.max(invokeTime, instance.invokeTime || 0);
					//console.log(`TOKEN: ${instance.token}`)
					sameToken = sameToken || instance.token == newImage.trigger;
				}

				timeout = timeout || newImage.timeout || 300000; // 300000 = 5 minutes, the max lambda timeout
				var now = moment.now();
				var moreToDo = this.hasMoreToDo(oldImage, newImage)
				var result = (
					(!isRunning || (invokeTime + timeout < now)) &&
					hasCode &&
					(!sameToken || moreToDo) &&
					(
						newImage.trigger > (invokeTime + delay) || moreToDo
					)
				)
				// console.log(`${newImage.id} - ${newImage.name}`)
				// console.log(`Timeout: ${timeout}`);
				// console.log(`Delay: ${delay}`);
				// console.log(`Trigger: ${newImage.trigger}, ${moment(newImage.trigger).format()}`)
				// console.log(`Completed: ${completedTime}, ${moment(completedTime).format()}`)
				// console.log(`Invoke: ${invokeTime}, ${moment(invokeTime).format()}`)
				// console.log(`Invoke + delay: ${invokeTime + delay}, ${moment(invokeTime + delay).format()}`)
				callback({
					value: result,
					timedout: invokeTime + timeout < now,
					msg: `${newImage.id} - ${newImage.name}
					passes: ${result}
		
					!paused: ${!newImage.paused} || ignorePaused: ${!!newImage.ignorePaused}
					(!running: ${!isRunning} or timedout: ${invokeTime + timeout < now})
					(!sameToken: ${!sameToken} or moreToDo: ${moreToDo})
					(triggered: ${newImage.trigger > (invokeTime + delay)} or moreToDo: ${moreToDo})
				
					invokeTime: ${invokeTime}
					completedTime: ${completedTime}
					trigger: ${newImage.trigger}
					`
				});
			}
		},
		hasMoreToDo: function(oldImage, newImage, key) {
			var reads = newImage && newImage.checkpoints && newImage.checkpoints.read || {};
			let allowed = {}
			if (key) {
				allowed = {
					[key]: true
				};
			} else if (newImage.triggers && !newImage.ignoreHasMore) {
				newImage.triggers.map(q => {
					allowed[q] = true
				});
			}
			return newImage &&
				newImage.requested_kinesis &&
				Object.keys(newImage.requested_kinesis).filter(k => allowed[k]).reduce((result, event) => {
					var latest = newImage.requested_kinesis[event];
					var checkpoint = reads[event];
					return result || !checkpoint || (latest > checkpoint.checkpoint);
				}, false) || false;

		},
		start: function(event, opts, callback) {
			configure.registry.__cron = event.__cron = event.__cron || {
				id: event.id || event.botId
			};
			if (typeof opts == "function") {
				callback = opts;
				opts = {};
			}
			opts = opts || {};

			let context = configure.registry.context;
			// Get the cron entry if needed
			let get__cron = (d) => {
				opts.lock = true;
				this.get(event.id || event.botId, {}, (err, data) => {
					if (err) {
						return d(err);
					}
					let cron = configure.registry.__cron = event.__cron = data.__cron;
					cron.ts = Date.now();
					let index = cron.iid;
					configure.registry.__cron.__requestId = opts && opts.requestId || (Math.round(Math.random() * 10000000000000000)).toString();

					var newInvokeTime = moment.now();
					var command = {
						TableName: CRON_TABLE,
						Key: {
							id: cron.id
						},
						UpdateExpression: 'set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused',
						ExpressionAttributeNames: {
							"#instances": "instances",
							"#index": index.toString(),
							"#invokeTime": "invokeTime",
							"#checkpoint": "checkpoint",
							"#ignorePaused": "ignorePaused"
						},
						ExpressionAttributeValues: {
							":value": {
								token: cron.ts,
								requestId: undefined,
								startTime: undefined,
								invokeTime: newInvokeTime,
								status: (cron && cron.instances && cron.instances[index] && cron.instances[index].status) || null
							},
							":invokeTime": newInvokeTime
						},
						"ReturnConsumedCapacity": 'TOTAL'
					};

					if (false && lastCron) {
						if (lastCron.instances && lastCron.instances[index] && lastCron.instances[index].invokeTime) {
							command.ConditionExpression = '#instances.#index.#invokeTime = :lastInvokeTime';
							command.ExpressionAttributeValues[":lastInvokeTime"] = lastCron.instances[index].invokeTime;
						} else {
							command.ConditionExpression = 'attribute_not_exists(#instances.#index.#invokeTime)';
						}
					}

					logger.log(`${cron.id} - ${cron.name} - ${cron.iid} Adding lock`)

					if (!cron.checkpoints) {
						var entry = {
							id: cron.id,
							checkpoints: {
								read: {},
								write: {}
							},
							invokeTime: command.ExpressionAttributeValues[":invokeTime"],
							requested_kinesis: {},
							lambda: {},
							time: null,
							instances: {
								[index]: command.ExpressionAttributeValues[":value"]
							},
							lambdaName: null,
							paused: false,
							name: cron.id,
							description: null
						};
						logger.log("Bot Didn't exist in Cron.  Saving Cron Entry");
						dynamodb.put(CRON_TABLE, cron.id, entry, function(err, data) {
							d(err);
						});
					} else {
						dynamodb.docClient.update(command, function(err) {
							d(err);
						});
					}
				});
			}
			let hasCallback = !!callback;
			let doGet = !hasCallback ? (d) => {
				event.__cron.ts = Date.now();
				d();
			} : get__cron;

			callback = callback || (() => {});
			if (configure.registry.__cron) {
				configure.registry.__cron.__requestId = opts && opts.requestId
			}

			let doCheckLock = (resolve, reject, callback) => {
				if (event.__cron && opts.lock) {
					event.__cron.forceComplete = false;

					this.checkLock(event.__cron, configure.registry.__cron.__requestId, opts.timeout || (context && context.getRemainingTimeInMillis && context.getRemainingTimeInMillis()) || 24 * 60 * 1000, function(lockErr, lockData) {
						callback(lockErr && "already running");
						if (lockErr) {
							reject("already running");
						} else {
							resolve();
						}
					});
				} else {
					event.__cron.forceComplete = true;
					callback();
					resolve();
				}
			}
			let result = new Promise((resolve, reject) => {
				doGet((err) => {
					logger.log(err);
					if (err) {
						return reject(err);
					}
					doCheckLock(resolve, reject, callback);
				})
			});
			let oldThen = result.then;
			result.then = (cb) => {
				if (!hasCallback) {
					result = oldThen.call(result, new Promise((resolve, reject) => {
						get__cron((err) => {
							if (err) {
								return reject(err);
							}
							doCheckLock(resolve, reject, callback);
						});
					}));
				} else {
					return oldThen.call(result, cb);
				}
			}
			return result;
		},
		end: function(status, opts, callback) {
			if (typeof status == "function") {
				callback = status;
				opts = {};
				status = undefined;
			} else if (typeof opts == "function") {
				callback = opts;
				opts = {};
			}
			if (status == undefined) {
				status = "complete";
			}
			callback = callback || (() => {});
			opts = opts || {};
			return new Promise((resolve, reject) => {

				if (!configure.registry.__cron) {
					logger.log("No bot data registered");
					callback();
					resolve();
					return;
				}

				let requestId = configure.registry.__cron && configure.registry.__cron.__requestId;
				this.reportComplete(configure.registry.__cron, requestId, (status != "complete") ? "error" : "complete", (status != "complete") ? status : '', {
					forceComplete: configure.registry.__cron.forceComplete
				}, function(completeErr, completeData) {
					callback();
					resolve();
				});
			});
		},
		run: function(event, handler, callback) {
			let err;
			return this.start(event)
				.then(() => {
					return handler();
				})
				.catch((e) => {
					err = e;
				})
				.then(() => leo.bot.end(e))
				.then(() => callback());
		},
		createBot: function(id, bot, opts) {
			return new Promise((resolve, reject) => {
				bot = Object.assign({
					lambdaName: id,
					name: bot.name,
					description: bot.description || bot.name,
					lambda: {
						settings: [bot.settings || {}]
					},
					time: bot.time,
					triggers: bot.triggers || [],
					webhook: bot.webhook,
					executionType: bot.executionType || 'lambda',
					templateId: bot.templateId || undefined,
					instances: {},
					requested_kinesis: {},
					system: bot.system || null,
					owner: bot.owner || null

				}, bot || {});
				bot.settings = bot.lambda.settings[0];
				bot.checkpoints = {
					read: (bot.triggers || []).concat(bot.settings.source || []).reduce((o, t) => {
						o[refUtil.refId(t)] = {};
						return o;
					}, {}) || {},
					write: [].concat(bot.settings.destination || []).reduce((o, t) => {
						o[refUtil.refId(t)] = {};
						return o;
					}, {}) || {}
				};

				if (bot.settings.source && !bot.settings.time) {
					bot.triggers.push(refUtil.refId(bot.settings.source));
				}
				delete bot.id;
				delete bot.settings
				logger.log("Updating Cron Entry", id, bot)
				dynamodb.update(CRON_TABLE, {
					id: id
				}, bot, extend(true, {}, opts, {
					fields: {
						instances: {
							once: true
						},
						checkpoints: {
							once: true
						},
						requested_kinesis: {
							once: true
						}
					}
				}), (err) => {
					if (err) {
						logger.log("Error Saving Cron", err);
						reject(err);
					} else {
						resolve({
							refId: refUtil.botRefId(id)
						});
					}
				});
			});
		}
	};
};
