import splitLib from "split";
import stream from 'stream';
import moment from "moment";
import { LeoDynamodb } from "./dynamodb";
import { Checkpoint, LeoCron } from "./cron";
import Streams, { BatchOptions, ProcessFunction, } from "./streams";
export { BatchOptions, FromCsvOptions, ProcessFunction, ToCsvOptions } from "./streams";
import { Event, ReadEvent, ReadableStream, WritableStream, TransformStream, CorrelationId, ProcessFunctionAsync, ProcessCallback, ProcessFunctionContext, ProcessFunctionAsyncReturn, ProcessFunctionAsyncReturnOptions, BaseEvent, ReadableQueueStream } from "./types";
import * as es from "event-stream";
import zlib from "zlib";
import { Options as BackoffOptions } from "backoff";

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
 */
export interface BaseWriteOptions {
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
	 * files should be avoided as it could cause read latency.  For example, if requesting 1000 events
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


	/**
	 * The hash value used to explicitly determine the shard to send events
	 * 
	 * @default 0
	 */
	partitionHashKey?: string;

	/**
	 * Flag to use the queue name to determine the shard to send events
	 * @default false
	 */
	useQueuePartition?: boolean,

	/**
	 * Options for kinesis/firehose backoff options
	 * @default { randomisationFactor: 0, initialDelay: 10, maxDelay:1000 }
	 */
	backoff?: BackoffOptions
}

/**
 * Options when writing data to an instance of the RStreams bus that include the ability to 
 * force checkpointing.  The options in this
 * interface provide a lot of control and performance optimization options and developers
 * should familiarize themselves with them. They are used in a write pipeline step 
 * to configure how to write.
 */
export interface WriteOptions extends BaseWriteOptions {
	/** 
	 * If true, the checkpoint will be applied even if someone else already checkpointed on the same bot/queue
	 * since the last time this code checkpointed.  This is only used in advanced fanout cases.
	 */
	force?: boolean;

	/**
	 * Enable/Disable if the stream will use auto checkpointing
	 * @default true
	 */
	autoCheckpoint?: boolean;
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
	records?: number;

	/**
	 * Checkpoint after this amount of time expires.
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * @default 10s
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */
	time?: moment.DurationInputArg1;

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
	force?: boolean;
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
export interface EnrichOptions<T, U> extends WriteOptions {
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

	/** Fine-grained control of reading from the source `inQueue` */
	config?: ReadOptions;

	/**
	 * The SDK will invoke this function after reading events from the `inQueue` and will take
	 * the result of this function to send to the destination `outQueue`.
	 * 
	 * @todo example
	 * @todo review
	 */
	transform(this: ProcessFunctionContext<U>, payload: T, wrapper: ReadEvent<T>, callback?: ProcessCallback<U>): Promise<ProcessFunctionAsyncReturn<U>> | void;
}

/**
 * These options for an [[`RStreamsSdk.enrich`]] pipeline step.  This reads events from one queue and writes 
 * them to another queue.  Put another way, an enrich pipeline operations reads events from an `inQueue` and 
 * then writes them to an `outQueue`, allowing for side effects or transformation in the process.
 * 
 * This inherits from [[`EnrichOptions`]] and adds the ability to batch the data read from the source inQueue 
 * before it is sent to the `transform` function which means your transform function will recieve an array of 
 * type T which is the batched events instead of just a single event of type T.
 * 
 * @typeParam T The type of the event read from the source `inQueue`
 * @typeParam U The type of the event that will be written to the destination `outQueue`
 * 
 * @see [[`RStreamsSdk.enrich`]]
 * @see [[`RStreamsSdk.enrichEvents`]]
 * @todo review there was a callback param, I removed it since I think it was a cut/paste error.  Here's what it said: callback A function called when all events have been processed. (payload, metadata, done) => { }
 */
export interface EnrichBatchOptions<T, U> extends EnrichOptions<ReadEvent<T>[], U> {
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
	batch: BatchOptions | number;
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
	 * The SDK will invoke this function after reading events from the `inQueue` where you can do your processing.
	 * 
	 * @todo example
	 * @todo review
	 * @todo question Why is the second argument a boolean?  What does it mean?
	 */
	transform(this: ProcessFunctionContext<never>, payload: T, wrapper: ReadEvent<T>, callback?: ProcessCallback<never>): Promise<ProcessFunctionAsyncReturn<never>> | void;

