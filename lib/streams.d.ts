
import moment from 'moment';
import stream from 'stream';
import through2 from 'through2';
import pump from "pump";
import { ParserOptionsArgs } from 'fast-csv';
import { ErrorCallback, DataCallback, Event, FlushCallback, ReadEvent, TransformFunction, ReadableStream, WritableStream, TransformStream } from "./types";
import * as es from "event-stream";

/**
 * This is a standard callback used to tell the SDK that you are done processing something,
 * either successfully or not successfully.  If the processing succeeded and you don't need to checkpoint
 * and you don't want to pass anything on to flow to the next processing step, you can just call this function with no arguments.
 * 
 * @typeParam T The data to give to the next processing step, in a pipeline that would be putting the data 
 *   into the pipeline to flow to the next pipeline step.
 * @param err If processing failed, set this to an Error object representing the failure.
 * @param result If processing succeed and you don't need to pass anything to another processing step, you can pass true
 *   here which will checkpoint for you for the event being processed.  If processing succeeded and you need to send a result
 *   of processing to another processing step, set this to be the data to send.
 * @param opts This allows you to override the normal options used by the SDK for this one event that you are saying is now "done".
 * @todo question what is the default for result, to checkpoint or not checkpoint
 */
declare type ProcessCallback<T> = (err?: any, result?: boolean | T, opts?: ProcessCallbackOptions) => void;

/**
 * Overrides for controlling what the SDK does when you `push` data to the next stream step when using the
 * `push` method with the `enrich` and `batch` operations.
 */
declare interface ProcessFunctionOptions extends ProcessCallbackOptions {
	/** 
	 * When turning 1 event into many events you don't want to checkpoint this one
	 * event instead you want to wait until you've generated the many events and
	 * so this attribute tells the SDK not to checkpoint yet because
	 * 
	 * NOTE: in this case you are responsible for sending a non-partial event (one with no paylod perhaps)
	 * at the end with partial: false to cause the final checkpoint to occur.
	 * 
	 * @default false
	 */
	partial?: boolean;

	/**
	 * Overriding the default queue to send the event to
	 */
	queue?: string;
	/**
	 * Overriding the default event_source_timestamp from the source event
	 */
	event_source_timestamp?: number;


	/**
	 * Overriding the source eid to use for correlation
	 */
	eid?: string;

	/**
	 * Overriding the default units from the source event
	 */
	units?: number;
}

/**
 * The `this` context for your process function so you can have a `push` event to take
 * manual control in differents scenarios.
 */
declare interface ProcessFunctionContext<T> {
	push: (data: T, options?: string | ProcessFunctionOptions) => void;
}

/**
 * A function that takes the payload of the event (T) and the wrapper of the entire event (ReadEvent<T>) and then a callback
 * that produces the transformed value U.
 * 
 * @typeParam T The type of the data that is to be processed
 * @typeParam U The type of the data that will be the result of processing
 * @param payload The data to be processed
 * @param wrapper 
 * @param callback The function to call when done with the result, if any
 * @todo unclear I don't understand what wrapper is and how it would be used.
 * @todo docbug Missing that this can be either callback or promise based in the type definition
 */
declare type ProcessFunction<T, U> = (this: ProcessFunctionContext<U>, payload: T, wrapper: ReadEvent<T>, callback: ProcessCallback<U>) => void;
declare type ProcessFunctionAsync<T, U> = (this: ProcessFunctionContext<U>, payload: T, wrapper: ReadEvent<T>) => Promise<ProcessFunctionAsyncReturn<U> | ProcessFunctionAsyncReturnOptions<U>>;

declare type ProcessFunctionAsyncReturn<T> = T | T[] | boolean;
interface ProcessFunctionAsyncReturnOptions<T> {
	data: ProcessFunctionAsyncReturn<T>,
	options: ProcessCallbackOptions
}

/**
 * A function that takes the data to be processed, the callback done function and a push function
 * that can be used to wrap a command to do work.
 * 
 * If the processing succeeded and you don't need to checkpoint
 * and you don't want to pass anything on to flow to the next processing step, you can just call this function with no arguments.
 * 
 * @typeParam T The type of the data to be processed
 * @typeParam U The type of the data that results from being processed
 * 
 * @todo unclear what is this used for? what's an example.
 */
