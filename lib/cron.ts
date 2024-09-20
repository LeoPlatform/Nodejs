"use strict";

import moment from "moment";
import zlib from "zlib";
import extend from "extend";
import dynamo from "./dynamodb.js";
import refUtil from "./reference.js";
import { Logger } from 'leo-logger';

const logger: Logger = require('leo-logger')('leo-cron');

interface Configure {
	resources: {
		LeoCron: string;
		LeoSettings: string;
		LeoSystem: string;
	};
	registry: {
		__cron?: {
			id: string;
			checkpoints?: {
				read: Record<string, unknown>;
				write: Record<string, unknown>;
			};
			lastResult?: string;
			systems?: Record<string, unknown>;
			force?: boolean;
			iid?: string;
			__requestId?: string;
			forceComplete?: boolean;
		};
		cron_message?: unknown;
		context?: {
			getRemainingTimeInMillis?: () => number;
		};
	};
}

interface Cron {
	id: string;
	lambdaName?: string;
	trigger?: number;
	time?: unknown;
	instances?: Record<string, Instance>;
	iid?: string;
	ts?: number;
	ignoreLock?: boolean;
	force?: boolean;
	result?: unknown;
	message?: string;
	preventRunAgain?: boolean;
	checkpoints?: {
		read: Record<string, unknown>;
		write: Record<string, unknown>;
	};
	requested_kinesis?: Record<string, unknown>;
	lambda?: {
		settings: Array<Record<string, unknown>>;
	};
	//namedSettings?: Record<string, unknown>; // This should have been called settings
	settings?: Record<string, unknown>; // This should have been called settings
	timeout?: number;
	paused?: boolean;
	ignorePaused?: boolean;
	errorCount?: number;
	executionType?: string;
	namedTrigger?: Record<string, number>;
	triggers?: string[];
	ignoreHasMore?: boolean;
	name?: string;
	description?: string;
	webhook?: unknown;
	system?: unknown;
	owner?: unknown;
}

interface Instance {
	token?: string;
	startTime?: number;
	requestId?: string;
	maxDuration?: number;
	completedTime?: number;
	invokeTime?: number;
	status?: string;
}

interface CheckpointData {
	checkpoint: string | number;
	source_timestamp: number;
	started_timestamp: number;
	ended_timestamp: number;
	records: number;
}

export default function (configure: Configure) {
	configure = configure || {} as Configure;
	const dynamodb = new dynamo(configure);

	(process as any).__config = (process as any).__config || configure;
	(process as any).__config.registry = (process as any).__config.registry || {};
	configure.registry = extend(true, (process as any).__config.registry, configure.registry || {});

	const CRON_TABLE = configure.resources.LeoCron;
	const SETTINGS_TABLE = configure.resources.LeoSettings;
	const SYSTEM_TABLE = configure.resources.LeoSystem;

	return {
		trigger: function (cron: Cron, callback: (err: Error | null, data?: { refId: string }) => void) {
			const params = {
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
			dynamodb.docClient.update(params, function (err) {
				callback(err, {
					refId: cron.id
				});
			});
		},

		// ... (rest of the methods with TypeScript types)

		createBot: function (id: string, bot: Partial<Cron>, opts?: unknown): Promise<{ refId: string }> {
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
					templateId: bot.templateId,
					instances: {},
					requested_kinesis: {},
					system: bot.system || null,
					owner: bot.owner || null
				}, bot || {});

				bot.settings = (bot.lambda?.settings[0] as Record<string, unknown>) || {};
				bot.checkpoints = {
					read: (bot.triggers || []).concat(bot.settings.source as string[] || []).reduce((o, t) => {
						o[refUtil.refId(t)] = {};
						return o;
					}, {} as Record<string, unknown>),
					write: [].concat(bot.settings.destination as string[] || []).reduce((o, t) => {
						o[refUtil.refId(t)] = {};
						return o;
					}, {} as Record<string, unknown>)
				};

				if (bot.settings.source && !bot.settings.time) {
					bot.triggers?.push(refUtil.refId(bot.settings.source as string));
				}
				delete bot.id;
				delete bot.settings;
				logger.log("Updating Cron Entry", id, bot);
				dynamodb.update(CRON_TABLE, {
					id: id
				}, bot as Record<string, unknown>, extend(true, {}, opts, {
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

}
