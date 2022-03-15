import pump from "pump";
import split from "split";
import stream from 'stream';
import Pumpify from "pumpify";
import moment, { Moment } from "moment";
import { LeoDynamodb } from "./dynamodb";
import { LeoCron } from "./cron";
import { BatchOptions, ProcessFunction, Streams } from "./streams";

import * as eventstream from "event-stream";

export declare type Callback = (err?: any, data?: any) => void;

// export interface Configuration {
// 	// TODO: Fill this out
// }

// export interface RStreams {
// 	configuration: Configuration;
// 	destroy: (callback: (err: any) => void) => void;

// 	/**
// 	 * Stream for writing events to a queue
// 	 * @param {string} id - The id of the bot
// 	 * @param {string} outQueue - The queue into which events will be written 
// 	 * @param {Object} config - An object that contains config values that control the flow of events to outQueue
// 	 * @return {stream} Stream
// 	 */
// 	load: (botId: string, outQueue: string, config?: WriteOptions) => Pumpify;


// 	/**
// 	 * Process events from a queue.
// 	 * @param {OffloadOptions} opts
// 	 * @return {stream} Stream
// 	 */
// 	offload: (config: OffloadOptions) => Pumpify;
// 	/**
// 	 * Enrich events from one queue to another.
// 	 * @param {EnrichOptions} opts
// 	 * @return {stream} Stream
// 	 */
// 	enrich: (config: EnrichOptions) => Pumpify;

// 	read: (botId: string, inQueue: string, config?: ReadOptions) => stream.Transform;
// 	write: (botId: string, config?: WriteOptions) => stream.Transform;
// 	put: (bot_id: string, outQueue: string, payload: any, callback: Callback) => void;

// 	checkpoint: (config?: ToCheckpointOptions) => stream.Transform;

// 	streams: Streams
// 	bot: LeoCron,
// 	aws: {
// 		dynamodb: LeoDynamodb,
// 		s3: AWS.S3,
// 		cloudformation: AWS.CloudFormation
// 	}
// }

export interface Event<T> {
	id: string;
	event: string;
	timestamp: number;
	event_source_timestamp: string;
	payload: T;
	correlation_id: {
		source: string;
		start?: string;
		end?: string;
		units: number;
	};
}
export interface ReadEvent<T> extends Event<T> {
	eid: string;
}

export declare type ThroughEvent<T> = Event<T> | any;

export interface WriteOptions {
	useS3?: boolean;
	firehose?: boolean;
	records?: number,
	size?: number,
	time?: moment.DurationInputArg1
}

export interface ReadOptions {
	subqueue?: string;
	runTime?: moment.DurationInputArg1;
	loops?: number;
	start?: string | null;
	limit?: number;
	size?: number;
	debug?: boolean;
	stopTime?: number;
}

export * from "./streams";

export interface BufferOptions {
	time?: moment.DurationInputArg1;
	size?: number;
	records?: number;
	label?: string;
	writeStream?: boolean;
	commands?: {
		ignoreCommands: string[];
	}
}

export interface ToCheckpointOptions {
	records: number;
	time: moment.DurationInputArg1;
	force: boolean;
}

/**
 * Enrich events from one queue to another.
 * @field {string} id - The id of the bot
 * @field {string} inQueue - The queue from which events will be read
 * @field {string} outQueue - The queue into which events will be written 
 * @field {Object} config - An object that contains config values that control the flow of events from inQueue and to outQueue
 * @field {function} transform - A function to transform data from inQueue to outQueue
 * @field {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
 */
export interface EnrichOptions {
	id: string;
	inQueue: string;
	outQueue: string;
	start?: string;
	batch?: BatchOptions;
	config: ReadOptions;
	transform: ProcessFunction;//(payload: any, event: any, callback: ProcessFunction) => any;
}

/**
 * Enrich events from one queue to another.
 * @field {string} id - The id of the bot
 * @field {string} inQueue - The queue from which events will be read
 * @field {string} outQueue - The queue into which events will be written 
 * @field {Object} config - An object that contains config values that control the flow of events from inQueue and to outQueue
 * @field {function} transform - A function to transform data from inQueue to outQueue
 * @field {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
 */
export interface OffloadOptions extends ReadOptions {
	id: string;
	inQueue: string;
	//config: ReadOptions;
	batch?: BatchOptions;
	transform: ProcessFunction;//(payload: any, event: any, callback: ProcessFunction) => any;
	//callback: () => any;
}

export interface StatsStream extends stream.Transform {
	checkpoint: {
		(callback: (err: any) => void): void;
	};
	get: {
		(): any;
	};
}

