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
 * Defines an event used in through operations.
 * 
 * @typeParam T The payload of the event.
 * @see [[`StreamUtil.through`]]
 */
export declare type ThroughEvent<T> = Event<T> | any;

/**
 * Options when writing data to an instance of the RStreams bus.  The options in this
 * interface provide a lot of control and performance optimization options and developers
 * should familiarize themselves with them. They are used in a write pipeline step 
 * to configure how to write.
 * 
 * @todo example
 */
export interface WriteOptions {
	/**
	 * If true, the SDK will write events to S3 and then pass a single event to kinesis whose payload
	 * references the S3 file.  Thus, one actual event flows through Kinesis and that one event is eventually
	 * written to the RStreams bus' events DynamoDB table, still referencing the S3 file full of events.
	 * When reading events, the SDK will detect it has received an event in a queue that is really a reference
	 * to S3 and retrieve the portion of the S3 file needed to fulfill the SDK read request made.
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
	 * NOTE! A new feature, [[`ReadOptions.fast_s3_read`]], largely solves the problem
	 * of having lots of small S3 files by enabling the SDK to concurrently read from multiple S3 files.  
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

/**
 * Options when reading data from an instance of the RStreams bus.  The options in this
 * interface provide a lot of control and performance optimization options and developers
 * should familiarize themselves with them.  They are used in a read pipeline step 
 * to configure how to read.
 * 
 * Most bots are based on AWS lambda and lambdas can only run continuosly for 15 minutes.  
 * So, a bot that sets itself up to read events from a queue has to end at some time.
 * Depending on how the bot registered itself with the bus, after a bot shuts down 
 * the bot will either be re-invoked by the RStreams bus when there are new events to be read
 * or on whatever timer established.
 * 
 * @todo example
 */
export interface ReadOptions {
	/** @deprecated Don't use. */
	subqueue?: string;

	/**
	 * The duration of time the to read for before closing the read stream.  It is common to set this
	 * to 75% to 80% of the time remaining before the lambda is shut down to give the lambda sufficient time
	 * to finish processing.  Of course, different types of processing will differ.
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * The read stream will shutdown as soon as one of the constraints is met: `runTime`, `loops`, `limit`, `size`, 
	 * `stopTime`.
	 * 
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */
	runTime?: moment.DurationInputArg1;

	/**
	 * The max number of times the SDK will query the stream for new events before it shuts down the read stream.
	 * Consider that each query by the SDK to retrieve events from DynamoDB could return many, many events and
	 * that an "event" may actually be a pointer to an S3 file full of events.
	 * 
	 * It is uncommon for developers to have to set this, much less know it exists.
	 * 
	 * @default 100
	 */
	loops?: number;

	/**
	 * The event ID of the starting position to read from with in the queue.  It is common to not provide
	 * this because each queue is stateful in that it remembers the last read position of a bot.  Then,
	 * as bots read they make a call back to the RStreams Bus to update the read position.
	 * 
	 * Usually, the SDK just handles this for you.  So, if the start isn't provided, the SDK will just
	 * use the bot's last read position as the starting point.  So, as bots are invoked, read some events
	 * and do some processing, they automatically update back how far they've read to and then the bot shuts
	 * down after a period of time.  When the bot starts back up to read again, it knows where it last read
	 * from and just continues.
	 * 
	 * @see [Fundamentals: Event ID](rstreams-site-url/rstreams-guides/core-concepts/fundamentals/#event-id)
	 */
	start?: string | null;

	/**
	 * The limit of the number of records, events, to read in total from the queue before closing the read stream.
	 * 
	 * @default unbounded
	 * 
	 * The read stream will shutdown as soon as one of the constraints is met: `runTime`, `loops`, `limit`, `size`, 
	 * `stopTime`.
	 */
	limit?: number;

	/**
	 * The limit of the number of bytes to read in total from the queue before closing the read stream.
	 * 
	 * @default unbounded
	 * 
	 * The read stream will shutdown as soon as one of the constraints is met: `runTime`, `loops`, `limit`, `size`, 
	 * `stopTime`.
	 */
	size?: number;

	/** @deprecated Don't use. */
	debug?: boolean;

	/** When to stop reading as a time since the epoch. */
	stopTime?: number;

	/**
	 * The largest event ID that you should read, exclusive. So, stop reading when you arrive at this event ID.
	 * Use `startTime` and this option to read a range of events from a queue.
	 * 
	 * @default The SDK will take the current time and turn it into an event ID.
	 * @see [Fundamentals: Event ID](rstreams-site-url/rstreams-guides/core-concepts/fundamentals/#event-id)
	 */
	maxOverride?: string;

