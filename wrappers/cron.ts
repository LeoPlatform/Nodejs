import { Context } from 'aws-lambda';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { Callback, ConfigurationResources, RStreamsContext } from './types';
import { Logger } from './logger';
import { Cron } from './cron';
import { BotHandler } from './botHandler';

interface Config {
	name: string;
}

interface Event {
	[key: string]: unknown;
}

interface FilledEvent extends Event {
	[key: string]: unknown;
}

interface CronWrapper {
	(event: Event, context: Context, callback: Callback): void;
}

const cronWrapper: CronWrapper = (event, context, callback) => {
	const config: Config = { name: 'exampleConfig' };
	const dynamodb: { docClient: DocumentClient } = { docClient: new DocumentClient() };
	const logger: Logger = new Logger();
	const cron: Cron = new Cron();
	const botHandler: BotHandler = new BotHandler();

	try {
		logger.log("running");
		fill(event || {}, config, dynamodb.docClient).then((filledEvent: FilledEvent) => {
			botHandler(filledEvent, context, (err: Error | null, data: unknown) => {
				logger.log("removing lock", config.name, context.awsRequestId);
				cron.removeLock(config.name, context.awsRequestId, (err2: Error | null, data2: unknown) => {
					if (err || err2) {
						logger.log(err || err2);
					}
					callback(null, err || data);
				});
			});
		}).catch((err: Error) => {
			logger.log("error");
			cron.removeLock(config.name, context.awsRequestId, () => {
				callback(null, err);
			});
		});
	} catch (e) {
		logger.log("error");
		cron.removeLock(config.name, context.awsRequestId, () => {
			callback(null, e);
		});
	}
};

// Export CronWrapper as the same value as the default export
export { cronWrapper as CronWrapper };
export default cronWrapper;
