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


/**
 * A standard callback function.  If the operation failed, return the first argument only,
 * often a string or an Error object.  If the operation succeeded and nothing needs to be
 * returned from the callback, pass no arguments.  If the operation succeeded and something
 * needs to be returned through the callback, pass null as the first argument and the return
 * object as the second argument.
 * 
 * @param err If present, indicates the operation failed.
 * @param data If present and err is not present, the return value from the operation.
 */
export declare type Callback = (err?: any, data?: any) => void;

/**
 * Used to marke an event used in through operations.
 * 
 * @typeParam T The payload of the event.
 * @see [[`StreamUtil.through`]]
 */
export declare type ThroughEvent<T> = Event<T> | any;

/**
 * Options when writing data to an instance of the RStreams bus.
 */
export interface WriteOptions {
	/**
	 * If true, the SDK will write events to S3 and then pass a single event to kinesis whose payload
	 * references the S3 file.  Thus, one actual event flows through Kinesis and is eventually
	 * written to the RStreams bus DynamoDB table that stores events in queues will have a single
	 * event written to it that references the S3 file.  When reading events, the SDK will detect it has
	 * received an event in a queue that is really a reference to S3 and retrieve the portion of the S3
	 * file needed to fulfill the SDK read request made.
	 * 
	 * This can be useful when a very large number of events need to be written all at once or if the
	 * events are large.  However, there is some additional ingestion latency incurred by this approach
	 * and also on reading.  If the size of the S3 files is large, the latency penalty for reading
	 * is negligible for most use cases.  However, waiting to batch up a sufficient number of events
	 * can cause a delay getting events into Kinesis for ingestion.  The rule of thumb is files
	 * around 2mb or larger are fine.  It's OK if an occasional file is small.  However, creating many small
	 * files smaller should be avoided as it could cause read latency.  For example, if requesting 1000 events
	 * from a queue if every two events are in an S3 file, the SDK will have to retrieve 500 files to read just
	 * 1000 events.  Use the other settings to tune the amount of data saved to the file: `records`, `size`, `time`.
	 * 
	 * If this and `firehose` are present, firehose will be used.
	 * 
	 * @default false
	 * @todo review
	 */
	useS3?: boolean;

	/**
	 * If true, firehose will be used.  Firehose batches events sent to it to an S3 file in 1 minute
	 * increments, which of course adds at least a one minute latency. However, firehose can take a vast number 
	 * of concurrent writes compared to kinesis.  So, use this when you have a giant number of concurrent events 
	 * you wish to write, where a giant number is X events per X amount of time.
	 * 
	 * An RStreams Bus system bot reads the 1 minute batched S3 files written to firehose, separates the events 
	 * in the file into separate S3 files by queue and then sends a single event to kinesis for each resulting 
	 * queue-specific S3 file. From there, processing continues as if events were sent to kinesis using s3.
	 * 
	 * If this and `s3` are present, firehose will be used.
	 * 
	 * @default false
	 * @TODO question How many concurrent events means we should use kinesis?  Replace X in paragraph above.
	 * @TODO review
	 */
	firehose?: boolean;

	/**
	 * The number of records, where each record is an event, to micro-batch locally in the SDK before writing 
	 * them to either kinesis, firehose or S3.  See the other options in this object to understand how this 
	 * might be useful.
	 * 
	 * The SDK will write events as soon as one of the `records`, `size` or `time` conditions are met.
	 * 
	 * @default kinesis 100 records (events)
	 * @default S3 1 file
	 * @default firehose 10,000 records (events)
	 */
	records?: number;

	/**
	 * The number of bytes to micro-batch locally in the SDK before writing them to either kinesis, firehose or S3.
	 * See the other options in this object to understand how this might be useful.
	 * 
	 * The SDK will write events as soon as one of the `records`, `size` or `time` conditions are met.
	 * 
	 * @default kinesis 200k
	 * @default S3 unbounded
	 * @default firehose 900k
	 */
	size?: number;

	/**
	 * The amount of time to micro-batch locally in the SDK before writing events to either kinesis, firehose or S3.
	 * See the other options in this object to understand how this might be useful.
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * The SDK will write events as soon as one of the `records`, `size` or `time` conditions are met.
	 * 
	 * @default kinesis 200ms
	 * @default S3 unbounded
	 * @default firehose 900k
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */
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
