import { Cron } from '../lib/cron';
import { DynamoDB } from '../lib/dynamodb';
import { BotInvocationEvent, RStreamsContext } from '../lib/types';

interface Config {
	name: string;
	// Add other config properties as needed
}

interface Event {
	// Add event properties as needed
}

const cmdLogger = console;
const logger = console;

function fill(event: Event, config: Config, dynamodb: DynamoDB): Promise<Event> {
	// Implement fill function
	return Promise.resolve(event);
}

function botHandler(event: Event, context: RStreamsContext, callback: (err: Error | null, data: unknown) => void): void {
	// Implement botHandler function
	callback(null, {});
}

function CronWrapper(event: BotInvocationEvent, context: RStreamsContext, callback: (err: Error | null, data: unknown) => void): void {
	const config: Config = {
		name: 'configName',
		// Add other config properties as needed
	};

	const dynamodb = new DynamoDB();

	if (event.__cron && event.__cron.forceRun) {
		cmdLogger.log('Forced run');
		fill(event, config, dynamodb.docClient).then(filledEvent => {
			botHandler(filledEvent, context, (err, data) => {
				callback(err, data);
			});
		}).catch(err => {
			callback(err, null);
		});
	} else {
		cmdLogger.log('Locking Settings');
		const cron = new Cron();
		cron.createLock(config.name, context.awsRequestId, context.getRemainingTimeInMillis() + 100, (err, data) => {
			if (err) {
				logger.log('LOCK EXISTS, cannot run');
				callback(null, 'already running');
			} else {
				try {
					logger.log('running');
					fill(event, config, dynamodb.docClient).then(filledEvent => {
						botHandler(filledEvent, context, (err, data) => {
							logger.log('removing lock', config.name, context.awsRequestId);
							cron.removeLock(config.name, context.awsRequestId, (err2, data2) => {
								if (err || err2) {
									logger.log(err || err2);
								}
								callback(null, err || data);
							});
						});
					}).catch(err => {
						logger.log('error');
						cron.removeLock(config.name, context.awsRequestId, () => {
							callback(null, err);
						}, 'error');
					});
				} catch (e) {
					logger.log('error');
					cron.removeLock(config.name, context.awsRequestId, () => {
						callback(null, e);
					});
				}
			}
		});
	}
}

export default CronWrapper;