declare type CommandWrapFunction<T, U = any> = (
	/** The data to be processed. */
	obj: T,

	/** 
	 * The callback function to send back an error or the successful processed result.
	 * 
	 * @param err If processing failed, set this to an Error object representing the failure.
	 * @param result If processing succeed and you don't need to pass anything to another processing step, you can pass true
	 *   here which will checkpoint for you for the event being processed.  If processing succeeded and you need to send a result
	 *   of processing to another processing step, set this to be the data to send.
	 */
	done: (err?: any, result?: U) => void,

	/**
	 * A convenience method to push the resulting processed data to a queue.
	 * 
	 * @typeParam U The type of the data resulting from processing that should be pushed to a queue.
	 * @param data The data to push to a queue.
	 */
	push: (data: U) => void
) => void;

/**
 * Super powerful and convenient options to override per event should you want them.  
 * Perhaps doing an enrich and all events are going from
 * queue A to queue B but this one event is an error, so you can specificy that the event should be sent
 * to the dead letter queue instead of the queue it would go to normally.
 */
export interface ProcessCallbackOptions {
	/** An override for which queue this event will go to (doesn't work when using `useS3: true`) */
	queue?: string;

	/** 
	 * Lets you set the timestamp of the first event that made it to the bus that eventually led to this event
	 * being created as a derivative in one manner or another.
	 */
	event_source_timestamp?: number;

	/** @deprecated Do not use */
	event?: string;

	/** Lets you set this one event's event ID manually */
	eid?: string;

	/** Lets you set the number of parent events this one event has derived from, aggregating N previous event into this one event where N is `units` */
	units?: number;
}

/**
 * @todo document
 */
export interface CommandWrapOptions {
	hasCommands?: string;
	ignoreCommands?: string[];
}

// export interface AsEventOptions {}
//export default interface Streams {
//export function pipe(streams: stream.Transform[], callback?: pump.Callback): stream.Transform;
//export function pipe(...streams: Array<stream.Transform | pump.Callback>): stream.Transform;


/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T The type of data that is produced by the source
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param write Pipeline step 2: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 * @todo question how is the return value a pipeline, how does WritableStream<T1> | stream.Stream mean pipeline.
 */
export function pipe<T1>(read: ReadableStream<T1> | stream.Stream, write: WritableStream<T1> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T1> | stream.Stream;

/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 3: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 */
export function pipe<T1, T2>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, write: WritableStream<T2> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T2> | stream.Stream;

/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the final step of the pipe
 *  
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 4: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 */
export function pipe<T1, T2, T3>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, write: WritableStream<T3> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T3> | stream.Stream;

/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 5: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 */
export function pipe<T1, T2, T3, T4>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, write: WritableStream<T4> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T4> | stream.Stream;

/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T5 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t4 Pipeline step 5: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 6: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 */
export function pipe<T1, T2, T3, T4, T5>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, write: WritableStream<T5> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T5> | stream.Stream;

/**
 * A callback-based version of [[`pipeAsync`]]. Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T5 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T6 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t4 Pipeline step 5: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t5 Pipeline step 6: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 7: The sink that is the last step of the pipe
 * @param errorCallback Called if something goes wrong
 * @returns The pipeline itself
 */
export function pipe<T1, T2, T3, T4, T5, T6>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, write: WritableStream<T6> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T6> | stream.Stream;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T The type of data that is produced by the source
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param write Pipeline step 2: The sink that is the last step of the pipe
 * @returns A promise so it can play nice with async/await
 */
export function pipeAsync<T1>(read: ReadableStream<T1> | stream.Stream, write: WritableStream<T1>): Promise<void>;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 3: The sink that is the last step of the pipe
 * @returns A promise so it can play nice with async/await
 */
export function pipeAsync<T1, T2>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, write: WritableStream<T2>): Promise<void>;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 4: The sink that is the last step of the pipe
 * @returns A promise so it can play nice with async/await
 */