	force?: boolean;
}

/**
 * These options for an [[`RStreamsSdk.offload`]] pipeline step.
 * This reads events from a queue and allows for the processing of the data.  Note this inherits all the useful
 * options from [[`ReadOptions`]] which control reading from `inQueue`.
 * 
 * This inherits from [[`OffloadOptions`]] and adds the ability to batch the data read from the source inQueue 
 * before it is sent to the `transform` function which means your transform function will recieve an array of 
 * type T which is the batched events instead of just a single event of type T.
 * 
 * @typeParam T The type of the event read from the source `inQueue`
 * 
 * @see [[`RStreamsSdk.offload`]]
 * @see [[`RStreamsSdk.offloadEvents`]]
 */
export interface OffloadBatchOptions<T> extends OffloadOptions<ReadEvent<T>[]> {
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
	batch: BatchOptions | Number;
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
		(callback: Callback): void;
		(params: Checkpoint, callback: Callback): void;
	};

	/** Exposes a function to allow the developer to manually get the checkpoint. */
	get: {
		(): CheckpointData;
	};
}

/**
 * @todo document: options for createCorrelation function
 */
export interface CreateCorrelationOptions {
	partial: boolean;
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
	 * @param timestamp The timestamp you want to turn into an RStreams event ID which can be anything used to construct a Moment object
	 * @param granularity Specify the granularity of the event ID, maybe just year/month or year/month/hour, etc.
	 * @returns The generated event ID
	 * @todo question I need examples of granularity values to know what to put here
	 * @todo docbug docs not being inherited, have been copied
	 */
	const eventIdFromTimestamp: typeof Streams.eventIdFromTimestamp;

	/**
	 * Helper function to turn a an RStreams event ID into a timestamp.
	 * 
	 * @param eid The event ID to turn into an epoch timestamp
	 * @returns The timestamp as a time since the epoch
	 * @todo docbug docs not being inherited, have been copied
	 */
	const eventIdToTimestamp: typeof Streams.eventIdToTimestamp;

	/** For convenience, a re-export of the popular [event-stream library](https://www.npmjs.com/package/event-stream). */
	const eventstream: typeof es;

	/** A library allowing one to manually create, update, checkpoint or retrieve information on a bot. */
	const cron: LeoCron;

	/** Helpful methods for interacting with RStreams' DynamoDB tables. */
	const dynamodb: LeoDynamodb;

	/**
	 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
	   * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
	 *  
	 * The type definitions make this look daunting.  It's not.  It's merely a set of pipeline steps in a series where
	 * the first step in the pipeline is the source that produces content, perhaps by reading it from a queue of the bus,
	 * and then the data is sent to the next step and so on until the final step, the sink, gets the data.
	 * 
	 * The reason the types look so complicated is because there must be a specific type for the exact sequence of
	 * possible pipeline steps that one might chain together.  The different parameterized types, T1/T2/etc., represent
	 * the data type of the data events that are produced and are modified and move down through the pipe.
	 * 
	 * Note that developers don't really need to understand hardly any of this.  Developers need only ask what type
	 * of pipe they want to create.  Do I want a pipe that just reads from a queue and doesn't send it anywhere else?
	 * Well, that's an [[`RStreamsSdk.offload`]] pipe.  Do you want to read from one queue, do some processing and/or
	 * transformation and/or filtering and then write the result to another queue?  Well that's an [[`RStreamsSdk.enrich`]] or
	 * [[`RStreamsSdk.enrichEvents`]].  With these, you don't have to construct a pipe yourself as these helper methods
	 * craft one purpose-built for you.
	 * 
	 * If you need to do something more involved then this method is for you.  Even then, the SDK dramatically simplifies things
	 * so you don't have to craft your own pipeline steps.  Instead, you simply call an SDK function to create an instance
	 * of a pipeline step that does what you want it to.
	 * 
	 * @todo example
	 * @todo question what are all the functions that create pipeline steps
	 * @todo incomplete need to do a lot more here to describe all the pipeline steps and how errors work and so forth.  Probably should link out to the rstreams.org site.
	 */
	const pipe: typeof Streams.pipe;

