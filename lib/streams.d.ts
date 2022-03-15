
import moment from 'moment';
import stream from 'stream';
import through2 from 'through2';

declare type ProcessCallback = (err?: any, result?: boolean | object, opts?: ProcessCallbackOptions) => void;
declare type ProcessFunction = (payload: any, wrapper: any, callback: ProcessCallback) => void;
declare type CommandWrapFunction = (
	obj: any,
	done: (err: any, result: any) => void,
	push: (data: any) => void
) => void;

export interface ProcessCallbackOptions {
	queue?: string;
	event_source_timestamp?: number;
	event?: string;
	eid?: string;
	units?: number;
}

export interface CommandWrapOptions {
	hasCommands?: string;
	ignoreCommands?: string[];
}

// export interface AsEventOptions {}
export interface Streams {
	commandWrap: (opts: CommandWrapOptions, func: CommandWrapFunction) => stream.Transform;
	bufferBackoff: (each, emit, retryOpts, opts, flush) => stream.Transform;
	fromCSV: (fieldList, opts) => stream.Transform;

	//asEvent: (opts: AsEventOptions) => stream.Transform;
	log: (prefix?: string) => stream.Transform;
	devnull: (shouldLog?: boolean | string) => stream.Transform;
	counter: (label: string, records?: number) => stream.Transform;
	process: (id: string, func: ProcessFunction, outQueue: string) => stream.Transform;
	batch: (opts: BatchOptions | Number) => stream.Transform

	passthrough: (opts?: stream.TransformOptions) => stream.Transform;
	through: (transform?: through2.TransformFunction, flush?: through2.FlushCallback) => stream.Transform;
	writeWrapped: (opts: CommandWrapOptions | any, func: CommandWrapFunction, flush?: through2.FlushCallback) => stream.Writable;
	//cmd: (watchCommands, singleFunc) => stream.Transform;
	buffer: (opts, each, emit, flush) => stream.Transform;
	//cmdFlush: (obj, done) => stream.Transform;
	stringify: () => stream.Transform;
	parse: (skipErrors?: boolean) => stream.Transform;

	/**
	 * @param {list} fieldList - List of strings to transform
	 * @param {Object} opts - fastCSV options https://c2fo.github.io/fast-csv/docs/parsing/options
	 * @param {string} opts.delimeter - The delimiter that will separate columns.
	 * @param {string} opts.escape - The character to used tp escape quotes inside of a quoted field.
	 * @param {string} opts.quote - The character to use to quote fields that contain a delimiter.
	 */
	toCSV: (fieldList: string[], opts: {
		delimiter?: string;
		escape?: string;
		quote?: string;
		nullValue?: any;
	}) => stream.Transform;

	toS3: (Bucket: string, File: string) => stream.Writable;
	fromS3: (file: {
		bucket: string,
		key: string;
		range?: string;
	}) => stream.Writable;
}


export interface BatchOptions {
	count?: Number;
	//records: Number; // same as count
	bytes?: Number;
	//size: Number; // Same as bytes
	time?: moment.DurationInputArg1;
	field?: string; // Field within the data that counts toward bytes limit
}