export function pipeAsync<T1, T2, T3>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, write: WritableStream<T3>): Promise<void>;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 5: The sink that is the last step of the pipe
 */
export function pipeAsync<T1, T2, T3, T4>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, write: WritableStream<T4>): Promise<void>;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T5 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t4 Pipeline step 5: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 6: The sink that is the last step of the pipe
 * @returns A promise so it can play nice with async/await
 */
export function pipeAsync<T1, T2, T3, T4, T5>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, write: WritableStream<T5>): Promise<void>;

/**
 * An async/await-friendly version of [[`pipe`]].  Creates a pipeline of steps where the first step produces the data and then 
 * it flows to the next step and so on. The first step is the source, producing the content, the final step is the sink.
 * 
 * @typeParam T1 The type of data that is produced by the source
 * @typeParam T2 The type of data generated and that moves to the next step of the pipe
 * @typeParam T3 The type of data generated and that moves to the next step of the pipe
 * @typeParam T4 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T5 The type of data generated and that moves to the next step of the pipe  
 * @typeParam T6 The type of data generated and that moves to the final step of the pipe
 * 
 * @param read Pipeline step 1: The source that produces the data, the first step of the pipe
 * @param t1 Pipeline step 2: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t2 Pipeline step 3: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t3 Pipeline step 4: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t4 Pipeline step 5: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param t5 Pipeline step 6: A transformation step that takes data from the previous step and pushes the result to the next step
 * @param write Pipeline step 7: The sink that is the last step of the pipe
 * @returns A promise so it can play nice with async/await
 */
export function pipeAsync<T1, T2, T3, T4, T5, T6>(read: ReadableStream<T1> | stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, write: WritableStream<T6>): Promise<void>;

// export function pipe<T1>(read: ReadableStream<T1> | stream.Stream | stream.Readable, write: WritableStream<T1> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T1>;
// export function pipe<T1, T2>(read: ReadableStream<T1> | stream.Stream | stream.Readable, t1: TransformStream<T1, T2>, write: WritableStream<T2> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T2>;
// export function pipe<T1, T2, T3>(read: ReadableStream<T1> | stream.Stream | stream.Readable, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, write: WritableStream<T3> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T3>;
// export function pipe<T1, T2, T3, T4>(read: ReadableStream<T1> | stream.Stream | stream.Readable, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, write: WritableStream<T4> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T4>;
// export function pipe<T1, T2, T3, T4, T5>(read: ReadableStream<T1> | stream.Stream | stream.Readable, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, write: WritableStream<T5> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T5>;
// export function pipe<T1, T2, T3, T4, T5, T6>(read: ReadableStream<T1> | stream.Stream | stream.Readable, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, write: WritableStream<T6> | stream.Stream, errorCallback?: ErrorCallback): WritableStream<T6>;

//export function pipe(...args:(ReadableStream<any>|TransformStream<any,any>|WritableStream<any>)[])

/**
 * Only used in advanced scenarios where you need to wrap multiple pipeline steps into a single writeable stream.
 * This is useful when you need to give some other code access to feed data into your pipeline.  It is not commonly used.
 * 
 * @typeParam T1 The type of data that will be written to the 
 * 
 * @param write The first step to be wrapped
 * @param drain 
 * @param errorCallback 
 * @todo unclear
 * @todo incomplete
 * @returns The single pipeline step that wraps up all the steps passed in into a single step
 */