	/**
	 * An async/await friendly version of [[`pipe`]].  Reference the docs there.
	 * 
	 * @see [[`pipe`]]
	 */
	const pipeAsync: typeof Streams.pipeAsync;

	/**
	 * An export of the super popular [split2](https://www.npmjs.com/package/split2) library.
	 * 
	 * It's used to turn events in the pipeline into a set of stringified events where each event is separated by a 
	 * character, typically newline.  We use it to make [JSON lines](https://jsonlines.org/) files with a single pipeline step that is then
	 * followed by a step that writes it to an S3 file.
	 */
	const split: typeof splitLib;

	/**
	 * A pipeline step that will split and parse [JSON lines](https://jsonlines.org/), turning them into events.
	 * 
	 * @typeParam T The type of object produced from parsing the JSON objects.
	 * @param skipErrors If true and there's a parse error, the error and the JSON line that couldn't be parsed is skipped.  Defaults to false.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	function parse<T>(skipErrors?: boolean): TransformStream<any, T>;

	/**
	 * This is a callback-based version of the [[`RStreamsSdk.throughAsync`]] function and should no longer be used.
	 * Callback-based API flavors will be phased out over time.
	 * 
	 * This creates a callback based pipeline step that will take data in, possibly transform the data or do computation, and then
	 * sends the result on to the next step in the pipeline.
	 * 
	 * @typeParam T The type of the data sent in to be passed through this step.
	 * @typeParam U The type of data to be sent on to the next step in the pipeline.
	 * @param transform A function that does the work of taking the data in, doing something with it and then calling the done function when done.
	 *   The first arg is stripped off by Javascript since it recognizes that the this arg is just to set the this context 
	 *   so that the `this` keyword will work inside the function and itself be the instance of the transform stream which can be useful.
	 *   For example, say you want to push to an event in here to a queue.  You could do that by calling
	 *   `this.push` to push the event to a queue while still sending the queue on the next step in the pipeline afterwards.
	 * 
	 *   So, the first real argument your function will receive is `obj` which is the data event being sent in to be processed/transformed
	 *   and sent on to the next pipeline step.  The second arg is `done`.  You call this when you're done.  Call `done()` if there's no error
	 *   but you want to filter out this event and not pass it on to the next pipeline step.  Call `done(err)` if an error ocurreed where
	 *   `err` is a string or Error object.  Call `done(null, U)` when no error and you want to pass on an event to the next step in the 
	 *   pipeline where `U` is the type of object being sent on.
	 *				  
	* @param flush A function to be called when the entire pipeline has been flushed to allow for cleanup, perhaps closing a DB connection.
	* @returns The pipeline step that is ready to be used in a pipeline
	* @deprecated Please use [[`RStreamsSdk.throughAsync`]]
	* 
	* @todo example When you'd want to use this in the transform function.
	* @todo review
	* @todo example with flush
	*/
	const through: typeof Streams.through;

	/**
	 * This creates an async/await-friendly pipeline step that will take data in, possibly transform the data or do computation, and then
	 * sends the result on to the next step in the pipeline.
	 * 
	 * @typeParam T The type of the data sent in to be passed through this step.
	 * @typeParam U The type of data to be sent on to the next step in the pipeline.
	 * @param transform A function that does the work of taking the data in, doing something with it and then rejecting or resolving
	 *   the promise with the result object type U.  If you resolve with no result data, the event is skipped and not sent to the next pipeline step.
	 *   The first arg is stripped off by Javascript since it recognizes that the this arg is just to set the this context 
	 *   so that the `this` keyword will work inside the function and itself be the instance of the transform stream which can be useful.
	 *   For example, say you want to push to an event in here to a queue.  You could do that by calling
	 *   `this.push` to push the event to a queue while still sending the queue on the next step in the pipeline afterwards.
	 * 
	 *   So, the first real argument your function will receive is `obj` which is the data event being sent in to be processed/transformed
	 *   and sent on to the next pipeline step.
	 *				  
	* @param flush A function to be called when the entire pipeline has been flushed to allow for cleanup, perhaps closing a DB connection.
	* @see [[`through`]]
	* @returns The pipeline step that is ready to be used in a pipeline
	* 
	* @todo example When you'd want to use this in the transform function.
	* @todo review
	* @todo example with flush
	*/
	const throughAsync: typeof Streams.throughAsync;

