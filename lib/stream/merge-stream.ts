import { Readable, ReadableOptions } from "stream";
import eos from "end-of-stream";
import leoLogger from "leo-logger";
const logger = leoLogger("MergeStream");
interface MergeStreamOptions<T> extends ReadableOptions {
	indexField?: string;
	compare: (a: T, b: T) => number
}
interface MergeStreamReadable extends Readable {
	_merge_readable: boolean;
	_merge_index: number;
	_merge_source: any;
	_merge_chunk: any;
	_merge_end: boolean;
}

function stream2(stream) {
	if (stream._readableState) {
		return stream;
	}
	return new Readable({ objectMode: true, highWaterMark: 16 }).wrap(stream);
}

function destroy(stream) {
	if (stream.readable && stream.destroy) {
		stream.destroy();
	}
}
function exist(chunk) {
	return chunk !== null;
}

export class MergeStream<T> extends Readable {
	private _stream_added: boolean;
	private _compare: (a: T, b: T) => number;
	private _streams: MergeStreamReadable[];
	private _destroyed: boolean;

	constructor(private opts: MergeStreamOptions<T>) {

		super({ highWaterMark: 0, objectMode: true, ...opts });

		this._stream_added = false;
		this._compare = opts.compare;
		this._streams = [];
		this._destroyed = false;
	}

	destroy(err?: Error): this {
		logger.log("destroy", err || "");

		if (this._destroyed) {
			return;
		}

		this._destroyed = true;
		this._streams.forEach(s => {
			destroy(s._merge_source);
		});

		if (err) {
			this.emit('error', err);
		}
		if (this.opts.emitClose !== false) {
			this.emit('close');
		}
	}

	addStream(streamToAdd: Readable) {
		let stream = streamToAdd as MergeStreamReadable;
		this._stream_added = true;

		stream._merge_end = false;

		stream._merge_chunk = null;
		stream._merge_source = stream2(stream);
		eos(stream, (err) => {
			logger.log("eos", stream._merge_index, "ended", err || "");
			if (err) {
				return this.destroy(err);
			}
			stream._merge_end = true;
			this._read(undefined);
		});

		stream.on('readable', () => {
			logger.log("readable", stream._merge_index, "readable");
			stream._merge_readable = true;
			this._read(undefined);
		});
		stream._merge_index = this._streams.push(stream) - 1;
	}

	_read(_size: number): void {
		var chunk = null;

		let msg = this._streams.map(s => {
			return `${s._merge_index}: ${s._merge_chunk ? s._merge_chunk[this.opts.indexField] : "none"}`;
		}).join(", ");

		logger.log("_read", "Reading:", msg);
		this._streams.forEach((s) => {
			if (s._merge_readable && !exist(s._merge_chunk)) {
				s._merge_chunk = s._merge_source.read();
				s._merge_readable = exist(s._merge_chunk);
				logger.log("_read", "Read Chunk:", s._merge_index, s._merge_chunk && s._merge_chunk[this.opts.indexField]);
			}
		});


		this._streams = this._streams.filter(s => !s._merge_end || exist(s._merge_chunk));

		let everyStreamHasChunk = this._streams.length && this._streams.every(s => exist(s._merge_chunk));
		if (everyStreamHasChunk) {
			let msg = this._streams.map(s => {
				return `${s._merge_index}: ${s._merge_chunk ? s._merge_chunk[this.opts.indexField] : "none"}`;
			}).join(", ");
			logger.log("_read", "Comparing", msg);
			let sorted = this._streams.sort((a, b) => this._compare(a._merge_chunk, b._merge_chunk));
			let stream = sorted[0];

			chunk = stream._merge_chunk;
			stream._merge_chunk = null;
		}

		if (exist(chunk)) {
			logger.log("_read", "emit", chunk[this.opts.indexField]);
			this.push(chunk);
		}

		logger.log("_read", "Should end:", !exist(chunk) && this._streams.length == 0 && this._stream_added, this._streams.length, this._stream_added);
		if (!exist(chunk) && this._streams.length == 0 && this._stream_added) {
			this.push(null);
		}
	}
}

export default MergeStream;
