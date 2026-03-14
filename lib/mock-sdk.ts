import { Readable } from "stream";
import stream from "stream";
import { RStreamsSdk, ReadEvent, Event, Checkpoint, ReadableQueueStream, WritableStream, TransformStream, BotInvocationEvent } from "../index";
import { Callback, StreamUtil, CheckpointData, WriteOptions, ReadOptions, ToCheckpointOptions, StatsStream } from "./lib";
import { LeoCron } from "./cron";
import { promisify } from "util";

// ─── Spy infrastructure (zero external dependencies) ───────────────────────

export interface SpyCall {
	args: any[];
	timestamp: number;
}

export interface SpyFn<T extends (...args: any[]) => any = (...args: any[]) => any> {
	/** The callable spy function */
	(...args: Parameters<T>): ReturnType<T>;
	/** All recorded calls */
	calls: SpyCall[];
	/** Number of times called */
	callCount: number;
	/** Whether the spy was called at least once */
	called: boolean;
	/** Arguments from the last call, or undefined */
	lastCall: SpyCall | undefined;
	/** Reset this spy's call history */
	reset(): void;
}

function createSpy<T extends (...args: any[]) => any>(
	impl?: (...args: any[]) => any
): SpyFn<T> {
	const calls: SpyCall[] = [];

	const spy = function (...args: any[]) {
		const call: SpyCall = { args: [...args], timestamp: Date.now() };
		calls.push(call);
		if (impl) {
			return impl(...args);
		}
		// Default: invoke last arg if it's a callback
		const lastArg = args[args.length - 1];
		if (typeof lastArg === "function") {
			lastArg(null);
		}
	} as SpyFn<T>;

	spy.calls = calls;
	Object.defineProperty(spy, "callCount", { get: () => calls.length });
	Object.defineProperty(spy, "called", { get: () => calls.length > 0 });
	Object.defineProperty(spy, "lastCall", { get: () => calls.length > 0 ? calls[calls.length - 1] : undefined });
	spy.reset = () => { calls.length = 0; };

	return spy;
}

// ─── Mock queue read stream ────────────────────────────────────────────────

class MockReadStream<T> extends Readable implements ReadableQueueStream<T> {
	private queue: (ReadEvent<T>)[];
	private idx: number;
	private _stats: Checkpoint;
	private _hasCustomStats: boolean;
	private _opts: ReadOptions<T>;
	checkpointSpy: SpyFn;

	constructor(
		items: (T | ReadEvent<T>)[],
		queueName: string,
		eventIdFn: (ts: number, gran?: string, record?: number) => string,
		stats?: Partial<Checkpoint>
	) {
		super({ objectMode: true });
		const now = Date.now();
		this.idx = 0;
		this._hasCustomStats = stats != null && "records" in stats;
		this._opts = {} as ReadOptions<T>;

		// Normalize items to ReadEvent shape
		this.queue = items.map((item, i) => {
			if (isReadEvent<T>(item)) {
				return item;
			}
			return {
				id: "mock-bot",
				event: queueName,
				eid: eventIdFn(now, "full", i),
				timestamp: now,
				event_source_timestamp: now,
				payload: item as T,
			} as ReadEvent<T>;
		});

		// Pre-compute stats
		const lastItem = this.queue[this.queue.length - 1];
		this._stats = {
			checkpoint: lastItem?.eid,
			records: this.queue.length,
			source_timestamp: this.queue[0]?.event_source_timestamp || now,
			started_timestamp: this.queue[0]?.timestamp || now,
			ended_timestamp: lastItem?.timestamp || now,
			...stats,
		};

		this.checkpointSpy = createSpy((...args: any[]) => {
			const cb = args[args.length - 1];
			if (typeof cb === "function") cb(null);
		});
	}

	_read(_size: number): void {
		while (this.idx < this.queue.length) {
			const item = this.queue[this.idx++];
			if (!this.push(item)) return;
		}
		this.push(null);
	}

	get(): Checkpoint {
		return { ...this._stats, records: this._hasCustomStats ? this._stats.records : this.idx };
	}

	getOpts(): ReadOptions<T> {
		return this._opts;
	}