	/**
	 * This is a sink, a step designed to be the last step in the pipe.
	 * 
	 * @internal
	 * @todo unclear
	 * @todo incomplete
	 * @todo example
	 */
	const write: typeof Streams.writeWrapped;

	/**
	 * Creates a pipeline step that will log events as they pass through which can be helpful for debugging in between streaming operations.
	 * 
	 * @typeParam T The type of the data that flows through the step to be logged
	 * @param prefix If provided, this prefix is included with each log
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * @todo incomplete what does it log and how often
	 */
	const log: typeof Streams.log;

	/**
	 * Creates a pipeline step that is used to manually get/set the checkpoint.  Often, this pipeline step is used to get
	 * and store checkpoints and then at the very end of the pipeline, it will use the saved off data to checkpoint
	 * manaully checkpoint.
	 * @param botId The bot that is doing the reading.
	 * @param queue The queue we need to checkpoint where we've read to on behalf of the bot `botId`
	 * @param opts How often to checkpoint.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo unclear not sure I have what this really does
	 * @todo example
	 */
	function stats(botId: string, queue: string, opts?: {
		/**
		 * Checkpoint after this number of records or as soon as the `time` condition is met if used and happens sooner.
		 */
		records: number;

		/**
		 * Checkpoint after this amount of time or as soon as the `records` condition is met if used and happens sooner.
		 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
		 * can take: Duration | number | string | FromTo | DurationInputObject.
		 */
		time: moment.DurationInputArg1;
	}): StatsStream;

	/**
	 * This is only to be used internally by the SDK.  It used to be necessary externally and so remains
	 * for backward comaptibiliy.
	 * 
	 * Creates a pipeline step that will checkpoint and then pass the events on to the next step in the pipeline.
	 * 
	 * @param config When to checkpoint.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @internal
	 * @todo review
	 * @todo example
	 */
	function toCheckpoint(config?: ToCheckpointOptions): WritableStream<unknown>;

	/**
	 * Create a pipeline step that reads from the RStreams bus instance queue `inQueue` doing so
	 * as bot `botId`.
	 * 
	 * @typeParam T The type of data that will be read from the queue.
	 * @param botId The bot to read as
	 * @param inQueue The queue to read from
	 * @param config The options on how to read from this queue
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo inconsistent want to alias this and deprecate this name, how should we do this.  what else is this similar to? 
	 * @todo question is the meant to be used in an ls.pipe? or all by itself?
	 * @todo example
	 */
	function fromLeo<T>(botId: string, inQueue: string, config?: ReadOptions): ReadableQueueStream<T>;

	/**
	 * Create a pipeline step that takes the events from the previous pipeline step and then writes them
	 * to an RStreams bus queue.
	 * 
	 * @param botId The bot to act as when writing.
	 * @param config Options for writing
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo inconsistent want to alias this and deprecate this name, how should we do this.  what else is this similar to? 
	 * @todo question What is the queue we are writing to?
	 * @todo question since this returns a transform stream, seems like it is meant to pass an event to a downstream step but that doesn't make sense?
	 */
	function toLeo<T>(botId: string, config?: BaseWriteOptions): TransformStream<Event<T>, unknown>;

	/**
	 * Creates a pipeline step that will checkpoint and then pass the events on to the next step in the pipeline.
	 * 
	 * @param config Options for when to checkpoint.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @internal
	 * @todo question what's the usage difference in this versus toCheckpoint where this is a Writable and the other is a TransformStream
	 * @todo unclear Probably have this description wrong.
	 */
	function checkpoint(config?: {
		/**
		 * Checkpoint after this number of records or as soon as the `time` condition is met if used and happens sooner.
		 */
		records: number;

		/**
		 * Checkpoint after this amount of time or as soon as the `records` condition is met if used and happens sooner.
		 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
		 * can take: Duration | number | string | FromTo | DurationInputObject.
		 */
		time: moment.DurationInputArg1;
	}): stream.Writable;


