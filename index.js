"use strict";
let leoconfig = require("leo-config");
let ls = require("./lib/stream/leo-stream");
let logging = require("./lib/logging.js");
let LeoConfiguration = require("./lib/configuration.js");
let aws = require("./lib/leo-aws");
const fs = require("fs");
const ini = require('ini');
const { default: Configuration } = require("./lib/rstreams-configuration");
const { promisify } = require("util");
const execSync = require("child_process").execSync;
const ConfigProviderChain = require("./lib/rstreams-config-provider-chain").ConfigProviderChain;
const mockWrapper = require("./lib/mock-wrapper");
const leologger = require("leo-logger")("sdk");

function SDK(id, data, awsResourceConfig) {
	if (typeof id !== "string" && id != null) {
		awsResourceConfig = data;
		data = id;
		id = data.id || "default_bot";
	}
	if (awsResourceConfig == null && data &&
		(data.dynamodbConfig || data.s3Config || data.firehoseConfig || data.kinesisConfig)) {
		awsResourceConfig = data;
		data = null;
	}

	let dataOrig = data;

	if (data == null || data === false || data instanceof Configuration) {
		let chain = data || new ConfigProviderChain();
		try {
			data = chain.resolveSync();
		} catch (err) {
			data = dataOrig;
			if (data !== false) {
				// This was a request using new sdk(), not the default import so throw the error
				throw err;
			}
			// Ignore errors because this is just trying to find the defaults
		}
	}

	// if (data.assumeRole) {
	// 	const cred = await new AWS.STS({}).assumeRole({
	// 		RoleArn: data.assumeRole,
	// 		RoleSessionName: process.env.AWS_LAMBDA_FUNCTION_NAME || uuid.v4()
	// 	}).promise();
	// 	busConfig.credentials = sts.credentialsFrom(cred);
	// }

	let configuration = new LeoConfiguration(data);
	configuration.awsResourceConfig = awsResourceConfig || {};

	let awsConfig = leoconfig.leoaws || configuration.aws;

	if (awsConfig.profile) {
		let profile = awsConfig.profile;
		let configFile = `${process.env.HOME || process.env.HOMEPATH}/.aws/config`;
		if (fs.existsSync(configFile)) {
			let config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
			let p = config[`profile ${profile}`];
			if (p && p.mfa_serial) {
				let cacheFile = `${process.env.HOME || process.env.HOMEPATH}/.aws/cli/cache/${profile}--${p.role_arn.replace(/:/g, '_').replace(/[^A-Za-z0-9\-_]/g, '-')}.json`;
				let data = {};
				try {
					data = JSON.parse(fs.readFileSync(cacheFile));
				} catch (e) {
					// Ignore error, Referesh Credentials
					data = {};
				} finally {
					console.log("Using cached AWS credentials", profile);
					if (!data.Credentials || new Date() >= new Date(data.Credentials.Expiration)) {
						execSync('aws sts get-caller-identity --duration-seconds 28800 --profile ' + profile);
						data = JSON.parse(fs.readFileSync(cacheFile));
					}
				}
				configuration.credentials = new aws.STS().credentialsFrom(data, data);
			} else {
				console.log("Switching AWS Profile", profile);
				configuration.credentials = new aws.SharedIniFileCredentials(awsConfig);
			}
		} else {
			console.log("Switching AWS Profile", awsConfig.profile);
			configuration.credentials = new aws.SharedIniFileCredentials(awsConfig);
		}
	}

	let logger = null;
	if (data && data.logging) {
		logger = logging(id, configuration);
	}

	let leoStream = ls(configuration);
	if (process.env.RSTREAMS_MOCK_DATA) {
		mockWrapper.default(leoStream);
	}

	// Only make this a function if it is the default loader
	// Otherwise use an {} as the base
	return Object.assign(dataOrig === false ? function(id, data) {
		return new SDK(id, data);
	} : {}, {
		RStreamsSdk: SDK,
		configuration: configuration,
		destroy: (callback) => {
			if (logger) {
				logger.end(callback);
			}
		},
		/**
		 * Stream for writing events to a queue
		 * @param {string} id - The id of the bot
		 * @param {string} outQueue - The queue into which events will be written 
		 * @param {Object} config - An object that contains config values that control the flow of events to outQueue
		 * @return {stream} Stream
		 */
		load: leoStream.load,

		/**
		 * Process events from a queue.
		 * @param {Object} opts
		 * @param {string} opts.id - The id of the bot
		 * @param {string} opts.inQueue - The queue from which events will be read
		 * @param {Object} opts.config - An object that contains config values that control the flow of events from inQueue
		 * @param {function} opts.batch - A function to batch data from inQueue (optional)
		 * @param {function} opts.each - A function to transform data from inQueue or from batch function, and offload from the platform
		 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
		 * @return {stream} Stream
		 */
		offload: leoStream.offload,
		/**
		 * Process events from a queue.
		 * @param {Object} opts
		 * @param {string} opts.id - The id of the bot
		 * @param {string} opts.inQueue - The queue from which events will be read
		 * @param {Object} opts.config - An object that contains config values that control the flow of events from inQueue
		 * @param {function} opts.batch - A function to batch data from inQueue (optional)
		 * @param {function} opts.each - A function to transform data from inQueue or from batch function, and offload from the platform
		 * @return {Promise<void>}
		 */
		offloadEvents: promisify(leoStream.offload).bind(leoStream),

		/**
		 * Enrich events from one queue to another.
		 * @param {Object} opts
		 * @param {string} opts.id - The id of the bot
		 * @param {string} opts.inQueue - The queue from which events will be read
		 * @param {string} opts.outQueue - The queue into which events will be written 
		 * @param {Object} opts.config - An object that contains config values that control the flow of events from inQueue and to outQueue
		 * @param {function} opts.transform - A function to transform data from inQueue to outQueue
		 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
		 * @return {stream} Stream
		 */
		enrich: leoStream.enrich,
		/**
		 * Enrich events from one queue to another.
		 * @param {Object} opts
		 * @param {string} opts.id - The id of the bot
		 * @param {string} opts.inQueue - The queue from which events will be read
		 * @param {string} opts.outQueue - The queue into which events will be written 
		 * @param {Object} opts.config - An object that contains config values that control the flow of events from inQueue and to outQueue
		 * @param {function} opts.transform - A function to transform data from inQueue to outQueue
		 * @return {Promise<void>}
		 */
		enrichEvents: promisify(leoStream.enrich).bind(leoStream),

		read: leoStream.fromLeo,
		write: leoStream.toLeo,
		put: function(bot_id, queue, payload, callback) {
			let stream = this.load(bot_id, queue, {
				kinesis: {
					records: 1
				}
			});
			stream.write(payload);
			stream.end(callback);
		},
		putEvent: function(bot_id, queue, payload) {
			return promisify(this.put).call(this, bot_id, queue, payload);
		},
		throughAsync: leoStream.throughAsync,
		checkpoint: leoStream.toCheckpoint,
		streams: leoStream,
		bot: leoStream.cron,
		aws: {
			dynamodb: leoStream.dynamodb,
			s3: leoStream.s3,
			kinesis: leoStream.kinesis,
			firehose: leoStream.firehose,
			cloudformation: new aws.CloudFormation({
				region: configuration.aws.region,
				credentials: configuration.credentials
			})
		},
		createSource: function(fn, opts = {}, state = {}) {
			let log = leologger.sub("CreateSource");
			// Set default option values
			opts = Object.assign({
				records: Number.POSITIVE_INFINITY,
				milliseconds: undefined
			}, opts);

			// Counter/Timers
			let startTime = Date.now();
			let lastStart = startTime;
			let totalRecords = 0;

			// Stream pass through - This is the returned object
			let pass = this.streams.passThrough({ objectMode: true });


			// Setup a timeout if requested
			let timeout;
			if (opts.milliseconds != null && opts.milliseconds > 0) {
				timeout = setTimeout(() => {
					if (!pass.isEnding) {
						log.debug('Requested timeout ms hit. Ending');
						pass.end();
					}
				}, opts.milliseconds);
			}

			// Override stream end to cleanup timers
			// and protect agains duplicate calls
			pass.isEnding = false;
			pass.orig_end = pass.end;
			pass.end = function() {
				log.debug('Pass.end Called');
				if (!pass.isEnding) {
					pass.isEnding = true;
					timeout && clearTimeout(timeout);
					pass.orig_end();
				}
			};


			// Convience method for async writting with backpressure
			pass.throttleWrite = function(data) {
				return new Promise((resolve) => {
					if (!pass.write(data)) {
						pass.once('drain', () => {
							resolve();
						});
					} else {
						resolve();
					}
				});
			};

			// Generator to poll for more data
			async function* poller() {

				// Get the initial set of data to stream
				let records = await fn(state);

				// Loop yielding and fetching records until 
				// 1) There are no more recrods
				// 2) Time runs out
				// 3) We have yielding the requested number of records
				outerLoop:
				while ((records != null && records.length > 0) && opts.records > totalRecords && !pass.isEnding) {
					for (const hit of records) {
						totalRecords++;

						// send the results back to the caller and wait to be resumed
						// that's why this is a generator function (function*)
						yield hit;

						// Break out of the current batch because we hit 
						// an end condition
						if (opts.records <= totalRecords || pass.isEnding) {
							break outerLoop;
						}
					}

					log.debug(`Batch Records: ${records.length}, Percent: ${totalRecords}/${opts.records}, Total Duration: ${Date.now() - startTime}, Batch Duration ${Date.now() - lastStart}`);
					lastStart = Date.now();

					// Get the next set of records
					records = await fn(state);
				}
			}

			// Async function to query and write data to the stream
			let run = (async function() {
				for await (const data of poller()) {
					await pass.throttleWrite(data);
				}
			});

			// Start running the async function with hooks to pass along errors
			// and end the pass through
			run()
				.then(() => pass.end())
				.catch(err => pass.emit('error', err));

			return pass;
		}
	});
}

module.exports = new SDK(false);