	checkpoint(paramsOrDone: any, done?: Callback): void {
		if (typeof paramsOrDone === "function") {
			this.checkpointSpy(paramsOrDone);
		} else {
			this.checkpointSpy(paramsOrDone, done);
		}
	}
}

function isReadEvent<T>(item: any): item is ReadEvent<T> {
	return item != null && typeof item === "object" && "eid" in item && "payload" in item;
}

// ─── Mock write capture ────────────────────────────────────────────────────

export interface QueueWriteCapture<T = any> {
	/** All complete event objects written */
	events: Event<T>[];
	/** Just the payloads for convenience */
	payloads: T[];
}

// ─── Bot spy surface ───────────────────────────────────────────────────────

export interface MockBotControl {
	checkLock: SpyFn;
	reportComplete: SpyFn;
	createLock: SpyFn;
	removeLock: SpyFn;
	checkpoint: SpyFn;
	getCheckpoint: SpyFn & { returnValue: Record<string, any> };
}

// ─── Checkpoint spy surface ────────────────────────────────────────────────

export interface MockCheckpointControl {
	/** Calls to bot.checkpoint */
	calls: SpyCall[];
	/** Calls recorded on the toCheckpoint stream */
	toCheckpointCalls: SpyCall[];
}

// ─── S3 mock capture ───────────────────────────────────────────────────────

export interface MockS3Control {
	/** Events/data written via streams.toS3, keyed by `${Bucket}/${File}` */
	written: Record<string, any[]>;
	/** Spy on toS3 calls */
	toS3Spy: SpyFn;
	/** Spy on fromS3 calls */
	fromS3Spy: SpyFn;
	/**
	 * Configure data that fromS3 returns, keyed by `${bucket}/${key}`.
	 * Value should be a Buffer or string.
	 */
	files: Record<string, Buffer | string>;
}

// ─── Main mock control ────────────────────────────────────────────────────

export interface MockControl {
	/**
	 * Configure what events each queue returns when read.
	 * Key is queue name, value is array of payloads or ReadEvent objects.
	 *
	 * @example
	 * mock.queues["my-queue"] = [{ orderId: "123" }, { orderId: "456" }];
	 */
	queues: Record<string, any[]>;

	/**
	 * Access events that were written to each queue.
	 * Key is queue name (auto-populated as events flow through write streams).
	 * Returns `{ events: [], payloads: [] }` for queues that were never written to.
	 */
	written: Record<string, QueueWriteCapture>;

	/**
	 * Access checkpoint-related call records.
	 */
	checkpoints: MockCheckpointControl;

	/**
	 * Access bot/cron method call records.
	 */
	bot: MockBotControl;

	/**
	 * Override the stats returned by the read stream's `.get()` method.
	 * Set to null to use auto-computed stats.
	 */
	stats: Partial<Checkpoint> | null;

	/**
	 * Reset all mock state: queues config, written events, call records, stats.
	 */
	reset(): void;

	/**
	 * Access the spy on `fromLeo` / `read` calls.
	 * Useful to assert which bot/queue/config was used.
	 */
	readSpy: SpyFn;

	/**
	 * Access the spy on `toLeo` / `write` calls.
	 */
	writeSpy: SpyFn;

	/**
	 * Access the spy on `load` calls.
	 */
	loadSpy: SpyFn;

	/**
	 * Access S3 mock state: captured writes, file data for reads, and spies.
	 */
	s3: MockS3Control;
}

export type MockRStreamsSdk = RStreamsSdk & { mock: MockControl };

// ─── Options ───────────────────────────────────────────────────────────────

export interface MockRStreamsSdkOptions {
	/**
	 * If true, strip `useS3` from all write options passed to `enrich`, `offload`,
	 * `load`, and `toLeo`. This prevents any code path from attempting real S3
	 * operations during tests.
	 *
	 * @default true
	 */
	disableS3?: boolean;
}

// ─── Written proxy ─────────────────────────────────────────────────────────

const EMPTY_CAPTURE: QueueWriteCapture = Object.freeze({ events: [], payloads: [] });

/**
 * Returns a Proxy over the written record that returns { events: [], payloads: [] }
 * for queues that were never written to, avoiding TypeError on assertion.
 */