	/**
	 * This is a callback-based version of the [[`RStreamsSdk.enrichEvents`]] function and should no longer be used.
	 * Callback-based API flavors will be phased out over time.
	 * 
	 * It reads events from one queue and writes them to another queue.  Put another way,
	 * an enrich operation reads events from a source `inQueue` and then writes them to a destination `outQueue`,
	 * allowing for side effects or transformation in the process.
	 * 
	 * The [[`EnrichOptions.transform`]] function
	 * is called when events are retrieved from the source queue so you can transform them and send them to the 
	 * destination queue by calling the callback in the transform function.  The callback here as the second argument
	 * of this function is meant to be called when all enriching is done on all events (right before it closes down the stream),
	 * allowing you to do clean up like closing a DB connection or something.
	 * 
	 * @typeParam T The type of the data event retrieved from the source queue
	 * @typeParam U The type of the data event that is sent to the destination queue
	 * @param opts The details of how to enrich and the function that does the work to enrich, either the batched or not batched version.
	 *			   The batched version will batch up requests to your transform function and pass it an array instead of a single object.
	 * @param callback A function called when all events have been processed
	 * @deprecated Please use [[`RStreamsSdk.enrichEvents`]]
	 * @todo question why does enrich exist here and not elsewhere
	 * @todo unclear don't understand the callback here
	 * @todo example
	 * @todo review
	 */
	function enrich<T, U>(opts: EnrichOptions<T, U>, callback: Callback): void;
	function enrich<T, U>(opts: EnrichBatchOptions<T, U>, callback: Callback): void;

	/**
	 * This is a callback-based version of the [[`RStreamsSdk.offloadEvents`]] function and should no longer be used.
	 * Callback-based API flavors will be phased out over time.
	 * 
	 * It reads events from a queue to do general processing (such as write to an external DB).  It's called
	 * offload because it is commonly used to process events and offload them to external resources
	 * such as ElasticSearch or other databases that are off of the RStreams Bus.
	 * 
	 * It reads from the queue specified in `opts` and then calls the `opts.transform` function passing in the
	 * events retrieved so they may be processed.
	 * 
	 * @deprecated Please use [[`RStreamsSdk.offloadEvents`]]
	 * @typeParam T The type of the data read from the RStreams bus queue
	 * @param opts What queue to read from, the transform function and other options.
		 *						 The batched version will batch up requests to your transform function and pass it an array instead of a single object.
	 * @callback callback A function called when all events have been processed
	 */
	function offload<T>(config: OffloadOptions<T>, callback: Callback): void;
	function offload<T>(config: OffloadBatchOptions<T>, callback: Callback): void;

	/**
	 * This creates a pipeline step that acts as the last step of the pipeline, the sink, writing events sent to the 
	 * pipeline step to the queue specified.
	 * 
	 * @typeParam T The type of the data received by the pipeline step
	 * @param botId For events that don't specify the bot to act as, this default is used.
	 *              It is the bot to act as when writing, events will be marked as written by this bot.
	 *              If not provided, each event must include the id of the bot to write the event as.
	 * @param outQueue For events that don't specify the queue to write to, this default is used.
	 *                 It is the queue into which events will be written.  If not provided, each event must
	 *                 include the queue to write the event to.
	 * 
	 * @param config An object that contains config values that control the flow of events to outQueue
	 * @todo example
	 */
	function load<T>(botId?: string, outQueue?: string, config?: WriteOptions): WritableStream<BaseEvent<T> | T>;

