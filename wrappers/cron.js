"use strict";


let cachedHandler;
module.exports = function(configOverride, botHandler) {
	process.resources = process.env.Resources && JSON.parse(process.env.Resources) || {};

	let config = require("../leoConfigure.js");
	//const async = require("async");
	const logger = require('leo-logger')('cron.wrapper');
	const cmdLogger = process.env.LEO_LOGGER_CRON === "true" ? logger : console;
	const leosdk = require("../index.js");
	//const kms = require("../lib/kms")(leosdk.configuration);
	const refUtil = require("../lib/reference.js");

	process.__config = config;
	const fill = require("../lib/build-config").fillWithTableReferences;
	process.env.TZ = config.timezone;
	// require('source-map-support').install({
	// 	environment: 'node',
	// 	handleUncaughtExceptions: false
	//});

	//const handler = "____HANDLER____";
	//const pkg = require("____PACKAGEJSON____");
	const botId = config.name;
	const settings = config.cron && config.cron.settings || {};

	const moment = require("moment");
	let decrypted = false;
	// let botHandler = function(event, context, callback) {
	// 	let tasks = [];
	// 	Object.keys(process.env).forEach(function(key) {
	// 		if (!decrypted && process.env[key] != undefined && (key.toLowerCase().indexOf('kms') !== -1 || process.env[key].match(/^KMS:/)) && !key.match(/^npm_/)) {
	// 			tasks.push(function(done) {
	// 				kms.decryptString(process.env[key].replace(/^KMS:/, ""), function(err, value) {
	// 					if (err) {
	// 						return done(err);
	// 					}
	// 					process.env[key] = value;
	// 					done();
	// 				});
	// 			});
	// 		}
	// 	});
	// 	async.parallelLimit(tasks, 20, function(err, results) {
	// 		if (err) {
	// 			return callback(err);
	// 		}
	// 		decrypted = true;
	// 		require("____FILE____")[handler](event, context, callback);
	// 	});
	// };

	const cron = leosdk.bot;
	const dynamodb = leosdk.aws.dynamodb;

	for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
		process.removeListener('uncaughtException', x);
	}
	let theCallback;
	let theContext = {};
	let __theEvent = {};
	process.on('uncaughtException', function(err) {
		cmdLogger.log(`[LEOCRON]:end:${config.name}:${theContext.awsRequestId}`);
		logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
		logger.error(err.stack);
		if (__theEvent.__cron) {
			cron.reportComplete(__theEvent.__cron, theContext.awsRequestId, "error", {
				msg: err.message,
				stack: err.stack
			}, {}, function() {
				cmdLogger.log("Cron Lock removed");
				if (theCallback) {
					theCallback(null, "Application Error");
				}
			});
		} else {
			cron.removeLock(config.name, theContext.awsRequestId, function() {
				cmdLogger.log("Lock removed");
				if (theCallback) {
					theCallback(null, "Application Error");
				}
			});
		}

	});

	function empty(obj) {
		for (let k in obj) {
			delete obj[k];
		}
	}
	if (!botHandler) {
		botHandler = configOverride;
		configOverride = {};
	}

	Object.assign(config, configOverride);
	return function(event, context, callback) {
		context.callbackWaitsForEmptyEventLoop = false;
		context.resources = process.resources;
		context.botId = event.botId || botId;
		context.getCheckpoint = function(queue, defaultIfNull, callback) {
			queue = refUtil.ref(queue);
			let c = event.start || (
				event.__cron &&
				event.__cron.checkpoints &&
				event.__cron.checkpoints.read &&
				(
					(event.__cron.checkpoints.read[queue] && event.__cron.checkpoints.read[queue].checkpoint) ||
					(event.__cron.checkpoints.read[queue.id] && event.__cron.checkpoints.read[queue.id].checkpoint))
			) || defaultIfNull;
			if (callback) callback(null, c);
			return c;
		};

		context.settings = settings;
		context.sdk = leosdk;


		// if (event.requestContext) { //new lambda proxy method
		// 	if (event.isBase64Encoded) {
		// 		event.body = JSON.parse(new Buffer(event.body, 'base64'));
		// 	} else {
		// 		event.body = JSON.parse(event.body);
		// 	}
		// 	event.params = {
		// 		path: event.pathParameters || {},
		// 		querystring: event.queryStringParameters || {}
		// 	};
		// 	Object.keys(event.params.path).map((key) => {
		// 		event.params.path[key] = decodeURIComponent(event.params.path[key]);
		// 	});
		// }

		theCallback = callback;
		//clear out the registry
		empty(config.registry);
		leosdk.configuration.registry = config.registry;
		config.registry.context = context;
		config.registry.__cron = event.__cron;
		global.cron_run_again = false;
		if (event.__cron && event.__cron.id) { //If it is in cron, use that regardless
			config.registry.id = event.__cron.id;
		} else if (!config.registry.id) { //If they didn't specify it in their config, then let's get it from the function name
			config.registry.id = process.env.AWS_LAMBDA_FUNCTION_NAME;
		}
		logger.log("Registry", JSON.stringify(config.registry, null, 2));
		theContext = context;
		__theEvent = event;
		if (event.__cron) {
			let cronkey = event.__cron.id + ":" + event.__cron.iid + ":" + event.__cron.ts + ":" + context.awsRequestId;
			cmdLogger.log("[LEOCRON]:check:" + cronkey);
			logger.log("Locking on  __cron", event.__cron);
			let startTime = moment.now();
			cron.checkLock(event.__cron, context.awsRequestId, context.getRemainingTimeInMillis(), function(err, data) {
				if (err) {
					if (err && err.code == "ConditionalCheckFailedException") {
						logger.log("LOCK EXISTS, cannot run");
						callback(null, "already running");
					} else {
						logger.error("Failed getting lock, cannot run");
						callback(null, "failed getting lock");
					}
				} else {
					try {
						cmdLogger.log("[LEOCRON]:start:" + cronkey);
						fill(event || {}, config, dynamodb.docClient).then(filledEvent => {
							let promise = botHandler(filledEvent, context, function(err, data) {
								cmdLogger.log("[LEOCRON]:complete:" + cronkey);
								cron.reportComplete(event.__cron, context.awsRequestId, err ? "error" : "complete", err ? err : '', {}, function(err2, data2) {
									if (err || err2) {
										logger.log(err || err2);
									}
									callback(null, err || data);
								});
							});
							if (promise && typeof promise.then == "function" && botHandler.length < 3) {
								promise.then(data => {
									cmdLogger.log("[LEOCRON]:complete:" + cronkey);
									cron.reportComplete(event.__cron, context.awsRequestId, err ? "error" : "complete", err ? err : '', {}, function(err2, data2) {
										if (err || err2) {
											logger.log(err || err2);
										}
										callback(null, err || data);
									});
								});
							}
							if (promise && typeof promise.catch == "function") {
								promise.catch(err => {
									cmdLogger.log("[LEOCRON]:complete:" + cronkey);
									cron.reportComplete(event.__cron, context.awsRequestId, "error", err, {}, function() {
										callback(null, err);
									});
								});
							}
						}).catch(err => {
							cron.reportComplete(event.__cron, context.awsRequestId, "error", err, {}, function() {
								callback(null, err);
							});
						});
					} catch (e) {
						logger.log("error", e);
						cron.reportComplete(event.__cron, context.awsRequestId, "error", {
							msg: e.message,
							stack: e.stack
						}, {}, function() {
							callback(null, e);
						});
					}

				}

			});
		} else {
			cmdLogger.log("Locking Settings");

			cron.createLock(config.name, context.awsRequestId, context.getRemainingTimeInMillis() + 100, function(err, data) {
				if (err) {
					logger.log("LOCK EXISTS, cannot run");
					callback(null, "already running");
				} else {
					try {
						logger.log("running");
						fill(event || {}, config, dynamodb.docClient).then(filledEvent => {
							botHandler(filledEvent, context, function(err, data) {
								logger.log("removing lock", config.name, context.awsRequestId);
								cron.removeLock(config.name, context.awsRequestId, function(err2, data2) {
									if (err || err2) {
										logger.log(err || err2);
									}
									callback(null, err || data);
								});
							});
						}).catch(err => {
							logger.log("error");
							cron.removeLock(config.name, context.awsRequestId, function() {
								callback(null, err);
							}, "error");
						});
					} catch (e) {
						logger.log("error");
						cron.removeLock(config.name, context.awsRequestId, function() {
							callback(null, e);
						});
					}

				}
			});
		}
	};
};