	/**
	 * If true, connect to multiple S3 files simultaneously to pre-fetch files when reading from a queue 
	 * that has events stored in S3. This is a new feature and so is not on by default, though it can 
	 * dramatically improve read performance.  It is expected to be made the default in Q3 2022.
	 * 
	 * @beta In use now in production and being monitored.  Expected to be GA and made the default in Q3 2022.
	 * @see [[`WriteOptions.useS3`]]
	 * @todo inconsistent fast_s3_read
	 */
	fast_s3_read?: boolean;

	/**
	 * When using the [[`ReadOptions.fast_s3_read`]] feature, this specifies how many bytes of s3 data we want 
	 * to prefetch. The default usually is correct.
	 * 
	 * @default 5mb worth of bytes
	 * @todo inconsistent fast_s3_read_parallel_fetch_max_bytes
	 */
	fast_s3_read_parallel_fetch_max_bytes?: number;

	/**
	 * The max number of records, events, the SDK should retrieve each time it retrieves events from the 
	 * RStreams Bus' Dynamo DB events table.
	 * 
	 * @default: 50 if [[`ReadOptions.fast_s3_read`]] is false
	 * @default: 1000 if [[`ReadOptions.fast_s3_read`]] is true
	 * @todo inconsistent stream_query_limit
	 */
	stream_query_limit?: number;
}

/**
 * These options govern the movement of data between steps in a Node pipeline, with a step that is the
 * source producing events and eventually a sink that ends the pipeline.
 * 
 * It is used by adding an instance of this as a step in the pipeline itself to determine when to send
 * data to the next step in the pipeline.
 * @todo example
 */
export interface BufferOptions {
	/**
	 * The amount of time to wait before sending data to the next step in the pipeline.
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * The SDK will push events to the next step in the pipeline as soon as one of the 
	 * `time`, `size` or `records` conditions are met.  It is common to set more than one to ensure
	 * the pipeline moves smoothly whether there are many events available to move through the pipe or just a few.
	 * 
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */
	time?: moment.DurationInputArg1;

	/**
	 * The max number of bytes to buffer before sending data to the next step in the pipeline.
	 * 
	 * The SDK will push events to the next step in the pipeline as soon as one of the 
	 * `time`, `size` or `records` conditions are met.  It is common to set more than one to ensure
	 * the pipeline moves smoothly whether there are many events available to move through the pipe or just a few.
	 */
	size?: number;

	/**
	 * The max number of records, events, to buffer before sending data to the next step in the pipeline.
	 * 
	 * The SDK will push events to the next step in the pipeline as soon as one of the 
	 * `time`, `size` or `records` conditions are met.  It is common to set more than one to ensure
	 * the pipeline moves smoothly whether there are many events available to move through the pipe or just a few.
	 */
	records?: number;

	/** A display name to use when logging to the console. */
	label?: string;

	/**
	 * Is this buffer acting as a transform stream or a writeable stream (true), meaning if true
	 * it's the sink.
	 * 
	 * @todo unclear Why would you care?  When the next thing after the buffer step is the last step?
	 */
	writeStream?: boolean;

	/** @internal Don't use. */
	commands?: {
		ignoreCommands: string[];
	}
}

/**
 * These options allow a developer to tell the SDK how often it should automatically checkpoint.  To checkpoint 
 * is to make a call back to the RStreams bus instance and tell it that a given bot has successfully read up to
 * the event ID included in the API call.  This ensures that the next time a bot needs to run, the last known
 * checkpoint position is remembered by the bus and the SDK can begin reading from that point in the queue
 * forward in time.
 * 
 * It is used by adding an instance of this as a step in the pipeline itself to determine when to checkpoint.
 * 
 * The SDK will checkpoint as soon as either the `records` or `time` constraint is met.
 * 
 * @todo example
 * @todo question can this go anywhere in the pipeline?  what happens if there's more than one of these?
 */
export interface ToCheckpointOptions {
	/** 
	 * Checkpoint after this number of records (events).
	 * @default 1000 records (events)
	 */
	records: number;

	/**
	 * Checkpoint after this amount of time expires.
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * @default 10s
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */ 
	time: moment.DurationInputArg1;