	/**
	 * Creates a pipeline step that can act as a noop sink.
	 * 
	 * Sometimes you don't care to push data anywhere when you have a pipeline, but you need the fine-grained control
	 * of making your own pipeline.  When that's the case, use this to create a final pipeline step, a sink, to end your pipeline.
	 * 
	 * Pipelines must have a sink or data won't flow through the pipeline since Node streams pull data starting with the sink
	 * who asks the previous pipeline step for data and then that previous step asks the one before it for data and so on.
	 * So, no sink means no data flows.  This gives you a noop sink.
	 * 
	 * @typeParam T The type of the data sent into this final pipeline step
	 * @param shouldLog If a string, logs events that come in, prefixing the log statement with the stream.
	 *   If this is true, logs the event.  Otherwise, does nothing.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	const devnull: typeof Streams.devnull;

	/**
	 * This creates a pipeline step that turns a Javascript object into a [JSON line](https://jsonlines.org/)
	 * (newline at the end of the stringified JS object). This is used to make it easy to create JSON lines files.
	 * 
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	const stringify: typeof Streams.stringify;

	/**
	 * Creates a pipeline step that compresses the data that flows through it.
	 * 
	 * This is an export of the `zlib` libraries `createGzip` function which is used to compress
	 * content as it moves through a pipeline.
	 * 
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	const gzip: typeof zlib.createGzip;

	/**
	 * Creates a pipeline step that uncompresses the data that flows through it.
	 * 
	 * This is an export of the `zlib` libraries `createGunzip` function which is used to uncompress
	 * content as it moves through a pipeline.
	 * 
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	const gunzip: typeof zlib.createGunzip;

	/**
	 * This creates a pipeline step that takes an event, logs it and then passes the event on to the next pipeline step.
	 * The log will include the event ID of the event, if it's present.  This is helpful to get visibility into the pipeline.
	 * 
	 * @typeParam T The type of the event that flows in, gets logged and then flows unchanged to the next pipeline step.
	 * @param label If present, log statements are prefixed with this string.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @param records If present, only log every Nth event that flows through where N is `records`.
	 * @todo review
	 */
	const counter: typeof Streams.counter;

	/**
* This creates a pipeline step that allows events to move through the step.  This is only used in special
* cases and most will not have occasion to use this.
* 
* I need to preread a database to start generating data.  But I need to give you something you can pipe to.  So, I give you
* a passthrough.  It's used if you are the source of you want to put a sink in the middle of a pipe.  So, writing to an S3 file
* is a sink step but we do it in the middle of the stream because we generate many s3 files.  We pipe it to S3 and then we pipe the
* results of that into a pass through.
* 
* @param opts The options for transforming.
* @returns The pipeline step that is ready to be used in a pipeline
* 
* @todo unclear
* @todo review
*/
	function passThrough(opts?: stream.TransformOptions): stream.Transform;

	/**
* This is very advanced functionality that likely won't be used very often. It takes a list of pipeline steps
* and turns them into a single Transform stream step.  If you have to ask why you'd want to do this, you probably
* don't need to know to do this.
* 
* @todo example
* @todo question what are all the functions that create pipeline steps
* @todo incomplete need to do a lot more here to describe all the pipeline steps and how errors work and so forth.  Probably should link out to the rstreams.org site.
*/
	const pipeline: typeof Streams.pipeline;

	/**
	 * This creates a pipeline step meant to be the last step in a pipeline, the sink, that writes events that flow into it
	 * into S3.  You should micro-batch events before getting to this step to control how many events to write to the file.
	 * 
	 * @param Bucket The name of the AWS S3 bucket to write the file to
	 * @param File The name of the file to write.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo inconsistent Bucket I get that AWS caps these but nowhere else in the SDK do we.
	 * @todo inconsistent File I get that AWS caps these but nowhere else in the SDK do we.
	 */
	function toS3(Bucket: string, File: string): stream.Writable;

	/**
	 * This creates a pipeline step that can act as the first step in a pipeline, the source, which reads data
	 * from an S3 file.
	 * 
	 * @param file What to read from.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	function fromS3(file: {
		/** The name of the S3 bucket to read from */
		bucket: string,

		/** The name of the file in the bucket to read from */
		key: string;

