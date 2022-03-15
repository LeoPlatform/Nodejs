import moment from "moment";
import Pumpify from "pumpify";
import stream from "stream";
import { Callback, EnrichOptions, OffloadOptions, ReadOptions, StreamUtil, ToCheckpointOptions, WriteOptions } from "./lib/lib";
import { LeoCron } from "./lib/cron";
import { LeoDynamodb } from "./lib/dynamodb";
import AWS from "aws-sdk";

export interface ConfigurationResources {
	Region: string;
	LeoStream: string;
	LeoCron: string;
	LeoEvent: string;
	LeoS3: string;
	LeoKinesisStream: string;
	LeoFirehoseStream: string;
	LeoSettings: string;
}

export interface Configuration {
	aws: { region: string },
	_meta: { region: string },
	resources: ConfigurationResources,
	region: string,
	registry: any;

	// TODO: These exist but do we need to expose them
	//onUpdate: [Function: onUpdate],
	//update: [Function: update],
	//validate: [Function: validate],
	//setProfile: [Function: setProfile],
	//bus: {
	//	s3: 'clinttestbus-bus-1au1enwirg4no-leos3-feq3u3g89jgu',
	//	firehose: 'ClintTestBus-Bus-1AU1ENWIRG4NO-LeoFirehoseStream-4AGnnPEP5kml'
	//},
	//firehose: 'ClintTestBus-Bus-1AU1ENWIRG4NO-LeoFirehoseStream-4AGnnPEP5kml',
	//kinesis: 'ClintTestBus-Bus-1AU1ENWIRG4NO-LeoKinesisStream-n0KNkKCuP8EJ',
	//s3: 'clinttestbus-bus-1au1enwirg4no-leos3-feq3u3g89jgu',
	//stream: 'ClintTestBus-Bus-1AU1ENWIRG4NO-LeoKinesisStream-n0KNkKCuP8EJ',
}

export interface RStreamsSdk {
	configuration: Configuration;
	destroy: (callback: (err: any) => void) => void;
	/**
	 * Stream for writing events to a queue
	 * @param {string} botId - The id of the bot
	 * @param {string} outQueue - The queue into which events will be written 
	 * @param {WriteOptions} config - An object that contains config values that control the flow of events to outQueue
	 * @return {stream} Stream
	 */
	load: (botId: string, outQueue: string, config?: WriteOptions) => Pumpify;

	/**
	 * Process events from a queue.
	 * @param {OffloadOptions} opts
	 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
	 */
	offload: (config: OffloadOptions, callback: Callback) => void;
	/**
	 * Enrich events from one queue to another.
	 * @param {EnrichOptions} opts
	 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
	 */
	enrich: (opts: EnrichOptions, callback: Callback) => void;

	read: (botId: string, inQueue: string, config?: ReadOptions) => stream.Transform;
	write: (botId: string, config?: WriteOptions) => stream.Transform;
	put: (bot_id: string, outQueue: string, payload: any, callback: Callback) => void;
	//checkpoint: (config?: ToCheckpointOptions) => stream.Transform;

	/** 
	 * @return Rstreams - used to get the leo stream to do more advanced processing of the streams.
	*/
	streams: StreamUtil,
	bot: LeoCron,
	aws: {
		dynamodb: LeoDynamodb,
		s3: AWS.S3,
		cloudformation: AWS.CloudFormation
	}
}

declare function ExportTypeFn(config?: ConfigurationResources): RStreamsSdk;
export default ExportTypeFn;
//export { ExportTypeFn, RStreamsSdk };