	/**
	 * When the SDK writes an updated checkpoint event ID back to the RStreams bus, it checks if someone has changed
	 * the checpoint out from underneath the bot.  In practice, this would only happen in one of the following two
	 * scenarios.  1) a developer is running independent sets of code as though it were the same bot erroneously or
	 * 2) a type of fanout is happening where the multiple copies of the same code is running as the same bot.
	 * In scenario 1, this flag will be false and the developer will get an error back.  In scenario 2, this 
	 * flag will intentionally be set to true by whomever is writing the fanout code because it's OK that
	 * someone else changed the checkpoint since the last time it was read by some code.  
	 * 
	 * This is only used in advanced scenarios.
	 * 
	 * @default false
	 */
	force: boolean;
}

/**
 * These options for an [[`RStreamsSdk.enrich`]] pipeline step.
 * This reads events from one queue and writes them to another queue.  Put another way,
 * an enrich pipeline operations reads events from an `inQueue` and then writes them to an `outQueue`,
 * allowing for side effects or transformation in the process.
 * 
 * @typeParam T The type of the event read from the source `inQueue`
 * @typeParam U The type of the event that will be written to the destination `outQueue`
 * 
 * @see [[`RStreamsSdk.enrich`]]
 * @see [[`RStreamsSdk.enrichEvents`]]
 * @todo review there was a callback param, I removed it since I think it was a cut/paste error.  Here's what it said: callback A function called when all events have been processed. (payload, metadata, done) => { }
 */
export interface EnrichOptions<T, U> {
	/** 
	 * The name of the bot that this code is acting as.  The SDK will use it to query to the bot Dynamo DB 
	 * table to pull checkpoints and to checkpoint for you. 
	 */
	id: string;

	/** The source queue from which events will be read */
	inQueue: string;

	/** The destination queue into which events will be written */
	outQueue: string;

	/**
	 * The event ID of the starting position to read from with in the queue.  It is common to not provide
	 * this because each queue is stateful in that it remembers the last read position of a bot.  Then,
	 * as bots read they make a call back to the RStreams Bus to update the read position.
	 * 
	 * Usually, the SDK just handles this for you.  So, if the start isn't provided, the SDK will just
	 * use the bot's last read position as the starting point.  So, as bots are invoked, read some events
	 * and do some processing, they automatically update back how far they've read to and then the bot shuts
	 * down after a period of time.  When the bot starts back up to read again, it knows where it last read
	 * from and just continues.
	 * 
	 * @see [Fundamentals: Event ID](rstreams-site-url/rstreams-guides/core-concepts/fundamentals/#event-id)
	 * @todo review Copied from the start property of the ReadOptions object but there's already config on here so not sure if I'm right about what this is.
	 */
	start?: string;

	/**
	 * This governs micro-batching events that have been received from the source `inQueue` before they
	 * are sent to your `transform` function, allowing that function to receive events in batches instead
	 * of one at a time.  This can be useful when your transform function will reach out and hit an external
	 * resource such as a database.  Hitting a database for every single event that flows through a pipe can
	 * be very detrimental to performance.  So, it's common to micro-batch say 100 or 1000 or so and then
	 * construct a single query to a database to read/write all data as a single DB operation.
	 * 
	 * If this is a number, it's just the number of events to micro-batch up.
	 * @todo review is this doc right?
	 */
	batch?: BatchOptions | number;

	/** Fine-grained control of reading from the source `inQueue` */
	config?: ReadOptions;

	/**
	 * The SDK will invoke this function after reading events from the `inQueue` and will take
	 * the result of this function to send to the destination `outQueue`.
	 * 
	 * @todo example
	 * @todo review
	 */
	transform: ProcessFunction<T, U>;//(payload: any, event: any, callback: ProcessFunction) => any;
}

/**
 * These options for an [[`RStreamsSdk.offload`]] pipeline step.
 * This reads events from a queue and allows for the processing of the data.  Note this inherits all the useful
 * options from [[`ReadOptions`]] which control reading from `inQueue`.
 * 
 * @typeParam T The type of the event read from the source `inQueue`
 * 
 * @see [[`RStreamsSdk.offload`]]
 * @see [[`RStreamsSdk.offloadEvents`]]
 */
export interface OffloadOptions<T> extends ReadOptions {
	/** 
	 * The name of the bot that this code is acting as.  The SDK will use it to query to the bot Dynamo DB 
	 * table to pull checkpoints and to checkpoint for you. 
	 */
	id: string;

	/** The source queue from which events will be read */
	inQueue: string;

