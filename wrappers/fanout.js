const aws = require("aws-sdk");
const async = require("async");
const eventIdFormat = "[z/]YYYY/MM/DD/HH/mm/";
const moment = require("moment");
const logger = require("leo-logger")("======= [ leo-fanout ] =======");
/**
 * @param {function(BotEvent, LambdaContext, Callback)} handler function to the code handler
 * @param {function(QueueEvent): any} eventPartition function to return the value representing what partition for the event 
 */
module.exports = (handler, eventPartition, opts = {}) => {
	if (typeof eventPartition !== "function") {
		opts = eventPartition || {};
		eventPartition = opts.eventPartition;
	}
	opts = Object.assign({
		instances: 2,
		allowCheckpoint: false
	}, opts);

	//logger.log("Fanout start");
	eventPartition = eventPartition || (event => event.eid);
	let leo = require("../index.js");
	let leoBotCheckpoint = leo.bot.checkpoint;
	let leoStreamsFromLeo = leo.streams.fromLeo;
	let leoBotCheckLock = leo.bot.checkLock;
	let leoBotReportComplete = leo.bot.reportComplete;
	let cronData;
	let checkpoints = {};

	function fixInstanceForLocal(cronData) {
		// Get fanout data from process env if running locally
		if (process.env.FANOUT_iid) {
			cronData.iid = parseInt(process.env.FANOUT_iid);
			cronData.icount = parseInt(process.env.FANOUT_icount);
			cronData.maxeid = process.env.FANOUT_maxeid;
		}
	}

	// Override reading from leo to only read up to the max event id send from the master.
	leo.streams.fromLeo = leo.read = (ID, queue, opts = {}) => {
		opts.maxOverride = min(opts.maxOverride, cronData.maxeid);
		logger.log(`Reading Queue Wrapper. Bot: ${ID}, IID: ${cronData.iid}, Queue: ${queue}, Max: ${opts.maxOverride}`);
		let reader = leoStreamsFromLeo.call(leo.streams, ID, queue, opts);
		let stream = leo.streams.pipe(reader, leo.streams.through((obj, done) => {
			let partition = Math.abs(hashCode(eventPartition(obj))) % cronData.icount;
			logger.log("[partition]", partition, "[iid]", cronData.iid, "[eid]", obj.eid, "[icount]", cronData.icount);
			if (partition == cronData.iid) {
				logger.log("------ PROCESSING: matched on partition ------");
				done(null, obj);
			} else {
				logger.log("------ NOT PROCESSING: no match on partition ------");
				done();
			}
		}));
		stream.checkpoint = reader.checkpoint;
		stream.get = reader.get;
		return stream;
	};

	// Override bot checkpointing to report back to the master
	if (opts.allowCheckpoint !== true) {
		leo.bot.checkpoint = function(id, event, params, done) {
			if (opts.allowCheckpoint) {
				return leoBotCheckpoint(id, event, params, done);
			}
			id = id.replace(/_reader$/, "");
			if (!(id in checkpoints)) {
				checkpoints[id] = {
					read: {},
					write: {}
				};
			}
			let botData = checkpoints[id][params.type || "read"];
			if (!(event in botData)) {
				botData[event] = {
					records: 0,
				};
			}
			botData[event].checkpoint = params.eid || params.kinesis_number;
			botData[event].records += params.units || params.records || 0;
			botData[event].source_timestamp = params.source_timestamp;
			botData[event].started_timestamp = params.started_timestamp;
			botData[event].ended_timestamp = params.ended_timestamp;
			logger.log(`Checkpoint Wrapper. Bot: ${id}:${cronData.iid}, Queue: ${event}, data: ${JSON.stringify(params)}`);
			done();
		};
	}

	// Override checking for bot lock.  This has already been done in the master
	leo.bot.checkLock = function(cron, runid, remainingTime, callback) {
		fixInstanceForLocal(cron);
		logger.log("Fanout Check Lock", cron.iid);
		if (cron.iid == 0) {
			leoBotCheckLock(cron, runid, remainingTime, callback);
		} else {
			logger.log(`Worker Instance CheckLock: ${cron.iid}`);
			callback(null, {});
		}
	};
	leo.bot.reportComplete = function(cron, runid, status, log, opts, callback) {
		logger.log("Fanout Report Complete", cron.iid);
		if (cron.iid == 0) {
			leoBotReportComplete(cron, runid, status, log, opts, callback);
		} else {
			logger.log(`Worker Instance ReportComplete: ${cron.iid}`);
			callback(null, {});
		}
	};


	logger.log("Fanout Return", process.env.FANOUT_iid, process.env.FANOUT_icount, process.env.FANOUT_maxeid);
	return (event, context, callback) => {

		cronData = event.__cron || {};

		fixInstanceForLocal(cronData);

		logger.log("Fanout Handler", cronData.iid);
		logger.debug("Fanout Handler Event", JSON.stringify(event, null, 2));
		logger.debug("Fanout Handler Context", JSON.stringify(context, null, 2));
		checkpoints = {};

		// If this is a worker then report back the checkpoints or error
		if (cronData.iid && cronData.icount) {
			logger.log("Fanout Worker", cronData.iid);
			let context_getRemainingTimeInMillis = context.getRemainingTimeInMillis;
			context.getRemainingTimeInMillis = () => {
				return context_getRemainingTimeInMillis.call(context) - (1000 * 3);
			};
			let wasCalled = false;
			const handlerCallback = (err, data) => {
				if (!wasCalled) {
					wasCalled = true;
					let response = {
						error: err,
						checkpoints: checkpoints,
						data: data,
						iid: cronData.iid
					};
					logger.log("Worker sending data back", cronData.iid);
					logger.debug("Worker sending back response", JSON.stringify(response, null, 2));
					if (process.send) {
						process.send(response);
					}
					callback(null, response);
				}
			};
			const handlerResponse = handler(event, context, handlerCallback);
			if (handlerResponse && typeof handlerResponse.then === 'function') {
				handlerResponse.then(data => handlerCallback(null, data)).catch(err=> handlerCallback(err));
			}
			return handlerResponse;
		} else {
			let timestamp = moment.utc();
			cronData.maxeid = timestamp.format(eventIdFormat) + timestamp.valueOf();
			cronData.iid = 0;
			logger.log("Fanout Master", cronData.iid);
			// If this is the master start the workers needed Workers
			let instances = opts.instances;
			if (typeof instances === "function") {
				instances = instances(event, cronData);
			}
			instances = Math.max(1, Math.min(instances, opts.maxInstances || 20));
			cronData.icount = instances;
			let workers = [
				new Promise(resolve => {
					setTimeout(() => {
						logger.log(`Invoking 1/${instances}`);
						let wasCalled = false; 
						const handlerCallback = (err, data) => {
							if (!wasCalled) {
								wasCalled = true;
								logger.log(`Done with instance 1/${instances}`);
								resolve({
									error: err,
									checkpoints: checkpoints,
									data: data,
									iid: 0
								});
							}
						};
						const handlerResponse = handler(event, context, handlerCallback);
						if (handlerResponse && typeof handlerResponse.then === 'function') {
							handlerResponse.then((data) => handlerCallback(null, data)).catch(err=> handlerCallback(err));
						}
						return handlerResponse;
					}, 200);
				})
			];
			for (let i = 1; i < instances; i++) {
				workers.unshift(invokeSelf(event, i, instances, context));
			}

			// Wait for all workers to return and figure out what checkpoint to persist
			logger.debug(`Waiting on all Fanout workers: count ${workers.length}`);
			Promise.all(workers).then(responses => {
				logger.log("Return from all workers, reducing checkpoints");
				let checkpoints = reduceCheckpoints(responses).map((data) => {
					logger.log("[data]", data);
					return Object.keys(data).map((botId) => {
						logger.log("[botId]", botId);
						return Object.keys(data[botId].read || {}).map((queue) => {
							logger.log("[queue]", queue);
							let params = data[botId].read[queue];
							logger.log("[params]", params);
							return (done) => {
								logger.log("---------------------- Executing checkpoint ---------------", params);
								leoBotCheckpoint(botId, queue, params, done);
							};
						});
					});
				});
				logger.log("[promise all checkpoints]", checkpoints);
				if(checkpoints && checkpoints[0] && checkpoints[0][0] && checkpoints[0][0].length) {
					logger.log("---- calling checkpoints ----");
					async.parallelLimit(checkpoints[0][0], 5, callback);
				} else {
					logger.log("---- no events processed ----");
					callback(null, true);
				}
			}).catch((err) => { 
				logger.error("[err]", err);
				return callback(err);
			});
		}
	};
};