export function pipeline<T1, D extends WritableStream<T1>>(write: WritableStream<T1>, drain: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, D extends WritableStream<T2>>(write: WritableStream<T1>, t1: TransformStream<T1, T2>, t2?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, D extends WritableStream<T3>>(write: WritableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, D extends WritableStream<T4>>(write: WritableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, D extends WritableStream<T5>>(write: WritableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, T6, D extends WritableStream<T6>>(write: WritableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, t6?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;


export function pipeline<T1, T2, D extends WritableStream<T2>>(write: ReadableStream<T1>, t1: TransformStream<T1, T2>, t2?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, D extends WritableStream<T3>>(write: ReadableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, D extends WritableStream<T4>>(write: ReadableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, D extends WritableStream<T5>>(write: ReadableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, T6, D extends WritableStream<T6>>(write: ReadableStream<T1>, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, t6?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;

export function pipeline<T1, T2, D extends WritableStream<T2>>(write: stream.Stream, t1: TransformStream<T1, T2>, t2?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, D extends WritableStream<T3>>(write: stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, D extends WritableStream<T4>>(write: stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, D extends WritableStream<T5>>(write: stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;
export function pipeline<T1, T2, T3, T4, T5, T6, D extends WritableStream<T6>>(write: stream.Stream, t1: TransformStream<T1, T2>, t2: TransformStream<T2, T3>, t3: TransformStream<T3, T4>, t4: TransformStream<T4, T5>, t5: TransformStream<T5, T6>, t6?: D, errorCallback?: ErrorCallback): D extends ReadableStream<infer U> ? TransformStream<T1, U> : WritableStream<T1>;


/**
 * Helper function to turn a timestamp into an RStreams event ID.
 * 
 * @param timestamp The timestamp you want to turn into an RStreams event ID which can be anything used to construct a Moment object
 * @param granularity Specify the granularity of the event ID, maybe just year/month or year/month/hour, etc.
 * @returns The generated event ID
 * @todo question I need examples of granularity values to know what to put here
 */
export function eventIdFromTimestamp(timestamp: moment.MomentInput, granularity?: string, record?: number): string;

/**
 * Helper function to turn a an RStreams event ID into a timestamp.
 * 
 * @param eid The event ID to turn into an epoch timestamp
 * @returns The timestamp as a time since the epoch
 */
export function eventIdToTimestamp(eid: string): number;

/** For convenience, a re-export of the popular [event-stream library](https://www.npmjs.com/package/event-stream). */
export const eventstream: typeof es;

/**
 * 
 * @param opts 
 * @param func 
 * @todo incomplete
 * @todo unclear
 * @returns The pipeline step that is ready to be used in a pipeline
 */
export function commandWrap<T, U>(opts: CommandWrapOptions, func: CommandWrapFunction<T, U>): TransformFunction;

/**
 * 
 * @param each 
 * @param emit 
 * @param retryOpts 
 * @param opts 
 * @param flush
 * @todo incomplete
 * @todo unclear 
 */
export function bufferBackoff<T>(each, emit, retryOpts, opts, flush): WritableStream<T>;

//asEvent: (opts: AsEventOptions):stream.Transform;

/**
 * Creates a pipeline step that will log events as they pass through which can be helpful for debugging in between streaming operations.
 * 
 * @typeParam T The type of the data that flows through the step to be logged
 * @param prefix If provided, this prefix is included with each log
 * @todo incomplete what does it log and how often
 * @returns The pipeline step that is ready to be used in a pipeline
 */
export function log<T>(prefix?: string): TransformStream<T, T>;

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
export function devnull<T>(shouldLog?: boolean | string): WritableStream<T>;

/**
 * This creates a pipeline step that takes an event, logs it and then passes the event on to the next pipeline step.
 * The log will include the event ID of the event, if it's present.  This is helpful to get visibility into the pipeline.
 * 
 * @typeParam T The type of the event that flows in, gets logged and then flows unchanged to the next pipeline step
 * @param label If present, log statements are prefixed with this string
 * @param records If present, only log every Nth event that flows through where N is `records`
 * @returns The pipeline step that is ready to be used in a pipeline
 * @todo review
 */
export function counter<T>(label: string, records?: number): TransformStream<T, T>;

/**
 * This creates a pipeline step that takes an event, logs it and then passes the event on to the next pipeline step.
 * The log will include the event ID of the event, if it's present.  This is helpful to get visibility into the pipeline.
 * 
 * @typeParam T The type of the event that flows in, gets logged and then flows unchanged to the next pipeline step
 * @param records If present, only log every Nth event that flows through where N is `records`
 * @returns The pipeline step that is ready to be used in a pipeline
 * @todo review
 */
export function counter<T>(records?: number): TransformStream<T, T>;

/**
 * This creates a pipeline step that takes events in of type T, allows your code to process it and then
 * you send an event of type U to the the next pipeline step.
 * 
 * @typeParam T The type of the data sent into the function to be processed
 * @typeParam U The type of the data you send on after being processed
 * 
 * @internal
 * @param id The name of the bot act as
 * @param func The function to process data, getting data of type T and returning data of type U
 * @param outQueue The queue to send the resulting data to
 * @returns The pipeline step that is ready to be used in a pipeline
 * @todo question Couldn't find any references to this.
 * @todo question don't we already have other ways to do this?  do we need this?
 * @todo unclear This is a transform stream which means it can't be the sink and yet it takes an outQueue as though it's sending to another queue.  Don't get it.
 */
export function process<T, U>(id: string, func: ProcessFunction<T, U>, outQueue: string): TransformStream<T, U>;

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
export function batch<T>(opts: BatchOptions | number): TransformStream<T, ReadEvent<T[]>>;

export function passthrough<T, U>(opts?: stream.TransformOptions): TransformStream<T, U>;
//export function through(transform?: through2.TransformFunction, flush?: through2.FlushCallback): stream.Transform;

/**
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
 * @see [[`throughAsync`]]
 * @returns The pipeline step that is ready to be used in a pipeline
 * 
 * @todo example When you'd want to use this in the transform function
 * @todo review
 * @todo example with flush
 */
export function through<T, U>(transform?: (this: TransformStream<T, U>, obj: T, done: DataCallback<U>) => void, flush?: FlushCallback<U>): TransformStream<T, U>;

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
export function throughAsync<T, U>(transform?: (this: TransformStream<T, U>, obj: T) => Promise<U> | U, flush?: (this: TransformStream<T, U>) => Promise<U> | U): TransformStream<T, U>;

/**
 * Wraps a command function as a WriteableStream.
 * 
 * @param opts 
 * @param func 
 * @param flush 
 * @result todo
 * @todo unclear
 */
export function writeWrapped<T>(opts: CommandWrapOptions | any, func: CommandWrapFunction<T, any>, flush?: through2.FlushCallback): WritableStream<T>;

/**
 * Wraps a command function as a WriteableStream.
 * 
 * @param opts 
 * @param func 
 * @param flush 
 * @result todo
 * @todo unclear
 */
export function writeWrapped<T>(func: CommandWrapFunction<T, any>, flush?: through2.FlushCallback): WritableStream<T>;

//cmd(watchCommands, singleFunc):stream.Transform;

/**
 * 
 * @param opts 
 * @param each 
 * @param emit 
 * @param flush
 * @todo unclear
 * @todo incomplete 
 * @todo question Why aren't there types on these args?
 */
export function buffer(opts, each, emit, flush): stream.Transform;

//cmdFlush(obj, done):stream.Transform;

/**
 * This creates a pipeline step that turns a Javascript object into a [JSON line](https://jsonlines.org/)
 * (newline at the end of the stringified JS object). This is used to make it easy to create JSON lines files.
 * 
 * @returns The pipeline step that is ready to be used in a pipeline
 */
export function stringify(): TransformStream<any, string>;

/**
 * A pipeline step that will split and parse [JSON lines](https://jsonlines.org/), turning them into events.
 * 
 * @typeParam T The type of object produced from parsing the JSON objects.
 * @param skipErrors If true and there's a parse error, the error and the JSON line that couldn't be parsed is skipped.  Defaults to false.
 * @returns The pipeline step that is ready to be used in a pipeline
 * @todo question why isn't this parameterized with <T>
 */
export function parse(skipErrors?: boolean): stream.Transform;

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
export function toCSV(fieldList: boolean | string[], opts?: ToCsvOptions): TransformStream<any, any>;

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
export function fromCSV(fieldList: boolean | string[], opts?: FromCsvOptions): TransformStream<any, any>;

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
export function toS3(Bucket: string, File: string): WritableStream<any>;

/**
 * This creates a pipeline step that can act as the first step in a pipeline, the source, which reads data
 * from an S3 file.
 * 
 * @param file What to read from.
 * @returns The pipeline step that is ready to be used in a pipeline
 * @todo question in lib.d.ts the fromS3 function returns a stream.Readable not a WriteableStream<any>.  Why?
 */
export function fromS3(file: {
	/** The name of the S3 bucket to read from */
	bucket: string,

	/** The name of the file in the bucket to read from */
	key: string;

	/**
	 * Read from a specific range in the file.  This is a string that must look like this:
	 * `bytes=<startingByteoffset>-<endingByteOffset>` where <startingByteoffset> is the start position to read from
	 * and <endingByteOffset> is the ending position to read from, exclusive.
	 * 
	 * @todo question Is this an exclusive read meaning it reads up to but doesn't actually read the endingByteOffset position?
	 */
	range?: string;
}): WritableStream<any>;
//}


/**
 * @returns The pipeline step that joins an external data source with events
 */
export function joinExternal<T, R>(fetcher: JoinExternalFetcher<T, R>): TransformStream<T, R>;


/**
 * An interface that extends the [fastCSV libraries options](https://c2fo.github.io/fast-csv/docs/parsing/options)
 * in case we add our own.
 */
export interface FromCsvOptions extends ParserOptionsArgs { }

/**
 * The subset of the options we support from [fastCSV libraries options](https://c2fo.github.io/fast-csv/docs/parsing/options).
 */
export interface ToCsvOptions {
	/**
	 * The delimiter that will separate columns. Set this option if your file uses an alternate delimiter such as
	 * `;`or `\t`.
	 * @default `,`
	 */
	delimiter?: string;

	/**
	 * The character to use to escape quotes inside of a quoted field.
	 * 
	 * @default `"`
	 */
	escape?: string;

	/**
	 * The character to use to quote fields that contain a delimiter.
	 * 
	 * @default `"`
	 */
	quote?: string;

	/**
	 * The value to write for null.
	 * 
	 * @default `null`
	 * @todo review is this correct?
	 */
	nullValue?: any;
}

/**
 * Used in pipeline operations to tell the SDK to micro-batch events received in one pipeline step
 * before sending them to the next pipeline step.
 * 
 * The SDK will send events to the next pipeline step as soon as one of the `count`, `bytes` or 
 * `time` constraints are met.
 * 
 * @see [[`EnrichOptions.batch`]] Good doc on using this.
 * @todo review Is this doc right?
 * @todo review these were commented out, are they really there and should be deprecated? //records: Number; // same as count //size: Number; // Same as bytes
 */
export interface BatchOptions {
	/** The number of events to micro-batch before sending them to the next step in the pipeline */
	count?: number;

	/**
	 * The number of bytes of events to micro-batch up before sending them to the next step in the pipeline 
	 * 
	 * @see [[`BatchOptions.field`]]
	 */
	bytes?: number;

	/** 
	 * The amount of time to wait, micro-batching events up before sending them to the next step in the pipeline 
	 * 
	 * Note, this type is any one of the [valid durations the Moment JS library](https://momentjs.com/docs/#/durations/)
	 * can take: Duration | number | string | FromTo | DurationInputObject.
	 * 
	 * @todo question Need examples of what this can take?  Cool moment things used for example.  Is this ms?
	 */
	time?: moment.DurationInputArg1;

	/**
	 * If micro-batching on number of bytes, then you may optionally set this to be the name of the field
	 * in the event that you wish to have used exclusively to count towards to the total number of bytes.
	 * This isn't used except in uncommon circumstances where one field alone should control the 
	 * micro-batching since its size will impact the amount of time the next pipeline step takes to proces.
	 * 
	 * @see [[`BatchOptions.bytes`]]
	 * @todo review
	 */
	field?: string;
}


export interface JoinExternalFetcher<T, R> {
	//getIds: (events)=> Key[],
	//getObjects: (events: T[]) => Record<string, ExtData>,
	join: (events: T[]) => Promise<(T & { joinData: R })[]>,
	batchOptions?: BatchOptions
}