		/**
		 * Read from a specific range in the file.  This is a string that must look like this:
		 * `bytes=<startingByteoffset>-<endingByteOffset>` where `<startingByteoffset>` is the start position to read from
		 * and `<endingByteOffset>` is the ending position to read from, exclusive.
		 * 
		 * @todo question Is this an exclusive read meaning it reads up to but doesn't actually read the endingByteOffset position?
		 */
		range?: string;
	}): stream.Readable;

	/**
	 * A super convenient function to write data to Dynamo DB table as the final step in a pipeline, the sink, as events
	 * flow into the pipeline step.
	 * 
	 * @param table The name of the Dynamo DB table to write to
	 * @param opts The options for writing.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo example
	 * @todo incomplete need to doc up the options in the opts object
	 */
	function toDynamoDB(table: string, opts: {
		hash: string;
		range: string;
		records?: number;
		size?: number;
		time?: moment.DurationInputArg1;
	}): stream.Writable;

	/**
	 * This creates a pipeline step to tell the SDK to micro-batch events received in one pipeline step
	 * before sending them to the next pipeline step.  It's useful to control how many events arrive all
	 * at once, roughly, to the next pipeline step.  It can be helpful for a pipeline step to receive
	 * a micro-batch of events, say 100 at a time, instead of 1 at a time to leverage economies of scale
	 * when writing to a database, e.g. doing one query to the database to get 100 records back all at once
	 * instead of having to do a query to the database for each event as it comes in.
	 * 
	 * @typeParam T The type of the data being batched from the previous pipeline step before sending to the next pipeline step
	 * @param opts If a number, then this is how many events to batch up before sending along.  If [[`BatchOptions`]] then
	 *   this is fine-grained control to ensure events keep flowing smoothly whether there are a few or many at a given moment.
	 * @returns The pipeline step that is ready to be used in a pipeline
	 */
	const batch: typeof Streams.batch;

	/**
	 * This creates a pipeline step that will create a CSV file from the events that flow into this step.
	 * Underneath the covers it uses the popular [fast-csv](https://c2fo.github.io/fast-csv) node library.
	 * 
	 * @param fieldList List of fields to transform | true builds the header list dynmaically
	 * @param opts - fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 * 
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * @todo unclear
	 */
	const toCSV: typeof Streams.toCSV;

	/**
	 * This creates a pipeline step that will parse events from a CSV file and send them to the next step.
	 * Underneath the covers it uses the popular [fast-csv](https://c2fo.github.io/fast-csv) node library.
	 * 
	 * @param fieldList List of fields to transform | true builds the header list dynmaically
	 * @param opts fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * 
	 * @todo unclear
	 */
	const fromCSV: typeof Streams.fromCSV;


	/**
	 * This is for internal SDK use only and is no longer needed externally but remains here for
	 * backward compatibility.
	 * 
	 * This creates a pipeline step that takes events in of type T, allows your code to process it and then
	 * you send an event of type U to the the next pipeline step.
	 * 
	 * @typeParam T The type of the data sent into the function to be processed
	 * @typeParam U The type of the data you send on after being processed
	 * 
	 * @param id The name of the bot act as
	 * @param func The function to process data, getting data of type T and returning data of type U
	 * @param outQueue The queue to send the resulting data to
	 * @returns The pipeline step that is ready to be used in a pipeline
	 * @internal
	 * @todo question Couldn't find any references to this.
	 * @todo question don't we already have other ways to do this?  do we need this?
	 * @todo unclear This is a transform stream which means it can't be the sink and yet it takes an outQueue as though it's sending to another queue.  Don't get it.
	 */
	function process<T, U>(id: string, func: ProcessFunction<T, U>, outQueue: string, onFlush?: any, opts?: any): TransformStream<T, U>
	function process<T, U>(id: string, func: ProcessFunctionAsync<T, U>, outQueue: string, onFlush?: any, opts?: any): TransformStream<T, U>

	/**
	   * todo document: what this functon does.  Creates Correlation form read events
	   * @param event 
	   * @param opts 
	   */
	function createCorrelation<T>(event: ReadEvent<T>, opts?: CreateCorrelationOptions): CorrelationId;
	function createCorrelation<T>(startEvent: ReadEvent<T>, endEvent: ReadEvent<T>, units: number, opts?: CreateCorrelationOptions): CorrelationId;
	function createCorrelation<T>(events: ReadEvent<T>[], opts?: CreateCorrelationOptions): CorrelationId;

}
