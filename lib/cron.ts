import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { Callback } from './types';
import { Logger } from './logger';

const dynamodb: { docClient: DocumentClient } = { docClient: new DocumentClient() };
const logger: Logger = new Logger();

interface Cron {
	trigger(cron: string, callback: Callback): void;
	schedule(id: string, duration: number): void;
	checkLock(cron: string, runid: string, remainingTime: number, callback: Callback): void;
	reportComplete(cron: string, runid: string, status: string, log: unknown, opts: unknown, callback: Callback): void;
	createLock(id: string, runid: string, maxDuration: number, callback: Callback): void;
	removeLock(id: string, runid: string, callback: Callback): void;
}

const cron: Cron = {
	trigger: function (cron: string, callback: Callback): void {
		// Implementation here
	},
	schedule: function (id: string, duration: number): void {
		// Implementation here
	},
	checkLock: function (cron: string, runid: string, remainingTime: number, callback: Callback): void {
		// Implementation here
	},
	reportComplete: function (cron: string, runid: string, status: string, log: unknown, opts: unknown, callback: Callback): void {
		// Implementation here
	},
	createLock: function (id: string, runid: string, maxDuration: number, callback: Callback): void {
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
			ReturnConsumedCapacity: 'TOTAL'
		}, function (err) {
			if (err) {
				logger.error(err);
				callback(err);
			} else {
				callback(null);
			}
		});
	},
	removeLock: function (id: string, runid: string, callback: Callback): void {
		// Implementation here
	}
};

export { cron };
