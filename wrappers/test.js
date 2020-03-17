"use strict";


let cachedHandler;
module.exports = function(configOverride, botHandler) {
	process.resources = process.env.Resources && JSON.parse(process.env.Resources) || {};

	let config = require("../leoConfigure.js");
	const logger = require('leo-logger')('test.wrapper');
	const leosdk = require("../index.js");
	const refUtil = require("../lib/reference.js");
	const assert = require("../lib/assert.js");

	process.__config = config;
	const fill = require("../lib/build-config").fillWithTableReferences;
	process.env.TZ = config.timezone;

	const botId = config.name;
	const settings = config.cron && config.cron.settings || {};

	const moment = require("moment");
	let decrypted = false;
	const cron = leosdk.bot;
	const dynamodb = leosdk.aws.dynamodb;

	for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
		process.removeListener('uncaughtException', x);
	}
	let theCallback;
	let theContext;
	let __theEvent;
	process.on('uncaughtException', function(err) {
		logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
		logger.error(err.stack);
		theCallback(null, "Application Error");
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
		let cb = callback;
		callback = (err, data) => {
			assert.print();
			cb(err, data);
		}
		context.assert = assert.clear();
		context.callbackWaitsForEmptyEventLoop = false;
		context.resources = process.resources;
		context.botId = event.botId || botId;

		context.settings = settings;

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
		let startTime = moment.now();

		try {
			let promise = botHandler(event || {}, context, function(err, data) {
				callback(null, err || data);
			});
			if (promise && typeof promise.then == "function" && botHandler.length < 3) {
				promise.then(data => {
					callback(null, err || data);
				});
			}
			if (promise && typeof promise.catch == "function") {
				promise.catch(err => {
					callback(null, err);
				});
			}
		} catch (e) {
			logger.log("error", e);
			callback(null, e);
		}


	}
}
