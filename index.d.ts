import moment from "moment";
import Pumpify from "pumpify";
import stream from "stream";
import { LeoStream, fromRStreams } from "./lib/lib";
import { LeoCron } from "./lib/cron";
import { LeoDynamodb } from "./lib/dynamodb";
import AWS from "aws-sdk";

interface LeoSdk {
	destroy: (callback: (err: any) => void) => void;
	/**
	 * Stream for writing events to a queue
	 * @param {string} botId - The id of the bot
	 * @param {string} outQueue - The queue into which events will be written 
	 * @param {Object} config - An object that contains config values that control the flow of events to outQueue
	 * @return {stream} Stream
	 */
	load: (
		botId: string,
		outQueue: string,
		config?: {
			useS3?: boolean;
			autoDetectPayload?: boolean;
		}
	) => Pumpify;
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
	offload: (config: {
		id: string;
		inQueue: string;
		config?: fromRStreams;
		batch?: () => any;
		each?: (payload, event) => any
	},
		callback: () => any
	) => Pumpify;
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
	enrich: (config: {
		id: string;
		inQueue: string;
		outQueue: string;
		config?: fromRStreams;
		transform: (payload, event) => any;
	},
		callback: (err) => any
	) => Pumpify;

	read: (botId: string, inQueue: string, config?: fromRStreams) => stream.Transform;
	toLeo: (botId: string, config?: {
		useS3?: boolean;
		firehose?: boolean;
	}) => stream.Transform;
	put: (
		bot_id: string, outQueue: string, payload: any, callback: any) => void;

	checkpoint: (config?: {
		records: number;
		time: moment.DurationInputArg1;
		debug: boolean;
	}) => stream.Transform;
	/** 
	 * @return LeoStream - used to get the leo stream to do more advanced processing of the streams.
	*/
	streams: LeoStream
	bot: LeoCron,
	aws: {
		dynamodb: LeoDynamodb,
		s3: AWS.S3,
		cloudformation: AWS.CloudFormation
	}
}

declare function ExportTypeFn(config: any): LeoSdk;
export = ExportTypeFn;