/**
 * @param {*} event The base event to send to the worker
 * @param {number} iid The instance id of this worker
 * @param {number} count The total number of workers
 * @param {*} context Lambda context object
 * @param {function(BotEvent, LambdaContext, Callback)} handler
 */
function invokeSelf(event, iid, count, context) {
	let newEvent = {
		__cron: {
			iid,
			icount: count
		}
	};
	try {
		logger.log(`Invoking ${iid+1}/${count}`);
		newEvent = Object.assign(JSON.parse(JSON.stringify(event)), newEvent);
	} catch (err) {
		return Promise.reject(err);
	}
	return new Promise((resolve, reject) => {
		if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
			try {
				let lambdaApi = new aws.Lambda({
					region: process.env.AWS_DEFAULT_REGION,
					httpOptions: {
						timeout: context.getRemainingTimeInMillis() // Default: 120000 // Two minutes
					}
				});
				logger.log("[lambda]", process.env.AWS_LAMBDA_FUNCTION_NAME);
				const lambdaInvocation = lambdaApi.invoke({
					FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
					InvocationType: 'RequestResponse',
					Payload: JSON.stringify(newEvent),
					Qualifier: process.env.AWS_LAMBDA_FUNCTION_VERSION
				}, (err, data) => {
					logger.log(`Done with Lambda instance ${iid+1}/${count}`);
					try {
						logger.log("[lambda err]", err);
						logger.log("[lambda data]", data);
						if (err) {
							return reject(err);
						} else if (!err && data.FunctionError) {
							err = data.Payload;
							return reject(err);
						} else if (!err && data.Payload != undefined && data.Payload != 'null') {
							data = JSON.parse(data.Payload);
						}
		
						resolve(data);
					} catch (err) {
						reject(err);
					}
				});
				logger.debug("[lambda invoked invocation/payload]", lambdaInvocation, JSON.stringify(newEvent, null, 2));
			} catch (err) {
				reject(err);
			}
		} else {
			try {
			// Fork process with event
				let worker = require("child_process").fork(process.argv[1], process.argv.slice(2), {
					cwd: process.cwd(),
					env: Object.assign({}, process.env, {
						FANOUT_iid: iid,
						FANOUT_icount: count,
						FANOUT_maxeid: newEvent.__cron.maxeid,
						runner_keep_cmd: true
					}),
					execArgv: process.execArgv,
				//stdio: [s, s, s, 'ipc'],
				//shell: true
				});
				let responseData = {};
				worker.once("message", (response) => {
					logger.log(`Got Response with instance ${iid+1}/${count}`);
					responseData = response;
				});
				worker.once("exit", () => {
					logger.log(`Done with child instance ${iid+1}/${count}`);
					logger.log("[responseData]", responseData);
					resolve(responseData);
				});
			} catch (err) {
				reject(err);
			}
		}
	});
}

