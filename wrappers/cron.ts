"use strict";

import { Bot, Configuration, AWS } from "../index";
import { DynamoDB } from "aws-sdk";
import { LeoConfiguration } from "../leoConfigure";
import { Logger } from "leo-logger";
import { fillWithTableReferences } from "../lib/build-config";
import { RefUtil } from "../lib/reference";
import moment from "moment";

let cachedHandler: unknown;

interface CronEvent {
	__cron?: {
		id: string;
		iid: string;
		ts: string;
		checkpoints?: {
			read: {
				[key: string]: {
					checkpoint: unknown;
				};
			};
		};
	};
	start?: unknown;
	botId?: string;
}

interface CronContext extends Omit<AWSLambda.Context, 'callbackWaitsForEmptyEventLoop'> {
	callbackWaitsForEmptyEventLoop: boolean;
	resources: Record<string, unknown>;
	botId: string;
	getCheckpoint: (queue: string | { id: string }, defaultIfNull: unknown, callback?: (err: Error | null, checkpoint: unknown) => void) => unknown;
	settings: Record<string, unknown>;
	sdk: typeof import("../index");
}

type CronCallback = (error: Error | null, result?: unknown) => void;
type BotHandler = (event: CronEvent, context: CronContext, callback: CronCallback) => void | Promise<unknown>;

