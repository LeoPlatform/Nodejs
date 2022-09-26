import { Duplex, DuplexOptions, Readable, Writable } from "stream";

export class Duplexer extends Duplex {
	private _writable: Writable;
	private _readable: Readable;
	_waiting: boolean;

	constructor(writable: Writable, readable: Readable, opts?: DuplexOptions & { bubbleErrors?: boolean }) {
		super(opts);
		this._writable = writable;
		this._readable = readable;
		this._waiting = false;

		// writable events
		writable.once("finish", () => this.end());
		this.once("finish", () => this._writable.end());

		// readable events
		readable.on("readable", () => {
			if (this._waiting) {
				this._waiting = false;
				this._read(undefined);
			}
		});
		readable.once("end", () => {
			this.push(null);
		});

		// Error Events
		if (opts?.bubbleErrors !== false) {
			[writable, readable].forEach(s => {
				s.on("error", err => this.emit("error", err));
			});
		}
	}

	_write(chunk: unknown, encoding: BufferEncoding, callback: (error?: Error) => void): void {
		this._writable.write(chunk, encoding, callback);
	}

	_read(_size: number): void {

		const chunk = this._readable.read();
		if (chunk !== null) {
			this.push(chunk);
		} else {
			this._waiting = true;
		}
	}


}
