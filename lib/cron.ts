"use strict";

import moment from "moment";
import zlib from "zlib";
import extend from "extend";
import { DynamoDB } from "./dynamodb";
import { refUtil } from "./reference";
import { Logger } from 'leo-logger';
import { ConfigurationResources } from '../lib/types';

const logger: Logger = require('leo-logger')('leo-cron');

interface Cron {
	id: string;
}

interface TriggerCallback {
	(err: Error | null, data: { refId: string }): void;
}

interface ScheduleOptions {
	id: string;
	duration: number;
}

interface CronTable {
	[key: string]: unknown;
}

interface SettingsTable {
	[key: string]: unknown;
}

interface SystemTable {
	[key: string]: unknown;
}

interface Registry {
	[key: string]: unknown;
}

interface Config {
	resources: ConfigurationResources;
	registry: Registry;
}

function trigger(cron: Cron, callback: TriggerCallback): void {
	const params = {
		TableName: process.__config.resources.LeoCron,
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
	const dynamodb: DynamoDB = new DynamoDB(process.__config);
	dynamodb.docClient.update(params, (err) => {
		callback(err, {
			refId: cron.id
		});
	});
}

function schedule(options: ScheduleOptions): void {
	// implement schedule function
}

function exports(configure: Config): {
	trigger: (cron: Cron, callback: TriggerCallback) => void;
	schedule: (options: ScheduleOptions) => void;
} {
	configure = configure || {};
	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});

	const CRON_TABLE: string = configure.resources.LeoCron;
	const SETTINGS_TABLE: string = configure.resources.LeoSettings;
	const SYSTEM_TABLE: string = configure.resources.LeoSystem;

	return {
		trigger,
		schedule
	};
}

export default exports;