function createWrittenProxy(written: Record<string, QueueWriteCapture>): Record<string, QueueWriteCapture> {
	return new Proxy(written, {
		get(target, prop: string) {
			if (prop in target) {
				return target[prop];
			}
			// Return frozen empty capture for unwritten queues so
			// sdk.mock.written["q"].payloads.length doesn't throw
			return EMPTY_CAPTURE;
		},
	});
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Wraps an RStreamsSdk instance with test-friendly mocks.
 *
 * All real streaming utilities (through, throughAsync, pipeline, devnull, parse,
 * stringify, batch, etc.) are preserved. Only bus-connected operations (read/write
 * queues, checkpointing, bot/cron calls) are intercepted.
 *
 * NOTE: This function mutates `sdk.configuration.validate` to skip config
 * validation. This is necessary because enrich/offload close over the
 * configuration object. All other SDK state is left untouched.
 *
 * @param sdk An instance of RStreamsSdk (e.g., `new RStreamsSdk()`)
 * @param opts Options to control mock behavior
 * @returns A MockRStreamsSdk with all original capabilities plus a `.mock` control surface
 */
export function mockRStreamsSdk(sdk: RStreamsSdk, opts?: MockRStreamsSdkOptions): MockRStreamsSdk {
	const disableS3 = opts?.disableS3 !== false; // default true
	// ── State ──────────────────────────────────────────────────────────
	const state = createMockState();

	// ── Create mock streams object ────────────────────────────────────
	const realStreams = sdk.streams;
	const mockStreams = Object.create(realStreams);

	// Override fromLeo (read from queue)
	const readSpy = createSpy<typeof StreamUtil.fromLeo>(function (botId: string, inQueue: string, config?: ReadOptions<any>): ReadableQueueStream<any> {
		const queueData = state.queues[inQueue] || [];
		const eventIdFn = realStreams.eventIdFromTimestamp;
		return new MockReadStream(queueData, inQueue, eventIdFn, state.stats || undefined);
	});
	mockStreams.fromLeo = readSpy;

	// Override toLeo (write to queue)
	const writeSpy = createSpy<typeof StreamUtil.toLeo>(function (_botId: string, _config?: any): TransformStream<any, any> {
		const eventIdFn = realStreams.eventIdFromTimestamp;
		let recordCounter = 0;
		const now = Date.now();

		return realStreams.through((event: any, callback: Callback) => {
			if (!event || !event.event) {
				// Command events (e.g. __cmd: "checkpoint") have no queue — pass through silently.
				// These are internal SDK plumbing, not user events.
				return callback();
			}
			const queueName = event.event;
			if (!state.written[queueName]) {
				state.written[queueName] = { events: [], payloads: [] };
			}
			// Add eid if missing
			if (!event.eid) {
				event.eid = eventIdFn(now, "full", recordCounter++);
			}
			state.written[queueName].events.push(event);
			if (event.payload !== undefined) {
				state.written[queueName].payloads.push(event.payload);
			}
			callback();
		}) as any;
	});
	mockStreams.toLeo = writeSpy;

	// Override toCheckpoint
	mockStreams.toCheckpoint = (_config?: ToCheckpointOptions) => {
		state.checkpoints.toCheckpointCalls.push({ args: [_config], timestamp: Date.now() });
		return realStreams.devnull();
	};

	// Override load
	const loadSpy = createSpy<typeof StreamUtil.load>(function (_botId?: string, _outQueue?: string, _config?: WriteOptions): WritableStream<any> {
		const eventIdFn = realStreams.eventIdFromTimestamp;
		let recordCounter = 0;
		const now = Date.now();
		const defaultQueue = _outQueue;

		const writeStream = realStreams.through((event: any, callback: Callback) => {
			// Determine queue name from event or default
			let queueName = defaultQueue;
			if (event && event.event) {
				queueName = event.event;
			}
			if (!queueName) {
				return callback();
			}

			// Wrap raw payloads into Event shape
			let normalized = event;
			if (event && !event.event) {
				normalized = {
					id: _botId || "mock-bot",
					event: queueName,
					payload: event,
					timestamp: Date.now(),
				};
			}
			if (!normalized.eid) {
				normalized.eid = eventIdFn(now, "full", recordCounter++);
			}

			if (!state.written[queueName]) {
				state.written[queueName] = { events: [], payloads: [] };
			}
			state.written[queueName].events.push(normalized);
			if (normalized.payload !== undefined) {
				state.written[queueName].payloads.push(normalized.payload);
			}
			callback();
		});

		return writeStream as any;
	});
	mockStreams.load = loadSpy;

	// Override stats
	mockStreams.stats = (botId: string, queue: string, _opts?: any): StatsStream => {
		const passthrough = realStreams.through((data: any, callback: Callback) => {
			callback(null, data);
		}) as any as StatsStream;

		passthrough.get = () => {
			if (state.stats) {
				return state.stats as CheckpointData;
			}
			return {
				eid: realStreams.eventIdFromTimestamp(Date.now()),
				units: 0,
				source_timestamp: Date.now(),
			};
		};

		passthrough.checkpoint = createSpy((...args: any[]) => {
			state.checkpoints.calls.push({ args: [...args], timestamp: Date.now() });
			const cb = args[args.length - 1];
			if (typeof cb === "function") cb(null);
		});

		return passthrough;
	};

	// Override toS3 (capture written data)
	const s3State: MockS3Control = {
		written: {},
		files: {},
		toS3Spy: createSpy(),
		fromS3Spy: createSpy(),
	};

	const toS3Spy = createSpy(function (Bucket: string, File: string): stream.Writable {
		const key = `${Bucket}/${File}`;
		if (!s3State.written[key]) {
			s3State.written[key] = [];
		}
		return realStreams.write((data: any, callback: Callback) => {
			s3State.written[key].push(data);
			callback();
		}) as any;
	});
	s3State.toS3Spy = toS3Spy;
	mockStreams.toS3 = toS3Spy;

	// Override fromS3 (return configured data).
	// NOTE: The real S3 SDK fails asynchronously on the stream, but this mock
	// throws synchronously for missing keys. This is intentional for test clarity —
	// a missing key in tests is a test setup error, not an async condition.
	const fromS3Spy = createSpy(function (file: { bucket: string; key: string; range?: string }): stream.Readable {
		const key = `${file.bucket}/${file.key}`;
		const data = s3State.files[key];
		if (data == null) {
			const err = new Error("The specified key does not exist.") as any;
			err.code = "NoSuchKey";
			throw err;
		}
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		const readable = new Readable({
			read() {
				this.push(buf);
				this.push(null);
			},
		});
		return readable;
	});
	s3State.fromS3Spy = fromS3Spy;
	mockStreams.fromS3 = fromS3Spy;

	// ── Reimplemented enrich/offload ──────────────────────────────────
	//
	// The real enrich/offload in leo-stream.js reference a closed-over `ls`
	// variable, so Object.create overrides on mockStreams are invisible to
	// them. We reimplement the pipeline assembly here so it uses the mock's
	// fromLeo/toLeo/toCheckpoint.
	//
	// IMPORTANT: If the real enrich/offload pipeline assembly changes in
	// leo-stream.js, this reimplementation must be updated to match.
	// This is a known trade-off — the alternative (patching the closed-over
	// `ls` directly) would require mutating the original SDK's streams.

	mockStreams.enrich = function (opts: any, callback: Callback) {
		const id = opts.id;
		const inQueue = opts.inQueue;
		const outQueue = opts.outQueue;
		const func = opts.transform || opts.each;
		const config = opts.config || {};
		config.start = config.start || opts.start;
		config.debug = opts.debug;

		const args: any[] = [];
		args.push(mockStreams.fromLeo(id, inQueue, config));

		if (opts.batch) {
			args.push(realStreams.batch(opts.batch));
		}

		args.push(realStreams.process(id, func, outQueue));
		args.push(mockStreams.toLeo(id, opts));
		args.push(mockStreams.toCheckpoint({
			debug: opts.debug,
			force: opts.force,
			onCheckpoint: opts.onCheckpoint,
		}));
		args.push(callback);
		return realStreams.pipe.apply(realStreams, args);
	};

	mockStreams.offload = function (opts: any, callback: Callback) {
		const id = opts.id;
		const inQueue = opts.inQueue || opts.queue;
		const func = opts.each || opts.transform;
		let batchConfig: any = { size: 1, map: (payload: any, meta: any, done: any) => done(null, payload) };

		// Normalize top-level batch shorthand options (matches real offload behavior)
		if (typeof opts.size != "object" && (opts.count || opts.records || opts.units || opts.time || opts.bytes)) {
			const size = {} as any;
			size.count = opts.count || opts.records || opts.units;
			size.time = opts.time;
			size.bytes = opts.size || opts.bytes;
			size.highWaterMark = opts.highWaterMark || 2;
			opts.size = size;
		}

		if (!opts.batch || typeof opts.batch === "number") {
			batchConfig.size = opts.batch || batchConfig.size;
		} else {
			batchConfig.size = opts.batch.size || ((opts.batch.count || opts.batch.bytes || opts.batch.time || opts.batch.highWaterMark) && opts.batch) || batchConfig.size;
			batchConfig.map = opts.batch.map || batchConfig.map;
		}
		if (typeof batchConfig.size !== "object") {
			batchConfig.size = { count: batchConfig.size };
		}
		batchConfig.size.highWaterMark = batchConfig.size.highWaterMark || 2;

		const batchSize = typeof batchConfig.size === "number" ? batchConfig.size : (batchConfig.size.count || batchConfig.size.records);

		return realStreams.pipe(
			mockStreams.fromLeo(id, inQueue, opts),
			realStreams.through((obj: any, done: any) => {
				batchConfig.map(obj.payload, obj, (err: any, r: any) => {
					if (err || !r) {
						done(err);
					} else {
						obj.payload = r;
						done(null, obj);
					}
				});
			}),
			realStreams.batch(batchConfig.size),
			realStreams.through({ highWaterMark: 1 }, (batch: any, done: any) => {
				batch.units = batch.payload.length;
				const last = batch.payload[batch.units - 1];
				if (batchSize == 1) {
					done(null, last);
				} else {
					batch.event_source_timestamp = last.event_source_timestamp;
					batch.event = last.event;
					batch.eid = last.eid;
					done(null, batch);
				}
			}),
			realStreams.process(id, func, null, undefined, { highWaterMark: 1 }),
			mockStreams.toCheckpoint({
				debug: opts.debug,
				force: opts.force,
				onCheckpoint: opts.onCheckpoint,
			}),
			callback
		);
	};

	// Override cron on the streams object
	const botSpies = createBotSpies(state);
	mockStreams.cron = botSpies.cron;

	// ── Create the mock SDK ───────────────────────────────────────────
	const mockSdk = Object.create(sdk) as MockRStreamsSdk;
	mockSdk.streams = mockStreams;

	// Skip configuration validation in tests.
	// NOTE: This mutates the original sdk.configuration object. This is
	// necessary because enrich/offload in leo-stream.js close over the
	// configure object passed at factory time — the same object reference
	// as sdk.configuration. There is no way to intercept the validate()
	// call without patching this object directly.
	const origValidate = sdk.configuration && (sdk.configuration as any).validate;
	if (sdk.configuration) {
		(sdk.configuration as any).validate = () => true;
	}

	// Override top-level aliases
	mockSdk.read = mockStreams.fromLeo.bind(mockStreams);
	mockSdk.write = mockStreams.toLeo.bind(mockStreams);
	mockSdk.checkpoint = mockStreams.toCheckpoint.bind(mockStreams);
	mockSdk.load = mockStreams.load.bind(mockStreams);
	mockSdk.throughAsync = realStreams.throughAsync?.bind(realStreams);

	// Override bot
	mockSdk.bot = botSpies.cron;

	// Wrap enrich/offload with disableS3 stripping if enabled
	const wrappedEnrich = disableS3
		? (enrichOpts: any, callback: Callback) => {
			delete enrichOpts.useS3;
			return mockStreams.enrich(enrichOpts, callback);
		}
		: mockStreams.enrich;
	mockSdk.enrich = wrappedEnrich;
	mockSdk.enrichEvents = promisify(wrappedEnrich) as any;

	const wrappedOffload = disableS3
		? (offloadOpts: any, callback: Callback) => {
			delete offloadOpts.useS3;
			return mockStreams.offload(offloadOpts, callback);
		}
		: mockStreams.offload;
	mockSdk.offload = wrappedOffload;
	mockSdk.offloadEvents = promisify(wrappedOffload) as any;

	// Override put/putEvent/putEvents to route through mock load
	mockSdk.put = <T>(botId: string, outQueue: string, payload: Event<T> | T, callback: Callback) => {
		try {
			const event: Event<T> = isEvent(payload)
				? payload
				: { id: botId, event: outQueue, payload: payload as T } as Event<T>;

			if (!state.written[outQueue]) {
				state.written[outQueue] = { events: [], payloads: [] };
			}
			state.written[outQueue].events.push(event);
			if (event.payload !== undefined) {
				state.written[outQueue].payloads.push(event.payload);
			}
			callback(null);
		} catch (err) {
			callback(err);
		}
	};

	mockSdk.putEvent = <T>(botId: string, outQueue: string, payload: Event<T> | T): Promise<void> => {
		return new Promise((resolve, reject) => {
			mockSdk.put(botId, outQueue, payload, (err: any) => {
				if (err) reject(err); else resolve();
			});
		});
	};

	mockSdk.putEvents = <T>(payloads: (Event<T> | T)[], settings?: { botId?: string; queue?: string; writeOptions?: WriteOptions }): Promise<void> => {
		const botId = settings?.botId || "mock-bot";
		const queue = settings?.queue || "unknown-queue";
		return Promise.all(payloads.map(p => mockSdk.putEvent(botId, queue, p))).then(() => { });
	};

	// ── Attach mock control surface ───────────────────────────────────
	const writtenProxy = createWrittenProxy(state.written);

	const mockControl: MockControl = Object.create(null);
	Object.defineProperties(mockControl, {
		queues: { value: state.queues, writable: true },
		written: { value: writtenProxy },
		checkpoints: { value: state.checkpoints },
		bot: { value: botSpies.control },
		readSpy: { value: readSpy },
		writeSpy: { value: writeSpy },
		loadSpy: { value: loadSpy },
		s3: { value: s3State },
		stats: {
			get() { return state.stats; },
			set(v: Partial<Checkpoint> | null) { state.stats = v; },
			enumerable: true,
		},
		reset: {
			value() {
				// Clear queues config
				for (const key of Object.keys(state.queues)) {
					delete state.queues[key];
				}
				// Clear written
				for (const key of Object.keys(state.written)) {
					delete state.written[key];
				}
				// Clear checkpoint records
				state.checkpoints.calls.length = 0;
				state.checkpoints.toCheckpointCalls.length = 0;
				// Reset bot spies
				botSpies.control.checkLock.reset();
				botSpies.control.reportComplete.reset();
				botSpies.control.createLock.reset();
				botSpies.control.removeLock.reset();
				botSpies.control.checkpoint.reset();
				botSpies.control.getCheckpoint.reset();
				botSpies.control.getCheckpoint.returnValue = {};
				// Reset operation spies
				readSpy.reset();
				writeSpy.reset();
				loadSpy.reset();
				// Clear S3 state
				for (const key of Object.keys(s3State.written)) {
					delete s3State.written[key];
				}
				for (const key of Object.keys(s3State.files)) {
					delete s3State.files[key];
				}
				s3State.toS3Spy.reset();
				s3State.fromS3Spy.reset();
				// Clear stats override
				state.stats = null;
			},
		},
	});
	mockSdk.mock = mockControl;

	return mockSdk;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function createMockState() {
	return {
		queues: {} as Record<string, any[]>,
		written: {} as Record<string, QueueWriteCapture>,
		checkpoints: {
			calls: [] as SpyCall[],
			toCheckpointCalls: [] as SpyCall[],
		},
		stats: null as Partial<Checkpoint> | null,
	};
}

function createBotSpies(state: ReturnType<typeof createMockState>) {
	const checkLockSpy = createSpy();
	const reportCompleteSpy = createSpy();
	const createLockSpy = createSpy();
	const removeLockSpy = createSpy();

	const checkpointSpy = createSpy((...args: any[]) => {
		state.checkpoints.calls.push({ args: [...args], timestamp: Date.now() });
		const cb = args[args.length - 1];
		if (typeof cb === "function") cb(null);
	});

	const getCheckpointReturnValue: Record<string, any> = {};
	const getCheckpointSpy = createSpy(async (botId?: string, queue?: string) => {
		if (queue && getCheckpointReturnValue[queue]) {
			return getCheckpointReturnValue[queue];
		}
		return undefined;
	}) as SpyFn & { returnValue: Record<string, any> };
	getCheckpointSpy.returnValue = getCheckpointReturnValue;

	const cron: LeoCron = {
		checkLock: checkLockSpy as any,
		reportComplete: reportCompleteSpy as any,
		createLock: createLockSpy as any,
		removeLock: removeLockSpy as any,
		checkpoint: checkpointSpy as any,
		getCheckpoint: getCheckpointSpy as any,
		trigger: createSpy() as any,
		schedule: createSpy(async () => { }) as any,
		update: createSpy() as any,
		subscribe: createSpy() as any,
		runAgain: createSpy() as any,
		getLastResult: createSpy() as any,
		setMessage: createSpy() as any,
		getAttachedSystemByAlias: createSpy() as any,
		getAttachedSystem: createSpy() as any,
		get: createSpy() as any,
		buildPayloads: createSpy() as any,
		shouldRun: createSpy() as any,
		hasMoreToDo: createSpy() as any,
		start: createSpy() as any,
		end: createSpy() as any,
		run: createSpy() as any,
		createBot: createSpy() as any,
	};

	const control: MockBotControl = {
		checkLock: checkLockSpy,
		reportComplete: reportCompleteSpy,
		createLock: createLockSpy,
		removeLock: removeLockSpy,
		checkpoint: checkpointSpy,
		getCheckpoint: getCheckpointSpy,
	};

	return { cron, control };
}

function isEvent<T>(val: any): val is Event<T> {
	return val != null && typeof val === "object" && "id" in val && "event" in val;
}

// ─── Test helpers ──────────────────────────────────────────────────────────

export interface CreateContextOptions {
	/** Lambda timeout in seconds. Defaults to 300 (5 minutes). */
	Timeout?: number;
}

/**
 * Creates a fake Lambda Context object suitable for calling bot handlers in tests.
 * Provides `awsRequestId` and a working `getRemainingTimeInMillis()`.
 *
 * @param config Optional configuration. `Timeout` is in seconds (default 300).
 * @returns A partial Lambda Context object
 */
export function createContext(config?: CreateContextOptions) {
	const start = Date.now();
	const maxTime = (config?.Timeout ?? 300) * 1000;
	return {
		awsRequestId: "requestid-mock-" + Date.now().toString(),
		functionName: "mock-function",
		functionVersion: "$LATEST",
		invokedFunctionArn: "arn:aws:lambda:us-east-1:000000000000:function:mock-function",
		memoryLimitInMB: "256",
		logGroupName: "/aws/lambda/mock-function",
		logStreamName: "mock-log-stream",
		getRemainingTimeInMillis: () => {
			const elapsed = Date.now() - start;
			return elapsed < maxTime ? maxTime - elapsed : 0;
		},
		callbackWaitsForEmptyEventLoop: true,
		done: () => { },
		fail: () => { },
		succeed: () => { },
	};
}

/**
 * Creates a fake BotInvocationEvent suitable for calling bot handlers in tests.
 * Sets up `__cron` with `force: true` and `ignoreLock: true` so the handler
 * skips lock checks.
 *
 * @param botId The bot ID to use
 * @param settings Additional settings to merge into the event (e.g., queue, botNumber)
 * @returns A BotInvocationEvent-compatible object
 */
export function createBotInvocationEvent<T extends Record<string, any> = {}>(
	botId: string,
	settings?: T
): BotInvocationEvent & T {
	return {
		...settings,
		botId,
		__cron: {
			id: botId,
			iid: "0",
			name: botId,
			ts: Date.now(),
			force: true,
			ignoreLock: true,
		},
	} as BotInvocationEvent & T;
}

export default mockRStreamsSdk;
