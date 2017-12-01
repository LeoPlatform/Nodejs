"use strict";
let extend = require("extend");
var ls = require("./lib/stream/leo-stream");
var logging = require("./lib/logging.js");
var LeoConfiguration = require("./lib/configuration.js");


function SDK(id, data) {
	if (typeof id != "string") {
		data = id;
		id = data.id || "default_bot";
	}

	let configuration = new LeoConfiguration(data);

	let logger = null;
	if (data && data.logging) {
		logger = logging(id, configuration);
	}

	var leoStream = ls(configuration);
	return Object.assign((id, data) => {
		return new SDK(id, data)
	}, {
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
		checkpoint: leoStream.toCheckpoint,
		streams: leoStream,
		bot: leoStream.cron,
		aws: {
			dynamodb: leoStream.dynamodb,
			s3: leoStream.s3
		}
	});
}



module.exports = new SDK(false);