export * from "./lib";
export * from "./streams";
import { Context } from "aws-lambda";
import { Callback, RStreamsSdk } from "../index";
/// <reference types="node" />
import stream from 'stream';
// export interface LeoStreamOptions extends stream.TransformOptions {
//	 ignoreCommands?: any;
//	 cmd?: any;
//	 cmdFlush?: any;
//	 hasCommands?: any;
// }

export interface ReadableQueueStream<T> extends ReadableStream<ReadEvent<T>> {
	get(): Checkpoint;
	checkpoint(params: Checkpoint, done: Callback): void;
	checkpoint(done: Callback): void;
}


/**
 * A ReadableStream produces events as the source of a pipe.  It is an RStreams-specific wrapper
 * interface that inherits from the Node library's fundament `Readable` stream interface,
 * the most abstract source pipeline step definition in Node.  You will see this type in various type
 * signatures.  For example, the first pipeline step in a [[`StreamUtil.pipe`]] is
 * always a `ReadableStream`, since the pipe needs a source to produce events. Another example: you will find 
 * `ReadableStream` instances that read from files to produce events as the source in a pipe.
 * 
 * @typeParam T The type of data the source will produce and make available for the next pipeline step
 * @todo review
 */
export interface ReadableStream<T> extends stream.Readable {
	/** 
	 * Push produced data downstream toward the next pipeline step.
	 * @param chunk The data to push, in RStreams this will be a JS object
	 * @param encoding The encoding of the data being pushed, not relevant since RStreams uses 
	 *  `object mode` meaning we push JSobjects not raw data
	 */
	push(chunk: T, encoding?: BufferEncoding): boolean;

	/**
	 * Read data from the stream
	 * 
	 * @param size If in object mode then this is the number of objects to read from the stream, otherwise
	 *  it's the number of bytes to read from the stream.
	 */
	read(size?: number): T;
}

/**
 * A `WriteableStream` consume events as the last step of the pipeline, ending the pipe.
 * It is an RStreams-specific wrapper interface that inherits from the Node library's fundament `Writable` 
 * stream interface, the most abstract sink pipeline step definition in Node.  You will see this 
 * type in various type signatures.  For example, the last pipeline step in a [[`StreamUtil.pipe`]] is
 * always a `WriteableStream`, since the pipe needs a sink or nothing will flow in the pipe (sinks
 * pull from previous pipe steps, causing flow in the pipe).
 * 
 * @typeParam T The type of data being pushed into the WriteableStream sink to be consumed
 * @todo review
 */
export interface WritableStream<T> extends stream.Writable {
	/**
	 * Internal write method for stream buffer. Don't use.
	 * 
	 * @typeParam T The data to write to the stream
	 * @param chunk The object to push into the stream
	 * @param encoding Not needed due to object mode
	 * @param callback Will call callback if there's an error
	 */
	_write(chunk: T, encoding: BufferEncoding, callback?: ErrorCallback): void;

	/**
	 * Writes data to the stream.
	 * 
	 * @param chunk The object to push into the stream
	 * @param callback Will call callback if there's an error
	 * @returns true if more events can be written and false if you need to back off sending events
	 * @todo question what's the boolean that is returned
	 */
	write(chunk: T, callback?: (error: Error | null | undefined) => void): boolean;


	/**
	 * Writes data to the stream.
	 * 
	 * @param chunk The object to push into the stream
	 * @param encoding Not needed due to object mode of stream
	 * @param callback Optional for RStreams, will call callback if there's an error.
	 * @returns true if more events can be written and false if you need to back off sending events
	 * @todo question what's the boolean that is returned
	 */
	write(chunk: T, encoding: BufferEncoding, callback?: (error: Error | null | undefined) => void): boolean;

	/**
	 * Call this to end the stream and a callback is called when the stream is flushed, meaning everything 
	 * has finished clearing out of the pipe.
	 * 
	 * @param cb The function to call when the pipe has been flushed
	 * @todo question isn't there a more defined callback type?
	 */
	end(cb?: () => void): this;

