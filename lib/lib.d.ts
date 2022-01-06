import pump from "pump";
import split from "split";
import stream from 'stream';
import Pumpify from "pumpify";
import moment from "moment";

interface RStreamsEventItem {
	id: string;
	event: string;
	timestamp: number;
	event_source_timestamp: string;
	payload: any;
	correlation_id: {
		source: string;
		start?: string;
		end?: string;
		units: number;
	};
}

declare type ThroughEvent = RStreamsEventItem | any;
interface RStreamsEventRead extends RStreamsEventItem {
	eid: string;
}

interface fromRStreams {
	subqueue?: string;
	runTime?: moment.DurationInputArg1;
	loops?: number;
	start?: string | null;
	limit?: number;
	size?: number;
	debug?: boolean;
	stopTime?: number;
}
interface RStreamStats extends stream.Transform {
	checkpoint: {
		(callback: (err: any) => void): void;
	};
	get: {
		(): any;
	};
}

export interface LeoStream {
	pipe: typeof pump;
	split: typeof split;
	parse: {
		(skipErrors?: boolean): stream.Transform;
	};
	through: {
		(func: (obj: RStreamsEventRead | ThroughEvent, done: (err?: string | null | Error, obj?: ThroughEvent) => void, push: (obj: any) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
		(opts: RStreamsEventRead | ThroughEvent, func: (obj: any, done: (err?: string | null | Error, obj?: ThroughEvent) => void, push: (obj: any) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
	};
	/**
 * @function
 * @property {number} x - Need to explain the purpose of X here.
 * @property {number} y - Need to explain the purpose of Y here.
 * @returns {number} - Describe return value here (assumed number type for this example)
 */
	write: {
		(func: (obj: RStreamsEventRead | ThroughEvent, done: (err?: string | null | Error, obj?: ThroughEvent) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
		(opts: RStreamsEventRead | ThroughEvent, func: (obj: any, done: (err?: string | null | Error, obj?: ThroughEvent) => void) => void, flush?: (done: (err?: string | null | Error) => void, push: (obj: any) => void) => void): stream.Transform;
	};
	log: {
		(prefix?: string): stream.Transform;
	};
	stats: {
		(botId: string, queue: string, opts?: {
			records: number;
			time: moment.DurationInputArg1;
			debug: boolean;
		}): RStreamStats;
	};
	fromLeo: (botId: string, inQueue: string, config?: fromRStreams) => stream.Transform;
	toLeo: (botId: string, config?: {
		useS3?: boolean;
		firehose?: boolean;
	}) => stream.Transform;
	checkpoint: (config?: {
		records: number;
		time: moment.DurationInputArg1;
		debug: boolean;
	}) => stream.Transform;
	enrich: (config: {
		id: string;
		inQueue: string;
		outQueue: string;
		config: fromRStreams;
		transform: () => any;

	}, callback: () => any) => Pumpify;
	offload: (config?: {
		id: string;
		inQueue: string;
		config: fromRStreams;
		batch?: () => any;
		each?: () => any;
		callback: () => any;
	}) => Pumpify;
	load: (botId: string, outQueue: string, config?: {
		useS3?: boolean;
		autoDetectPayload?: boolean;
	}) => Pumpify;
	devnull: () => stream.Transform;
	stringify: () => stream.Transform;
	gzip: () => stream.Transform;
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
