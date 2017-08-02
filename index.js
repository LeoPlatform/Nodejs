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
		 * Stream for writting events to a queue
		 * @param {string} id - The id of the bot
		 * @param {string} outQueue - The queue into which events will be written 
		 * @return {stream} Stream
		 */
		load: leoStream.load,

		/**
		 * Process events from a queue.
		 * @param {Object} opts
		 * @param {string} opts.id - The id of the bot
		 * @param {string} opts.inQueue - The queue from which events will be read
		 * @param {function} opts.transform - A function to transform data from inQueue
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
		 * @param {function} opts.transform - A function to transform data from inQueue to outQueue
		 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
		 * @return {stream} Stream
		 */
		enrich: leoStream.enrich,

		streams: leoStream
	};
};