	/**
	 * This allows a developer to write one final chunk to the stream and then immediately close the pipe, causing
	 * the pipe to flush with this last event in it, meaning everything has finished traveling through
	 * and out the pipe.
	 * 
	 * @param chunk The object to push into the stream
	 * @param cb The function to call when the pipe has been flushed
	 */
	end(chunk: T, cb?: () => void): this;

	/**
	 * This allows a developer to write one final chunk to the stream and then immediately close the pipe, causing
	 * the pipe to flush with this last event in it, meaning everything has finished traveling through
	 * and out the pipe.
	 * 
	 * @param chunk The object to push into the stream
	 * @param encoding Not needed due to object mode of stream
	 * @param cb The function to call when the pipe has been flushed
	 */
	end(chunk: T, encoding: BufferEncoding, cb?: () => void): this;
}

/**
 * @deprecated Don't use. Will be removed.
 */
export declare type DuplexStream<T, U> = TransformStream<T, U>;

/**
 * A stream that is a readable and writeable.  This is used when you want to have pipe steps in between the source that is 
 * producing events and the sink that is consuming events, maybe to take in an event and transform it and then
 * send on down the pipe to the next step.  Conceptually, a `TransformStream` is like a mini-pipe of its own,
 * where the first step in the pipe is a `Writeable` that can consume events from the previous pipeline step
 * that is then connected to the final step which is a `Readable` which can produce events to flow down the 
 * pipe to the next step.  Thus, events can be consumed in and then flow out.
 * 
 * @typeParam T The type of data that will flow into the `TransformStream` from the previous pipe step
 * @typeParam U The type of data that will flow out of the `TransformStream` and continue on to the next pipe step
 * @todo review
 */
declare type TransformStreamType<T, U> = stream.Duplex & ReadableStream<U> & WritableStream<T>
export interface TransformStream<T, U> extends TransformStreamType<T, U> {
	/**
	 * An internal function.  Don't use it.
	 * 
	 * @param chunk 
	 * @param encoding 
	 * @param callback 
	 */
	_write(chunk: T, encoding: BufferEncoding, callback?: ErrorCallback): void;

	/**
	 * Writes a chunk to the `Writeable` to send data into the `TransformStream` from the previous step.
	 * 
	 * @typeParam T The data to send into this `TransformStream`
	 * @param chunk The object to push into the stream
	 * @param callback Will call callback if there's an error
	 */
	write(chunk: T, callback?: (error: Error | null | undefined) => void): boolean;

	/**
	 * Writes a chunk to the `Writeable` to send data into the `TransformStream` from the previous step.
	 * 
	 * @typeParam T The data to send into this `TransformStream`
	 * @param chunk The object to push into the stream
	 * @param encoding Not needed due to object mode
	 * @param callback Will call callback if there's an error
	 */
	write(chunk: T, encoding: BufferEncoding, callback?: (error: Error | null | undefined) => void): boolean;

	/**
	 * The chunk of data to push out of the `TransformStream` to be made available to the next step in the pipe.
	 * 
	 * @param chunk The data to send on to the next step in the pipe
	 * @param encoding Not needed due to object mode
	 */
	push(chunk: U, encoding?: BufferEncoding): boolean;

	/**
	 * Read data from the stream
	 * 
	 * @param size If in object mode then this is the number of objects to read from the stream, otherwise
	 *  it's the number of bytes to read from the stream.
	 */
	read(size?: number): U;
}

/**
 * A standard callback function supporting operation success with optional data returned and fail with Error.
 * 
 * ```javascript
 * // Operation failed, returns an error from the callback
 * callback(new Error())
 * 
 * // Operation succeeded, return data from this operation
 * callback(null, data)
 * 
 * // Operation succeeded but don't want to forward any data from this operation
 * callback()
 * ```
 * @typeParam T The type of the data to be returned from the operation, if any
 * @typeParam E The type of the Error object if the operation fails
 * @param err If present, the operation failed and this is the error
 * @param data If present, this is the data to return from the operation
 */
