"use strict";
let extend = require("extend");
var ls = require("./lib/stream/leo-stream");

module.exports = function (data) {
	var bus = data.bus = data.bus || {};
	var aws = data.aws = data.aws || {};

	if (data.kinesis && !data.stream) {
		data.stream = data.kinesis;
	}

	if (data.s3 && !bus.s3) {
		bus.s3 = data.s3;
	}

	if (data.firehose && !bus.firehose) {
		bus.firehose = data.firehose;
	}

	if(!data.region) {	
		data.region = aws.region || 'us-west-2';
	}
	
	if (data.region && !aws.region) {
		aws.region = data.region;
	}

	delete data.kinesis;
	delete data.s3;
	delete data.fireshose;
	delete data.region;

	var leoStream = ls(data);
	return {

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
		
		/**
		 * Log a read from an external system to the platform (purely for visual representation on the work flow and to show event counts)
		 * @param {string} id - The id of the bot
		 * @param {string} inSystem - The system from which events will be loaded 
		 * @param {number} recordCount - The number of events you want to log
		 * @param {Object} config - An object that contains config values that control the flow of events to inSystem (optional)
		 * @param {function} callback - A function called when the logging operation is complete (optional)
		 * @return {stream} Stream
		 */
		load: leoStream.logSourceRead,
		
		/**
		 * Log a write to an external system to the platform (purely for visual representation on the work flow and to show event counts)
		 * @param {string} id - The id of the bot
		 * @param {string} outSystem - The system to which events will be offloaded 
		 * @param {number} recordCount - The number of events you want to log
		 * @param {Object} config - An object that contains config values that control the flow of events to outSystem (optional)
		 * @param {function} callback - A function called when the logging operation is complete (optional)
		 * @return {stream} Stream
		 */
		load: leoStream.logTargetWrite,


		streams: leoStream
	};
};