	/**
	 * This governs micro-batching events that have been received from the source `inQueue` before they
	 * are sent to your `transform` function, allowing that function to receive events in batches instead
	 * of one at a time.  This can be useful when your transform function will reach out and hit an external
	 * resource such as a database.  Hitting a database for every single event that flows through a pipe can
	 * be very detrimental to performance.  So, it's common to micro-batch say 100 or 1000 or so and then
	 * construct a single query to a database to read/write all data as a single DB operation.
	 * 
	 * If this is a number, it's just the number of events to micro-batch up.
	 * @todo review is this doc right?
	 */
	batch?: BatchOptions | Number;

	/**
	 * The SDK will invoke this function after reading events from the `inQueue` where you can do your processing.
	 * 
	 * @todo example
	 * @todo review
	 * @todo question Why is the second argument a boolean?  What does it mean?
	 */
	transform: ProcessFunction<T, boolean>;
}

/**
 * Used to manually checkpoint in a pipeline step. It's only rarely used in more advanced cases where 
 * one waits until the end of a pipeline to checkpoint manually.
 * 
 * Let's assume that we are reading from an upstream queue that we want to checkpoint to and keep track
 * of where we've read to.  Let's assume that we are aggregating events from the upstream queue and turing 
 * say 10 events from the upstream queue into just 1 event that we write to the downstream queue.  In this
 * case, we would probably wait until we've done the aggregation.  When we checkpoint, we would set
 * the `units` to 10, we'd set the `started_timestamp`and `ended_timestamp` to the first/last event timestamps
 * of the 10 respectively and we'd set the `start_eid to the first event event IDs 
 * respectively.
 * 
 * @see [[`StreamUtil.stats`]] A function that can be called to set the checkpoint.
 * @see [[`StatsStream`]] Creates a pipeline step that you can use to get/set checkpoints manually
 * @todo question What function takes this checkpoint data that then sets the checkpoint in the bus?
 * @todo example
 * @todo review Not sure this doc is right.
 */
export interface CheckpointData {
	/** The exact event ID to checkpoint */
	eid: string;

	/** Read the comment on this interface to understand what this is */
	units?: number;

	/**
	 * The timestamp of the very first event that made it to a queue of the bus that then flowed down the bus
	 * to get to here.  This allows the bus to compute source lag times.  Each derivative event that flows down
	 * the bus should track this and pass it along as events flow/are derived and flow down the bus.
	 * @todo question is this time since the epoch? Are all that read _timestamp?
	 */
	source_timestamp?: number,

	/** Read the comment on this interface to understand what this is */
	started_timestamp?: number,

	/** Read the comment on this interface to understand what this is */
	ended_timestamp?: number;

	/** Read the comment on this interface to understand what this is */
	start_eid?: string;
}

/**
 * A pipeline step that is used to manually get/set the checkpoint.  Often, this pipeline step is used to get
 * and store checkpoints and then at the very end of the pipeline, it will use the saved off data to
 * manaully checkpoint using [[`StreamUtil.stats`]].
 * 
 * Note, this is only rarely used in special cases.
 * 
 * @noInheritDoc
 * @todo example for the functions below also
 */
export interface StatsStream extends stream.Transform {
	/** Exposes a function to allow the developer to set the checkpoint. */
	checkpoint: {
		(callback: (err: CheckpointData) => void): void;
	};

	/** Exposes a function to allow the developer to manually get the checkpoint. */
	get: {
		(): CheckpointData;
	};
}

/**
 * This namespace encompasses the majority of the functionality of the SDK.
 * It might be helpful to start at [[RStreamsSdk]] which exposes functionality from this namespace
 * that is most commonly used.
 * 
 * @todo question We have StreamUtil and Streams which is streams.d.ts.  Why?
 */
export declare namespace StreamUtil {

	/**
	 * Helper function to turn a timestamp into an RStreams event ID.
	 * 
	 * @param timestamp The timestamp you want to turn into an RStreams event ID which can be anything used to construct a Moment object.
	 * @param granularity Specify the granularity of the event ID, maybe just year/month or year/month/hour, etc.
	 * @returns The generated event ID.
	 * @todo question I need examples of granularity values to know what to put here
	 * @todo docbug docs not being inherited, have been copied
	 */
	const eventIdFromTimestamp: typeof Streams.eventIdFromTimestamp;

	/**
	 * Helper function to turn a an RStreams event ID into a timestamp.
	 * @param eid The event ID to turn into an epoch timestamp.
	 * @returns The timestamp as a time since the epoch.
	 * @todo docbug docs not being inherited, have been copied
	 */
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