export declare type DataCallback<T = any, E = Error> = (err?: E | null, data?: T) => void;

/**
 * A standard callback indicating the operation failed if error is present
 * 
 * @param error If present, an error occurred and this is it
 */
export declare type ErrorCallback = (error: Error | null | undefined) => void;

/**
 * @internal Don't use.
 */
export declare type TransformFunction<T = any, E = Error> = (this: stream.Transform, chunk: T, encoding: BufferEncoding, callback: DataCallback<T, E>) => void;

/**
 * Creates a `TransformStream` pipe step. The doc on [[`TransformStream`]] is very helpful.
 * 
 * @typeParam T The type of data to be sent into the pipe step 
 * @typeParam U The type of data that will be produced by this pipe step and sent to the next pipe step
 * @typeParam E The type of error produced if something goes wrong
 * @param this Node will consume this argument and use it to set the context of the function to be the `TransformStream` itself
 *   so you can call methods on `this` in the function which will be the `TransformStream` instance
 * @param callback A standard callback to return an error or data to send to the next pipe step
 */
export declare type RStreamsTransformFunction<T, U, E = Error> = (this: TransformStream<T, U>, obj: T, callback: DataCallback<U, E>) => void;

/**
 * This is a flush event callback function.  When a stream is closed, the pipe is flushed meaning all events flow out of
 * the pipe until it's empty.  Once it's empty, the `FlushCallabck` will be called, allowing the developer to do cleanup
 * like close open database connections or whatever.
 * 
 * @typeParam T 
 * @typeParam E The type of an error, if there is one
 * @param this Node will consume this argument and use it to set the context of the function to be the `TransformStream` itself
 *   so you can call methods on `this` in the function which will be the `TransformStream` instance
 * @param flushCallback The function to call when the flush is complete
 * @todo question what is T here? is it some kind of flushevent or something?
 */
export declare type FlushCallback<T = any, E = Error> = (this: stream.Transform, flushCallback: DataCallback<T, E>) => any;


/**
 * The standard RStreams event that is written to and read from RStreams bus queues and thus through Node pipes that work
 * with these queues.
 * 
 * @typeParam T The type of data that is the payload of the event, specific to the queue the event is meant for
 */
export interface BaseEvent<T> {
	/** The ID of the bot that wrote this event to the queue */
	id?: string;

	/** This is the name of the RStreams queue this event is in */
	event?: string;

	/**
	 * The millisecond (time since epoch) of when this event was created by the developer.
	 * @default now
	 */
	timestamp?: number;

	/** 
	 * The timestamp of the first event that made it to the bus that this event eventually derived from, however far back
	 * upstream.
	 * 
	 * @default now
	 */
	event_source_timestamp?: number;

	/** The RStreams queue-specific data that this event exists to wrap */
	payload?: T;

	/**
	 * Reference the doc on [`CorrelationId`] that describes this well.
	 */
	correlation_id?: CorrelationId;
}

/**
 * The standard RStreams event that is written to and read from RStreams bus queues and thus through Node pipes that work
 * with these queues.
 * 
 * @typeParam T The type of data that is the payload of the event, specific to the queue the event is meant for
 */
export interface Event<T> extends BaseEvent<T> {
	/** The ID of the bot that wrote this event to the queue */
	id: string;

	/** This is the name of the RStreams queue this event is in */
	event: string;
}

/**
 * An event that is written to an RStreams queue.  This is a wrapper around the 
 * data you care about `T` which is stored in the `payload` attribute.
 * 
 * @typeParam T The data that is stored in the event in the payload attribute
 */
export interface WriteEvent<T> extends Event<T> {
}

/**
 * An event that is read from an RStreams queue.  This is a wrapper around the 
 * data you care about `T` which is stored in the `payload` attribute.
 * 
 * @typeParam T The data that is stored in the event in the payload attribute
 * @todo question shouldn't we deprecate `id` or `eid`; why have both?
 */
export interface ReadEvent<T> extends Event<T> {
	/** The ID of the bot that wrote this event to the queue (a dup of id for legacy purposes) */
	eid: string;

