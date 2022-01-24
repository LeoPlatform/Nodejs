import pump from "pump";
import split from "split";
import stream from 'stream';
import Pumpify from "pumpify";
import moment from "moment";

//TODO finish documenting this file

export interface RStreamsEventItem<T> {
	id: string;
	/** 
	* @property {string} event - if reading this is inbound queue, when writing this is the new outbound queue
	*/
	event: string;
	timestamp: number;
	event_source_timestamp: number;
	payload: T;
	correlation_id: {
		source: string;
		start?: string;
		end?: string;
		units: number;
	};
}

export interface RstreamBatchResult<T> {
	payload: T[];
	units?: number;
}

export declare type ThroughEvent<T> = RStreamsEventItem<T> | any;
export interface RStreamsEventRead<T> extends RStreamsEventItem<T> {
	eid: string;
}

export interface fromRStreams {
	subqueue?: string;
	runTime?: moment.DurationInputArg1;
	loops?: number;
	start?: string | null;
	limit?: number;
	size?: number;
	debug?: boolean;
	stopTime?: number;
}
export interface RStreamStats extends stream.Transform {
	checkpoint: {
		(callback: (err: any) => void): void;
	};
	get: {
		(): any;
	};
}


export interface Rstreams {
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
				obj: RStreamsEventRead<any> | ThroughEvent<any>,
				done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void,
				push: (obj: any) => void) => void,
			flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void)
			: stream.Transform;
		(opts: RStreamsEventRead<any> | ThroughEvent<any>, func: (obj: any, done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void, push: (obj: any) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
	};
	write: {
		(func: (obj: RStreamsEventRead<any> | ThroughEvent<any>, done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
		(opts: RStreamsEventRead<any> | ThroughEvent<any>, func: (obj: any, done: (err?: string | null | Error, obj?: ThroughEvent<any>) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
	};
	/**
	 * Used to add logging in the stream.  Helpful for debugging in between streaming operations.
	 * @param {string} prefix - prefix to include with each log
	 */
	log: {
		(prefix?: string): stream.Transform;
	};
	batch: {
		(batchSize: number): stream.Transform;
	}
	stats: {
		(botId: string, queue: string, opts?: {
			records: number;
			time: moment.DurationInputArg1;
			debug: boolean;
		}): RStreamStats;
	};
	fromLeo: (botId: string, inQueue: string, config?: fromRStreams) => stream.Transform;
	fromS3: (file) => stream.Readable;
	toLeo: (botId: string, config?: {
		useS3?: boolean;
		firehose?: boolean;
	}) => stream.Transform;
	checkpoint: (config?: {
		records: number;
		time: moment.DurationInputArg1;
		debug: boolean;
	}) => stream.Transform;
	toCheckpoint: (config?: {}) => stream.Transform;
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
	enrich: (props: EnrichProps, callback) => Pumpify;
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
	offload: (offloadProps: OffloadProps, callback) => Pumpify;
	/**
	 * Stream for writing events to a queue
	 * @param {string} botId - The id of the bot
	 * @param {string} outQueue - The queue into which events will be written 
	 * @param {Object} config - An object that contains config values that control the flow of events to outQueue
	 * @return {stream} Stream
	 */

	/**
	 * @param {list} fieldList - List of strings to transform
	 * @param {Object} opts - fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 * @param {string} opts.delimeter - The delimiter that will separate columns.
	 * @param {string} opts.escape - The character to used tp escape quotes inside of a quoted field.
	 * @param {string} opts.quote - The character to use to quote fields that contain a delimiter.
	 */
	toCSV: (fieldList: string[], opts) => stream.Transform

	/**
	 * @param {list} fieldList - List of strings to transform
	 * @param {Object} opts - fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 * @param {string} opts.ignoreEmpty - Set to true to ignore empty rows.
	 * @param {string} opts.trim - Set to true to trim all white space from columns.
	 * @param {string} opts.escape - The character to used tp escape quotes inside of a quoted field.
	 * @param {string} opts.quote - The character to use to quote fields that contain a delimiter.
	 * @param {string} opts.delimiter - The delimiter that will separate columns.
	 */
	fromCSV: (fieldList: string[], opts) => stream.Transform
	load: (botId: string, outQueueDefault?: string, config?: {
		useS3?: boolean;
		autoDetectPayload?: boolean;
	}) => Pumpify;
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
	toDynamoDB: (table: string, opts: {
		hash: string;
		range: string;
		records?: number;
		size?: number;
		time?: moment.DurationInputArg1;
	}) => stream.Writable;
}

export interface RstreamsAsync extends Omit<Rstreams, 'pipe' | 'through' | 'write' | 'enrich' | 'offload' | 'load' | 'put'> {
	/**
	 * See {@link LeoStream.pipe}
	 */
	pipe: {
		(...streams: pump.Stream[]): Promise<void>
	},
	/**
	 * @param {function} asyncFunc - function that takes the (event and a push).  When finished processing the event, return it to pass it back to the stream or you can return multiple objects to the stream via the push
	 * @param {function} flush - function to be called when the remaining data has been flushed
	 */
	through: {
		(
			asyncFunc: {
				(obj: ThroughEvent<any>, push: {
					(obj: ThroughEvent<any>): void
				}): Promise<null | ThroughEvent<any>> | null | void | undefined
			},
			flush?: {
				(push: {
					(obj: ThroughEvent<any>): void
				}): Promise<null> | Promise<void> | void | null | undefined
			}
		): stream.Transform
	},
	write: {
		(
			asyncFunc: {
				(obj: ThroughEvent<any>): Promise<null | ThroughEvent<any>> | null | void
			},
			flush?: {
				(): Promise<null> | Promise<void> | null | void | undefined
			}
		): stream.Transform
	}
	/**
	 * See {@link Rstreams.enrich}
	 */
	enrich: {
		(props: EnrichProps): Promise<any>
	}
	/**
	 * See {@link Rstreams.offload}
	 */
	offload: {
		(props: OffloadProps): Promise<any>
	}
}

/**
 * See {@link Rstreams.offload}
 */
export interface OffloadProps {
	id: string //id of the bot
	inQueue: string //The queue from which events will be read
	config?: fromRStreams// An object that contains config values that control the flow of events from inQueue
	batch?: {
		(obj: any): any //TODO test with batching and veryify params
	},
	each?: {
		//A function to be applied to each piece of data in the queue
		/**
		 * @param {string} payload - only the payload that was sent into leo
		 * @param {string} event - the entire event that was placed in the leo queue, includes everything from RStreamsEventRead type
		 */
		(payload: any, event: any): any
	}
}

/**
 * See {@link Rstreams.enrich}
 */
export interface EnrichProps {
	id: string //id of the bot
	inQueue: string //The queue from which events will be read
	outQueue: string //The queue to which the events will be written
	config?: fromRStreams// An object that contains config values that control the flow of events from inQueue
	useS3?: boolean,
	transform: {
		//A function to transform data from inQueue to outQueue
		/**
		 * @param {string} payload - only the payload that was sent into leo
		 * @param {string} event - the entire event that was placed in the leo queue, includes everything from RStreamsEventRead type
		 */
		(payload: any, event: any): any
	}
}
