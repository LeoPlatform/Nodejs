import moment from "moment";
import Pumpify from "pumpify";
import stream from "stream";
import { LeoStream, fromRStreams } from "./lib/lib";
import { LeoCron } from "./lib/cron";
import { LeoDynamodb } from "./lib/dynamodb";
import AWS from "aws-sdk";

interface LeoSdk {
	destroy: (callback: (err: any) => void) => void;
	load: (
		/**
		* @param {string} botId - The id of the bot
		*/
		botId: string,
		/** 
		* @param {string} outQueue - The queue into which events will be written
		*/
		outQueue: string,
		/** 
		* @param { Object } config - An object that contains config values that control the flow of events to outQueue
		*/
		config?: {
			useS3?: boolean;
			autoDetectPayload?: boolean;
		}
		/**
		* @return stream
		*/
	) => Pumpify;
	offload: (config: {
		/** 
		* @param {string} id - The id of the bot
		*/
		id: string;
		/**
		* @param {string} inQueue - The queue from which events will be read
		*/
		inQueue: string;
		/**
		* @param {string} config -  An object that contains config values that control the flow of events from inQueu
		*/
		config?: fromRStreams;
		/**
		* @param {function} batch - A function to batch data from inQueue (optional)
		*/
		batch?: () => any;
		/**
		* @param {function} each - A function to transform data from inQueue or from batch function, and offload from the platform
		*/
		each?: (payload, event) => any
	},
		/**
		* @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
		*/
		callback: () => any

		/**
		* @return stream
		*/
	) => Pumpify;
	enrich: (config: {
		/**
		* @param {string} id - The id of the bot
		*/
		id: string;
		/**
		* @param {string} inQueue - The queue from which events will be read
		*/
		inQueue: string;
		/**
		* @param {string} outQueue - The queue into which events will be written
		*/
		outQueue: string;
		/**
		* @param {string} config -  An object that contains config values that control the flow of events from inQueu
		*/
		config?: fromRStreams;
		/**
		* @param {function} each - A function to transform data from inQueue to outQueue
		*/
		transform: (payload, event) => any;
	},
		/**
		* @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
		*/
		callback: (err) => any
		/**
		* @return stream
		*/
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
