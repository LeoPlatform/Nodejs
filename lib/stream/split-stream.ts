import { Writable, WritableOptions } from "stream";
import leoLogger from "leo-logger";
const logger = leoLogger("SplitStream");

interface SplitStreamOptions<T> extends WritableOptions {
	splitter: (this: SplitStream<T>, event: T) => string;
	streamCreator: (this: SplitStream<T>, id: string) => Writable;
	indexField?: string;
}

export class SplitStream<T> extends Writable {
	queueStreams: {
		[key: string]: Writable
	} = {};

	constructor(private opts: SplitStreamOptions<T>) {
		super(opts);
	}
	getStreamCount() {
		return Object.keys(this.queueStreams).length;
	}
	write(event: T, encoding?: unknown, callback?: unknown): boolean {
		if (typeof encoding === "function") {
			callback = encoding;
			encoding = null;
		}
		let cb = (callback || (() => { })) as (error: Error | null | undefined) => void;
		let id = this.opts.splitter.call(this, event);
		let stream = this.getStream(id);
		logger.log("write:", id, (event as any)[this.opts.indexField]);
		let canWrite = stream.write(event);
		if (!canWrite) {
			stream.once("drain", () => cb(undefined));
		} else {
			cb(undefined);
		}
		return canWrite;
	}
	_final(callback: (error?: Error) => void): void {
		logger.log("final ending all queue streams", this.writable);
		let errors = {};
		let errCount = 0;
		Object.entries(this.queueStreams).forEach(([key, s]) => s.end((err) => {
			logger.log("final cb", key);
			if (err) {
				errors[key] = err;
				errCount++;
			}
			delete this.queueStreams[key];
			if (Object.keys(this.queueStreams).length === 0) {
				callback(errCount ? new Error(JSON.stringify(errors)) : undefined);
			}
		}));
	}

	getStream(queue: string, _writer?: string) {
		//TODO: Should writer be part of the key?
		let key = queue;
		if (!(key in this.queueStreams)) {
			this.queueStreams[key] = this.createStream(key);
		}

		return this.queueStreams[key];
	}
	createStream(id: string) {
		let s = this.opts.streamCreator.call(this, id);
		this.emit("stream-created", {
			id: id,
			stream: s
		});
		return s;
	}
}

export default SplitStream;