export interface StreamUtil {

	eventstream: typeof eventstream

	/**
	 * @param {list} //list of streams to join together between each step and forward errors + deal with clean up
	 * Type of https://github.com/mafintosh/pump
	 */
	pipe: typeof pump;
	split: typeof split;
	parse: {
		(skipErrors?: boolean): stream.Transform;
	};
	/** 
	* @param {function} func - function that takes the (event, callback, push, and flush).  When finished processing the event, call the callback and pass it back to the stream via second paramater of the callback or the push.
	* @param {function} done - callback function
	* @param {string|null|Error} done.err - callback paramater if any errors occurred
	* @param {ThroughEvent<any>} done.obj - pass the event back to the stream
	* @param {function} push - Push events back into the stream.  Often used to push multiple events from a single event read
	* @param {any} push.obj - object to pass back into the stream via bush
	* @param {function} flush - function to be called when the remaining data has been flushed
	* @returns {stream}
	*/
	through: {
		(
			func: (
				obj: ReadEvent<any> | ThroughEvent<any>,
				done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void,
				push: (obj: any) => void) => void,
			flush?: (
				done: (err?: string | null | Error) => void,
				push: (obj: any) => void) => void
		): stream.Transform;
		(
			opts: ReadEvent<any> | ThroughEvent<any>,
			func: (
				obj: any,
				done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void,
				push: (obj: any) => void) => void,
			flush?: (
				done: (err?: string | null | Error) => void,
				push: (obj: any) => void) => void
		): stream.Transform;
	};

	write: {
		(
			func: (
				obj: ReadEvent<any> | ThroughEvent<any>,
				done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void) => void,
			flush?: (
				done: (err?: string | null | Error) => void,
				push: (obj: any) => void) => void): stream.Transform;
		(
			opts: ReadEvent<any> | ThroughEvent<any>,
			func: (
				obj: any,
				done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void
			) => void,
			flush?: (
				done: (err?: string | null | Error) => void,
				push: (obj: any) => void) => void
		): stream.Transform;
	};
	/**
	 * Used to add logging in the stream.  Helpful for debugging in between streaming operations.
	 * @param {string} prefix - prefix to include with each log
	 */
	log: {
		(prefix?: string): stream.Transform;
	};
	stats: {
		(botId: string, queue: string, opts?: {
			records: number;
			time: moment.DurationInputArg1;
			//debug: boolean;
		}): StatsStream;
	};
	fromLeo: (botId: string, inQueue: string, config?: ReadOptions) => stream.Transform;
	toLeo: (botId: string, config?: WriteOptions) => stream.Transform;
	checkpoint: (config?: {
		records: number;
		time: moment.DurationInputArg1;
		//debug: boolean;
	}) => stream.Transform;


	/**
	 * Enrich events from one queue to another.
	 * @param {EnrichOptions} opts
	 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
	 */
	enrich: (opts: EnrichOptions, callback: Callback) => void;
	/**
	 * Process events from one queue to another.
	 * @param {EnrichOptions} opts
	 * @return {stream} Stream
	 */
	offload: (config: OffloadOptions, callback: Callback) => void;
	/**
	 * Stream for writing events to a queue
	 * @param {string} botId - The id of the bot
	 * @param {string} outQueue - The queue into which events will be written 
	 * @param {WriteOptions} config - An object that contains config values that control the flow of events to outQueue
	 * @return {stream} Stream
	 */
	load: (botId: string, outQueue: string, config?: WriteOptions) => stream.Writable;
	devnull: (shouldLog?: boolean | string) => stream.Transform;
	stringify: () => stream.Transform;
	gzip: () => stream.Transform;
	/**
	 * @param {string} label - The label for the log.  This will prefix every record that's loged. The result will be console.log(`${label}${count} ${Date.now()-start} ${o.eid||""}`);
	 * @param {string} records [records=1000] - How many records processed before you log.
	 */
	counter: (label: string, records?: number) => stream.Transform;
	gunzip: () => stream.Transform;
	passThrough: (opts?: stream.TransformOptions) => stream.Transform;
	pipeline: (...streams: stream.Stream[]) => Pumpify;
	toS3: (Bucket: string, File: string) => stream.Writable;
	fromS3: (file: {
		bucket: string,
		key: string;
		range?: string;
	}) => stream.Writable;
	toDynamoDB: (table: string, opts: {
		hash: string;
		range: string;
		records?: number;
		size?: number;
		time?: moment.DurationInputArg1;
	}) => stream.Writable;
	batch: (opts: BatchOptions | Number) => stream.Transform
}