	/** The RStreams queue-specific data that this event exists to wrap */
	payload: T;
}

/**
 * This is data stored in an RStreams queue `Event` to understand where this event came from before it got into the queue it 
 * is in now, whether that's an external system like Mongo or MS SQL Server or whether this event is a derivative
 * event from an upstream queue.
 
 * So, let's say that your bot read from Queue A and got event 123 from it.  Your bot then transformed event 123
 * and turned it into some new event that you sent to Queue B as event 789.  Your event 789 should keep track
 * of the ancestry of the event, storing here in the correlation information the fact that it came from
 * Queue A, the `source`, and event 123 in `start`.
 * 
 * Also note, that sometimes you will have a bot that reads several events from an upstream queue and then
 * writes exactly one aggregate event to a downstream queue.  In this case, you want to track the ID of the
 * first upstream event that was aggregated in `start` and the last aggregated event in `end` and set units
 * to the number of total events that got turned into this one event.
 * 
 * Developers that don't take the time to add this data to an event. do this will regret it in the future.  This information is critical
 * to the trace feature for debugging, both manual tracing to understand where an event came from and 
 * botmon's automated visual tracing.
 */
export interface CorrelationId {
	/** 
	 * Data that identifies the parent source of this data, often the parent RStreams queue name this event derived from or a 
	 * table in Mongo or a kinesis stream name, etc.
	 */
	source: string;

	/** 
	 * The starting ID in the parent source this event derived from.  If the parent was an RStreams queue, this will
	 * be the event ID.  If the parent was a mongo table this would the Mongo tail position, or if from kinesis this
	 * will be the kinesis sequence number, etc.  If this event derived from more than one parent event, `end` will be set. 
	 */
	start: string;
	// todo document: this actually exists and should be start or partial_start
	/**
	 * Same as `start` but indicates that the source eid is partial or incomplete.  This indicates to the system to NOT checkpoint on this correlation_id
	 * Use either `start` or `partial_start` but not both
	 */
	partial_start?: string;

	/** 
	 * The ending ID in the parent source this event derived from.  If the parent was an RStreams queue, this will
	 * be the event ID.  This being set means this event derived from multiple events in the parent queue and
	 * `start` is the first and `end` is the last. 
	 * 
	 * @default `start`
	 */
	end?: string;
	// todo document: this actually exists and should be end or partial_end
	/**
	 * Same as `end` but indicates that the source eid is partial or incomplete.  This indicates to the system to NOT checkpoint on this correlation_id
	 * Use either `end` or `partial_end` but not both
	 */
	partial_end?: string;

	/**
	 * If this event is derived from multiple parent events, this is how many.
	 * 
	 * @default 1
	 */
	units?: number;
}

/**
 * @inernal Don't use.
 */
interface InternalCorrelationId {
	source: string;
	start: string | number;
	end?: string | number;
	units?: number;
}
// export interface Buffered<T> {
//	 records: T[];
//	 size: number;
//	 isLast: boolean;
// }
// export interface BufferCounter {
//	 size: number;
//	 records: number;
// }
// export interface BufferedStream<T> extends TransformStream<T, Buffered<T>> {
//	 reset(): void;
//	 flush(done: DataCallback<null>): void;
//	 updateLimits(limits: any): void;
//	 options?: any;
// }
// export interface LeoStats {
//	 source_timestamp?: number | null;
//	 started_timestamp?: number | null;
//	 ended_timestamp?: number | null;
//	 eid?: string | null;
//	 units?: number | null;
//	 start_eid?: string | null;
// }
// export interface StatsStream extends TransformStream<any, any> {
//	 checkpoint?: LeoStatsCheckpoint;
//	 get(): LeoStats;
// }
// export interface LeoStatsCheckpoint {
//	 (params: any, done: any): any;
//	 stream: TransformStream<any, any>;
// }