const CronWrapper = function (configOverride: Partial<LeoConfiguration>, botHandler?: BotHandler): (event: CronEvent, context: CronContext, callback: CronCallback) => void {
	(process as any).resources = process.env.Resources ? JSON.parse(process.env.Resources) : {};

	let config: LeoConfiguration = require("../leoConfigure.js");
	const logger: Logger = require('leo-logger')('cron.wrapper');
	const cmdLogger: Console | Logger = process.env.LEO_LOGGER_CRON === "true" ? logger : console;
	const leosdk: typeof import("../index") = require("../index.js");
	const refUtil: RefUtil = require("../lib/reference.js");

	(process as unknown as { __config: LeoConfiguration }).__config = (process as unknown as { __config: LeoConfiguration }).__config || config;
	(process as unknown as { __config: LeoConfiguration }).__config.registry = (process as unknown as { __config: LeoConfiguration }).__config.registry || {};
	config.registry = Object.assign((process as unknown as { __config: LeoConfiguration }).__config.registry, config.registry || {});

	const fill: typeof fillWithTableReferences = require("../lib/build-config").fillWithTableReferences;
	process.env.TZ = config.timezone;

	const botId: string = config.name;
	const settings: Record<string, unknown> = config.cron && config.cron.settings || {};

	let decrypted = false;

	const cron: Bot = leosdk.bot;
	const dynamodb: AWS.DynamoDB = leosdk.aws.dynamodb;

	for (let x of process.listeners('uncaughtException')) {
		process.removeListener('uncaughtException', x);
	}

	let theCallback: CronCallback | undefined;
	let theContext: Partial<CronContext> = {};
	let __theEvent: Partial<CronEvent> = {};

	process.on('uncaughtException', function (err: Error) {
		cmdLogger.log(`[LEOCRON]:end:${config.name}:${theContext.awsRequestId}`);
		logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
		logger.error(err.stack);
		if (__theEvent.__cron) {
			cron.reportComplete(__theEvent.__cron, theContext.awsRequestId as string, "error", {
				msg: err.message,
				stack: err.stack
			}, {}, function () {
				cmdLogger.log("Cron Lock removed");
				if (theCallback) {
					theCallback(null, "Application Error");
				}
			});
		} else {
			cron.removeLock(config.name, theContext.awsRequestId as string, function () {
				cmdLogger.log("Lock removed");
				if (theCallback) {
					theCallback(null, "Application Error");
				}
			});
		}
	});

	function empty(obj: Record<string, unknown>): void {
		for (let k in obj) {
			delete obj[k];
		}
	}

	if (!botHandler) {
		botHandler = configOverride as unknown as BotHandler;
		configOverride = {};
	}

	Object.assign(config, configOverride);

	return function (event: CronEvent, context: CronContext, callback: CronCallback): void {
		context.callbackWaitsForEmptyEventLoop = false;
		context.resources = (process as any).resources;
		context.botId = event.botId || botId;
		context.getCheckpoint = function (queue, defaultIfNull, callback?) {
			queue = refUtil.ref(queue);
			let c = event.start || (
				event.__cron &&
				event.__cron.checkpoints &&
				event.__cron.checkpoints.read &&
				(
					(event.__cron.checkpoints.read[queue as string] && event.__cron.checkpoints.read[queue as string].checkpoint) ||
					(event.__cron.checkpoints.read[(queue as { id: string }).id] && event.__cron.checkpoints.read[(queue as { id: string }).id].checkpoint)
				)
			) || defaultIfNull;
			if (callback) callback(null, c);
			return c;
		};

		context.settings = settings;
		context.sdk = leosdk;

		theCallback = callback;
		empty(config.registry);
		leosdk.configuration.registry = config.registry;
		config.registry.context = context;
		config.registry.__cron = event.__cron;
		(global as unknown as { cron_run_again: boolean }).cron_run_again = false;
		if (event.__cron && event.__cron.id) {
			config.registry.id = event.__cron.id;
		} else if (!config.registry.id) {
			config.registry.id = process.env.AWS_LAMBDA_FUNCTION_NAME;
		}
		logger.log("Registry", JSON.stringify(config.registry, null, 2));
		theContext = context;
		__theEvent = event;
		if (event.__cron) {
			let cronkey = event.__cron.id + ":" + event.__cron.iid + ":" + event.__cron.ts + ":" + context.awsRequestId;
			cmdLogger.log("[LEOCRON]:check:" + cronkey);
			logger.log("Locking on  __cron", event.__cron);
			let startTime = moment().valueOf();
			cron.checkLock(event.__cron, context.awsRequestId, context.getRemainingTimeInMillis(), function (err, data) {
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
							let promise = botHandler(filledEvent, context, function (err, data) {
								cmdLogger.log("[LEOCRON]:complete:" + cronkey);
								cron.reportComplete(event.__cron!, context.awsRequestId, err ? "error" : "complete", err ? err : '', {}, function (err2, data2) {
									if (err || err2) {
										logger.log(err || err2);
									}
									callback(null, err || data);
								});
							});
							if (promise && typeof promise.then == "function" && botHandler.length < 3) {
								promise.then(data => {
									cmdLogger.log("[LEOCRON]:complete:" + cronkey);
									cron.reportComplete(event.__cron!, context.awsRequestId, "complete", '', {}, function (err2, data2) {
										if (err2) {
											logger.log(err2);
										}
										callback(null, data);
									});
								});
							}
							if (promise && typeof promise.catch == "function") {
								promise.catch(err => {
									cmdLogger.log("[LEOCRON]:complete:" + cronkey);
									cron.reportComplete(event.__cron!, context.awsRequestId, "error", err, {}, function () {
										callback(null, err);
									});
								});
							}
						}).catch(err => {
							cron.reportComplete(event.__cron!, context.awsRequestId, "error", err, {}, function () {
								callback(null, err);
							});
						});
					} catch (e) {
						logger.log("error", e);
						cron.reportComplete(event.__cron!, context.awsRequestId, "error", {
							msg: (e as Error).message,
							stack: (e as Error).stack
						}, {}, function () {
							callback(null, e);
						});
					}
				}
			});
		} else {
			cmdLogger.log("Locking Settings");

			cron.createLock(config.name, context.awsRequestId, context.getRemainingTimeInMillis() + 100, function (err, data) {
				if (err) {
					logger.log("LOCK EXISTS, cannot run");
					callback(null, "already running");
				} else {
					try {
						logger.log("running");
						fill(event || {}, config, dynamodb.docClient).then(filledEvent => {
							botHandler(filledEvent, context, function (err, data) {
								logger.log("removing lock", config.name, context.awsRequestId);
								cron.removeLock(config.name, context.awsRequestId, function (err2, data2) {
									if (err || err2) {
										logger.log(err || err2);
									}
									callback(null, err || data);
								});
							});
						}).catch(err => {
							logger.log("error");
							cron.removeLock(config.name, context.awsRequestId, function () {
								callback(null, err);
							}, "error");
						});
					} catch (e) {
						logger.log("error");
						cron.removeLock(config.name, context.awsRequestId, function () {
							callback(null, e);
						});
					}
				}
			});
		}
	};
};
export = CronWrapper;
export { CronWrapper };
