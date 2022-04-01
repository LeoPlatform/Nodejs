export * from "./lib";
/// <reference types="node" />
import stream from 'stream';
// export interface LeoStreamOptions extends stream.TransformOptions {
//     ignoreCommands?: any;
//     cmd?: any;
//     cmdFlush?: any;
//     hasCommands?: any;
// }
export interface ReadableStream<T> extends stream.Readable {
    push(chunk: T, encoding?: BufferEncoding): boolean;
    read(size?: number): T;
}
export interface WritableStream<T> extends stream.Writable {
    _write(chunk: T, encoding: BufferEncoding, callback?: ErrorCallback): void;
    write(chunk: T, callback?: (error: Error | null | undefined) => void): boolean;
    write(chunk: T, encoding: BufferEncoding, callback?: (error: Error | null | undefined) => void): boolean;


    end(cb?: () => void): this;
    end(chunk: T, cb?: () => void): this;
    end(chunk: T, encoding: BufferEncoding, cb?: () => void): this;
}
export declare type DuplexStream<T, U> = TransformStream<T, U>;
export interface TransformStream<T, U> extends stream.Duplex {
    _write(chunk: T, encoding: BufferEncoding, callback?: ErrorCallback): void;
    write(chunk: T, callback?: (error: Error | null | undefined) => void): boolean;
    write(chunk: T, encoding: BufferEncoding, callback?: (error: Error | null | undefined) => void): boolean;

    push(chunk: U, encoding?: BufferEncoding): boolean;
    read(size?: number): U;
}
export declare type DataCallback<T = any, E = Error> = (err?: E | null, data?: T) => void;
export declare type ErrorCallback = (error: Error | null | undefined) => void;
export declare type TransformFunction<T = any, E = Error> = (this: stream.Transform, chunk: T, encoding: BufferEncoding, callback: DataCallback<T, E>) => void;
export declare type RStreamsTransformFunction<T, U, E = Error> = (this: TransformStream<T, U>, obj: T, callback: DataCallback<U, E>) => void;
export declare type FlushCallback<T = any, E = Error> = (this: stream.Transform, flushCallback: DataCallback<T, E>) => any;

export interface Event<T> {
    id: string;
    event: string;
    timestamp: number;
    event_source_timestamp: number;
    payload?: T;
    correlation_id?: CorrelationId;
}

export interface WriteEvent<T> extends Event<T> {
}

export interface ReadEvent<T> extends Event<T> {
    eid: string;
}

export interface CorrelationId {
    source: string;
    start: string;
    end?: string;
    units?: number;
}

interface InternalCorrelationId {
    source: string;
    start: string | number;
    end?: string | number;
    units?: number;
}
// export interface Buffered<T> {
//     records: T[];
//     size: number;
//     isLast: boolean;
// }
// export interface BufferCounter {
//     size: number;
//     records: number;
// }
// export interface BufferedStream<T> extends TransformStream<T, Buffered<T>> {
//     reset(): void;
//     flush(done: DataCallback<null>): void;
//     updateLimits(limits: any): void;
//     options?: any;
// }
// export interface LeoStats {
//     source_timestamp?: number | null;
//     started_timestamp?: number | null;
//     ended_timestamp?: number | null;
//     eid?: string | null;
//     units?: number | null;
//     start_eid?: string | null;
// }
// export interface StatsStream extends TransformStream<any, any> {
//     checkpoint?: LeoStatsCheckpoint;
//     get(): LeoStats;
// }
// export interface LeoStatsCheckpoint {
//     (params: any, done: any): any;
//     stream: TransformStream<any, any>;
// }

export type BotInvocationEvent2<T extends any = {}> = T & {
    botId: string,
    __cron: Cron,
}

export interface BotInvocationEvent {
    botId: string,
    __cron: Cron,
}

export interface Cron {
    id: string;
    iid?: string;
    name: string;
    ts: number;
    force?: boolean;
    ignore_lock?: boolean;
    //  time: i64;
    checkpoints?: Checkpoints;
    // pub botName: string;
    //pub instances: string
}

export interface Checkpoints {
    read: { [key: string]: Checkpoint };
    write: { [key: string]: Checkpoint };
}

export interface Checkpoint {
    checkpoint?: string,
    ended_timestamp?: number,
    records?: number,
    source_timestamp?: number,
    started_timestamp?: number,
}
