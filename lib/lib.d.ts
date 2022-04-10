import pump from "pump";
import splitLib from "split";
import stream, { Stream } from 'stream';
import Pumpify from "pumpify";
import moment, { Moment } from "moment";
import { LeoDynamodb } from "./dynamodb";
import { LeoCron } from "./cron";
import Streams, { BatchOptions, FromCsvOptions, ProcessFunction, ToCsvOptions } from "./streams";
export { BatchOptions, FromCsvOptions, ProcessFunction, ToCsvOptions } from "./streams";
import { Event, ReadEvent, ReadableStream, WritableStream, TransformStream } from "./types";
import * as es from "event-stream";
import zlib from "zlib";
export declare type Callback = (err?: any, data?: any) => void;

export declare type ThroughEvent<T> = Event<T> | any;

export interface WriteOptions {
	useS3?: boolean;
	firehose?: boolean;
	records?: number;
	size?: number;
	time?: moment.DurationInputArg1;
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
	maxOverride?: string;
	fast_s3_read?: boolean;
	fast_s3_read_parallel_fetch_max_bytes?: number;
	stream_query_limit?: number;
}


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
export interface EnrichOptions<T, U> {
	id: string;
	inQueue: string;
	outQueue: string;
	start?: string;
	batch?: BatchOptions;
	config?: ReadOptions;
	transform: ProcessFunction<T, U>;//(payload: any, event: any, callback: ProcessFunction) => any;
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
export interface OffloadOptions<T> extends ReadOptions {
	id: string;
	inQueue: string;
	//config: ReadOptions;
	batch?: BatchOptions | Number;
	transform: ProcessFunction<T, boolean>;//(payload: any, event: any, callback: ProcessFunction) => any;
	//callback: () => any;
}

export interface CheckpointData {
	eid: string;
	units?: number;
	source_timestamp?: number,
	started_timestamp?: number,
	ended_timestamp?: number;
	start_eid?: string;
}

export interface StatsStream extends stream.Transform {
	checkpoint: {
		(callback: (err: CheckpointData) => void): void;
	};
	get: {
		(): CheckpointData;
	};
}

export declare namespace StreamUtil {

	const eventIdFromTimestamp: typeof Streams.eventIdFromTimestamp;
	const eventIdToTimestamp: typeof Streams.eventIdToTimestamp;
	const eventstream: typeof es;

	/**
	 * @param {list} //list of streams to join together between each step and forward errors + deal with clean up
	 * Type of https://github.com/mafintosh/pump
	 */
	const pipe: typeof Streams.pipe;
	const pipeAsync: typeof Streams.pipeAsync;

	const split: typeof splitLib;
	function parse<T>(skipErrors?: boolean): TransformStream<any, T>;

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
	const through: typeof Streams.through;
	const throughAsync: typeof Streams.throughAsync;

	const write: typeof Streams.writeWrapped;

	/**
	 * Used to add logging in the stream.  Helpful for debugging in between streaming operations.
	 * @param {string} prefix - prefix to include with each log
	 */
	const log: typeof Streams.log;
	function stats(botId: string, queue: string, opts?: {
		records: number;
		time: moment.DurationInputArg1;
		//debug: boolean;
	}): StatsStream;

	function toCheckpoint(config?: ToCheckpointOptions): TransformStream<unknown, unknown>;
	function fromLeo<T>(botId: string, inQueue: string, config?: ReadOptions): ReadableStream<ReadEvent<T>>;
	function toLeo<T>(botId: string, config?: WriteOptions): TransformStream<Event<T>, unknown>;
	function checkpoint(config?: {
		records: number;
		time: moment.DurationInputArg1;
		//debug: boolean;
	}): stream.Writable;


	/**
	 * Enrich events from one queue to another.
	 * @param {EnrichOptions} opts
	 * @param {function} callback - A function called when all events have been processed. (payload, metadata, done) => { }
	 */
	function enrich<T, U>(opts: EnrichOptions<T, U>, callback: Callback): void;
	/**
	 * Process events from one queue to another.
	 * @param {EnrichOptions} opts
	 * @return {stream} Stream
	 */
	function offload<T>(config: OffloadOptions<T>, callback: Callback): void;
	/**
	 * Stream for writing events to a queue zz
	 * @param {string} botId - The id of the bot
	 * @param {string} outQueue - The queue into which events will be written 
	 * @param {WriteOptions} config - An object that contains config values that control the flow of events to outQueue
	 * @return {stream} Stream
	 */
	function load<T>(botId: string, outQueue: string, config?: WriteOptions): WritableStream<Event<T> | T>;
	const devnull: typeof Streams.devnull;
	const stringify: typeof Streams.stringify;
	const gzip: typeof zlib.createGzip;
	const gunzip: typeof zlib.createGunzip;
	/**
	 * @param {string} label - The label for the log.  This will prefix every record that's loged. The result will be console.log(`${label}${count} ${Date.now()-start} ${o.eid||""}`);
	 * @param {string} records [records=1000] - How many records processed before you log.
	 */
	const counter: typeof Streams.counter;


	function passThrough(opts?: stream.TransformOptions): stream.Transform;


	const pipeline: typeof Streams.pipeline;

	function toS3(Bucket: string, File: string): stream.Writable;
	function fromS3(file: {
		bucket: string,
		key: string;
		range?: string;
	}): stream.Readable;

	function toDynamoDB(table: string, opts: {
		hash: string;
		range: string;
		records?: number;
		size?: number;
		time?: moment.DurationInputArg1;
	}): stream.Writable;

	const batch: typeof Streams.batch;

	/**
	 * @param {boolean|list} fieldList - List of fields to transform | true builds the header list dynmaically
	 * @param {ToCsvOptions} opts - fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 */
	const toCSV: typeof Streams.toCSV;
	const fromCSV: typeof Streams.fromCSV;
}