/**
 * 
 * @param {[checkpoint]} responses Array of responses from the workers
 * @returns {[checkpoint]} Consolidated checkpoint
 */
function reduceCheckpoints(responses) {
	let checkpoints = responses.reduce((agg, curr) => {
		if (curr && curr.error) {
			agg.errors.push(curr.error);
		}
		if(curr && curr.checkpoints) {
			Object.keys(curr.checkpoints).map(botId => {
				if (!(botId in agg.checkpoints)) {
					agg.checkpoints[botId] = curr.checkpoints[botId];
					Object.keys(curr.checkpoints[botId].read || {}).map(queue => {
						agg.checkpoints[botId].read[queue].eid = curr.checkpoints[botId].read[queue].checkpoint;
					});
				} else {
					let checkpointData = agg.checkpoints[botId].read;
					Object.keys(curr.checkpoints[botId].read || {}).map(queue => {
						if (!(queue in checkpointData)) {
							checkpointData[queue] = curr.checkpoints[botId].read[queue];
							checkpointData.read[queue].eid = curr.checkpoints[botId].read[queue].checkpoint;
						} else {
							let minCheckpoint = min(checkpointData[queue].checkpoint, curr.checkpoints[botId].read[queue].checkpoint);
							if (minCheckpoint && minCheckpoint == curr.checkpoints[botId].read[queue].checkpoint) {
								checkpointData[queue] = curr.checkpoints[botId].read[queue];
								checkpointData[queue].eid = curr.checkpoints[botId].read[queue].checkpoint;
								agg.checkpoints[botId].read = checkpointData;
							}
						}
					});
				}
				
			});
		}
		return agg;
	}, {
		errors: [],
		checkpoints: {}
	});
	logger.log("[responses]", JSON.stringify(responses, null, 2));
	logger.log("[checkpoints]", JSON.stringify(checkpoints, null, 2));
	if(checkpoints.errors && checkpoints.errors.length) {
		throw new Error("errors from sub lambdas");
	} else {
		delete checkpoints.errors;
	}
	let vals = Object.values(checkpoints);
	
	if(vals) {
		return Object.values(vals);
	} else {
		return [];
	}
}

/**
 * @param {string|number} str Converts {str} to a hash code value
 */
function hashCode(str) {
	if (typeof str === "number") {
		return str;
	} else if (Array.isArray(str)) {
		let h = 0;
		for (let a = 0; a < str.length; a++) {
			h += hashCode(str[a]);
		}
		return h;
	}
	let hash = 0,
		i, chr;
	if (str.length === 0) return hash;
	for (i = 0; i < str.length; i++) {
		chr = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
}

function min(...args) {
	var current = args[0];
	for (var i = 1; i < args.length; ++i) {
		if (current == undefined) {
			current = args[i];
		} else if (args[i] != null && args[i] != undefined) {
			current = current < args[i] ? current : args[i];
		}
	}
	return current;
}