/**
 * The RStreams bus will create this event and pass it to your bot when it is invoked.  It tells you the ID of the
 * bot your code is running as, so you don't have to hard-code it or so you can do complex things with fanout.
 * It also sends you detail on the bot itself, including checkpoints and so on.  Finally,
 * the event will include your own custom-defined config you registered that you wanted passed into your bot when invoked.
 * 
 * @typeParam T Your registered config data that will be mixed in with the event when sent to you
 * 
 * @todo inconsistent Why is this named __cron
 * @todo question how do you define stuff to get passed into your bot invocation
 * @todo example
 */
export type BotInvocationEventTyped<T extends any = {}> = T & BotInvocationEvent

/**
 * @todo unclear why is this here?
 */
export interface BotInvocationEvent {
	botId: string,
	__cron: Cron,
}


export interface RSFBotInvocationEvent extends BotInvocationEvent {
	prefix?: string;
	suffix?: string;
	botNumber: number;
	botCount?: number;
}

export interface RSFCronBotInvocationEvent extends RSFBotInvocationEvent {
}

export interface RSFQueueBotInvocationEvent extends RSFBotInvocationEvent {
	source: string;
	queue: string;
	destination?: string;
}

/**
 * First, remember that for legacy reasons `Cron` really means `Bot`.  This is details
 * about a bot.
 */
export interface Cron {
	/** The ID of the bot */
	id: string;

	/** The instance ID of the bot, used for fanout.  So, if running multiple instances of the same bot we can tell which this is. */
	iid?: string;

	/**
	 * The name of the bot 
	 * 
	 * @todo question is this the same as the ID of the bot or can they differ?
	 */
	name: string;

	/** 
	 * The invocation timestamp token which is what is used to lock on to prevent multiple concurrent invocations to the same bot
	 * @todo question Is this runid which I've seen elsewhere?
	 */
	ts: number;

	/** For local dev it will ignore the cron locking and force it to run (will run through the handshake and force it to take the lock) */
	force?: boolean;

	/** For local dev, skip the locking process altogether for guaranteing only one instance of the bot runs */
	ignoreLock?: boolean;

	//  time: i64;

	/** List of read/write positions of sources and destinations for this bot */
	checkpoints?: Checkpoints;
	// pub botName: string;
	//pub instances: string
}

/**
 * For queues the bot reads from, the checkpoint is the event ID in a given queue that the bot is known to have last read from. For queues
 * the bot writes to, this is the event ID of the last position written to in that queue.
 */
export interface Checkpoints {
	/** Read checkpoints where the key is the queue and the value is the checkpoint data */
	read: { [key: string]: Checkpoint };

	/** Write checkpoints where the key is the queue and the value is the checkpoint data */
	write: { [key: string]: Checkpoint };
}

/**
 * Represents a checkpoint. For queues the bot reads from, the checkpoint is the event ID in a given queue that the bot is known to have 
 * last read from. For queues the bot writes to, this is the event ID of the last position written to in that queue.
 * If you read 11 events and then update the checkpoint back to the RStreams bus, then `checkpoint`will be the event ID of the tenth
 * event, `records` would be 11, `started_timestamp` would be the time since the epoch of the first event and `ended_timestamp` would
 * be time since the epock of the 11th event and `source_timestamp` would be the timestamp of the first event that made it to the bus
 * that the 11th event derived from, no matter how far back upstream.
 */
export interface Checkpoint {
	/** The event ID of the position itself that is being remembered */
	checkpoint?: string,

	/** The timestamp of the last event represented by the checkpoint */
	ended_timestamp?: number,

	/** The number of records that this checkpoint represents, if checkpointing after every event this is 1, if waiting to CP after 10 then is 10 */
	records?: number,

	/** The timestamp of the first event that made it to the bus that this event eventually derived from, however far back upstream */
	source_timestamp?: number,

	/** The timestamp of the first event represented by the checkpoint */
	started_timestamp?: number,
}

export interface RStreamsContext<R = any> extends Context {
	//settings: S;
	resources?: R;
	botId: string;
	sdk: RStreamsSdk;
	getCheckpoint: (queue: string, defaultIfNull: string) => Promise<string>;
}
