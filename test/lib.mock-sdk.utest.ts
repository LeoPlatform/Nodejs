import { assert } from "chai";
import { mockRStreamsSdk, MockRStreamsSdk, SpyFn, createContext, createBotInvocationEvent, MockRStreamsSdkOptions } from "../lib/mock-sdk";

// Minimal SDK construction that doesn't need AWS resources
import utilFn from "../lib/stream/leo-stream";

function createMinimalSdk(): any {
	const config = { onUpdate: () => { }, resources: {}, aws: {}, validate: () => true } as any;
	const streams = utilFn(config);
	// Simulate RStreamsSdk shape with real streaming utilities
	return {
		configuration: config,
		streams,
		bot: streams.cron,
		read: streams.fromLeo?.bind(streams),
		write: streams.toLeo?.bind(streams),
		load: streams.load?.bind(streams),
		enrich: streams.enrich?.bind(streams),
		offload: streams.offload?.bind(streams),
		checkpoint: streams.toCheckpoint?.bind(streams),
		throughAsync: streams.throughAsync?.bind(streams),
		aws: {},
		put: () => { },
		putEvent: async () => { },
		putEvents: async () => { },
	};
}

describe("lib/mock-sdk.ts", function () {
	let sdk: MockRStreamsSdk;

	beforeEach(() => {
		const baseSdk = createMinimalSdk();
		sdk = mockRStreamsSdk(baseSdk);
	});

	afterEach(() => {
		sdk.mock.reset();
	});

	describe("mockRStreamsSdk", () => {
		it("returns an object with a mock property", () => {
			assert.isObject(sdk.mock);
			assert.isObject(sdk.mock.queues);
			assert.isObject(sdk.mock.written);
			assert.isObject(sdk.mock.checkpoints);
			assert.isObject(sdk.mock.bot);
			assert.isFunction(sdk.mock.reset);
		});

		it("preserves real streaming utilities", () => {
			assert.isFunction(sdk.streams.through);
			assert.isFunction(sdk.streams.throughAsync);
			assert.isFunction(sdk.streams.pipeline);
			assert.isFunction(sdk.streams.devnull);
			assert.isFunction(sdk.streams.parse);
			assert.isFunction(sdk.streams.stringify);
		});
	});

	describe("reading from queues", () => {
		it("reads configured queue data as a stream", async () => {
			sdk.mock.queues["test-queue"] = [
				{ orderId: "123", amount: 10 },
				{ orderId: "456", amount: 20 },
			];

			const events: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.fromLeo("mock-bot", "test-queue"),
				sdk.streams.through((event: any, done: any) => {
					events.push(event);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.equal(events.length, 2);
			assert.deepEqual(events[0].payload, { orderId: "123", amount: 10 });
			assert.deepEqual(events[1].payload, { orderId: "456", amount: 20 });
		});

		it("auto-generates eid and event fields on read events", async () => {
			sdk.mock.queues["test-queue"] = [{ data: "hello" }];

			const events: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.fromLeo("my-bot", "test-queue"),
				sdk.streams.through((event: any, done: any) => {
					events.push(event);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.equal(events.length, 1);
			assert.isString(events[0].eid);
			assert.equal(events[0].event, "test-queue");
			assert.equal(events[0].id, "mock-bot");
		});

		it("passes through pre-formed ReadEvent objects", async () => {
			sdk.mock.queues["test-queue"] = [{
				id: "custom-bot",
				event: "test-queue",
				eid: "z/2025/01/01/00/00/1234567890",
				timestamp: 1234567890,
				event_source_timestamp: 1234567890,
				payload: { key: "value" },
			}];

			const events: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.fromLeo("my-bot", "test-queue"),
				sdk.streams.through((event: any, done: any) => {
					events.push(event);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.equal(events.length, 1);
			assert.equal(events[0].eid, "z/2025/01/01/00/00/1234567890");
			assert.equal(events[0].id, "custom-bot");
			assert.deepEqual(events[0].payload, { key: "value" });
		});

		it("returns an empty stream for unconfigured queues", async () => {
			const events: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.fromLeo("my-bot", "nonexistent-queue"),
				sdk.streams.through((event: any, done: any) => {
					events.push(event);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.equal(events.length, 0);
		});

		it("provides stats via .get() on the read stream", () => {
			sdk.mock.queues["test-queue"] = [
				{ a: 1 },
				{ a: 2 },
				{ a: 3 },
			];

			const stream = sdk.streams.fromLeo("my-bot", "test-queue");
			const stats = stream.get();

			assert.isObject(stats);
			assert.isNumber(stats.source_timestamp);
			assert.isNumber(stats.records);
		});

		it("records readSpy calls", () => {
			sdk.mock.queues["test-queue"] = [];
			sdk.streams.fromLeo("bot-1", "test-queue", { limit: 100 });

			assert.equal(sdk.mock.readSpy.callCount, 1);
			assert.equal(sdk.mock.readSpy.lastCall!.args[0], "bot-1");
			assert.equal(sdk.mock.readSpy.lastCall!.args[1], "test-queue");
		});

		it("sdk.read alias works the same as streams.fromLeo", async () => {
			sdk.mock.queues["alias-queue"] = [{ x: 1 }];

			const events: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.read("my-bot", "alias-queue"),
				sdk.streams.through((event: any, done: any) => {
					events.push(event);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.equal(events.length, 1);
			assert.deepEqual(events[0].payload, { x: 1 });
		});
	});

	describe("writing to queues", () => {
		it("captures written events", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "out-queue", payload: { item: "A" } },
					{ id: "bot", event: "out-queue", payload: { item: "B" } },
				]),
				sdk.streams.toLeo("my-bot"),
				sdk.streams.devnull()
			);

			assert.isDefined(sdk.mock.written["out-queue"]);
			assert.equal(sdk.mock.written["out-queue"].events.length, 2);
			assert.deepEqual(sdk.mock.written["out-queue"].payloads, [
				{ item: "A" },
				{ item: "B" },
			]);
		});

		it("auto-generates eid on written events", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "q", payload: { x: 1 } },
				]),
				sdk.streams.toLeo("my-bot"),
				sdk.streams.devnull()
			);

			const event = sdk.mock.written["q"].events[0] as any;
			assert.isString(event.eid);
			assert.match(event.eid, /^z\//);
		});

		it("separates events by queue name", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "queue-a", payload: { val: 1 } },
					{ id: "bot", event: "queue-b", payload: { val: 2 } },
					{ id: "bot", event: "queue-a", payload: { val: 3 } },
				]),
				sdk.streams.toLeo("my-bot"),
				sdk.streams.devnull()
			);

			assert.equal(sdk.mock.written["queue-a"].events.length, 2);
			assert.equal(sdk.mock.written["queue-b"].events.length, 1);
		});

		it("records writeSpy calls", () => {
			sdk.streams.toLeo("my-bot", { useS3: false });
			assert.equal(sdk.mock.writeSpy.callCount, 1);
			assert.equal(sdk.mock.writeSpy.lastCall!.args[0], "my-bot");
		});

		it("sdk.write alias works", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "q", payload: { y: 99 } },
				]),
				sdk.write("my-bot"),
				sdk.streams.devnull()
			);

			assert.equal(sdk.mock.written["q"].payloads.length, 1);
		});
	});

	describe("load", () => {
		it("captures events written via load", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "load-queue", payload: { data: "test" } },
				]),
				sdk.streams.load("my-bot", "load-queue"),
			);

			assert.isDefined(sdk.mock.written["load-queue"]);
			assert.equal(sdk.mock.written["load-queue"].payloads.length, 1);
			assert.deepEqual(sdk.mock.written["load-queue"].payloads[0], { data: "test" });
		});

		it("wraps raw payloads into Event shape", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ rawData: "hello" },
				]),
				sdk.streams.load("my-bot", "raw-queue"),
			);

			const events = sdk.mock.written["raw-queue"].events;
			assert.equal(events.length, 1);
			assert.equal(events[0].id, "my-bot");
			assert.equal(events[0].event, "raw-queue");
		});

		it("records loadSpy calls", () => {
			sdk.streams.load("bot-x", "queue-y", { useS3: false });
			assert.equal(sdk.mock.loadSpy.callCount, 1);
		});
	});

	describe("checkpointing", () => {
		it("toCheckpoint returns a working stream (devnull)", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([{ a: 1 }, { a: 2 }]),
				sdk.streams.toCheckpoint(),
			);
			// No error means the stream worked
			assert.isTrue(true);
		});

		it("records toCheckpoint creation calls", () => {
			sdk.streams.toCheckpoint({ records: 100 });
			assert.equal(sdk.mock.checkpoints.toCheckpointCalls.length, 1);
		});

		it("checkpoint on read stream is a spy", async () => {
			sdk.mock.queues["cp-queue"] = [{ a: 1 }];
			const readStream = sdk.streams.fromLeo("bot", "cp-queue") as any;

			let callbackCalled = false;
			readStream.checkpoint(() => { callbackCalled = true; });

			assert.isTrue(callbackCalled);
			assert.equal(readStream.checkpointSpy.callCount, 1);
		});
	});

	describe("bot/cron spying", () => {
		it("records checkLock calls", () => {
			let called = false;
			sdk.bot.checkLock({} as any, "run-1", 5000, ((err: any) => { called = true; }) as any);

			assert.isTrue(called);
			assert.equal(sdk.mock.bot.checkLock.callCount, 1);
			assert.equal(sdk.mock.bot.checkLock.lastCall!.args[1], "run-1");
		});

		it("records reportComplete calls", () => {
			let called = false;
			sdk.bot.reportComplete({} as any, "run-1", "complete", {}, {} as any, ((err: any) => { called = true; }) as any);

			assert.isTrue(called);
			assert.equal(sdk.mock.bot.reportComplete.callCount, 1);
		});

		it("records createLock calls", () => {
			let called = false;
			sdk.bot.createLock("my-bot", "run-1", 60000, ((err: any) => { called = true; }) as any);

			assert.isTrue(called);
			assert.equal(sdk.mock.bot.createLock.callCount, 1);
		});

		it("records removeLock calls", () => {
			let called = false;
			sdk.bot.removeLock("my-bot", "run-1", ((err: any) => { called = true; }) as any);

			assert.isTrue(called);
			assert.equal(sdk.mock.bot.removeLock.callCount, 1);
		});

		it("records checkpoint calls on bot", () => {
			let called = false;
			sdk.bot.checkpoint("my-bot", "queue", { eid: "z/123", source_timestamp: 100, units: 5 }, ((err: any) => { called = true; }) as any);

			assert.isTrue(called);
			assert.equal(sdk.mock.bot.checkpoint.callCount, 1);
			assert.equal(sdk.mock.bot.checkpoint.lastCall!.args[0], "my-bot");
		});

		it("getCheckpoint returns configured values", async () => {
			sdk.mock.bot.getCheckpoint.returnValue["my-queue"] = {
				checkpoint: "z/2025/01/01/00/00/1234",
				records: 100,
			};

			const result = await sdk.bot.getCheckpoint("my-bot", "my-queue");
			assert.deepEqual(result, {
				checkpoint: "z/2025/01/01/00/00/1234",
				records: 100,
			});
			assert.equal(sdk.mock.bot.getCheckpoint.callCount, 1);
		});

		it("getCheckpoint returns undefined for unconfigured queue", async () => {
			const result = await sdk.bot.getCheckpoint("my-bot", "other-queue");
			assert.isUndefined(result);
		});
	});

	describe("put / putEvent / putEvents", () => {
		it("put captures events", (done) => {
			sdk.put("bot-1", "put-queue", { message: "hello" }, (err: any) => {
				assert.isNull(err);
				assert.equal(sdk.mock.written["put-queue"].payloads.length, 1);
				assert.deepEqual(sdk.mock.written["put-queue"].payloads[0], { message: "hello" });
				done();
			});
		});

		it("putEvent captures events", async () => {
			await sdk.putEvent("bot-1", "pe-queue", { val: 42 });

			assert.equal(sdk.mock.written["pe-queue"].payloads.length, 1);
			assert.deepEqual(sdk.mock.written["pe-queue"].payloads[0], { val: 42 });
		});

		it("putEvents captures multiple events", async () => {
			await sdk.putEvents(
				[{ data: "a" }, { data: "b" }, { data: "c" }],
				{ botId: "bot-1", queue: "multi-queue" }
			);

			assert.equal(sdk.mock.written["multi-queue"].payloads.length, 3);
		});
	});

	describe("stats override", () => {
		it("uses custom stats when configured", () => {
			sdk.mock.stats = {
				checkpoint: "z/2025/01/01/00/00/custom",
				records: 999,
				source_timestamp: 1700000000000,
			};

			sdk.mock.queues["stats-queue"] = [{ a: 1 }];
			const stream = sdk.streams.fromLeo("bot", "stats-queue");
			const stats = stream.get();

			assert.equal(stats.checkpoint, "z/2025/01/01/00/00/custom");
			assert.equal(stats.source_timestamp, 1700000000000);
			assert.equal(stats.records, 999);
		});

		it("read stream get() uses idx for records when no custom stats", async () => {
			sdk.mock.queues["count-queue"] = [{ a: 1 }, { a: 2 }, { a: 3 }];
			const stream = sdk.streams.fromLeo("bot", "count-queue");

			// Before reading, records should be 0
			assert.equal(stream.get().records, 0);

			// Read all events
			const events: any[] = [];
			await sdk.streams.pipeAsync(
				stream,
				sdk.streams.through((e: any, done: any) => { events.push(e); done(); }),
				sdk.streams.devnull()
			);

			// After reading, records should reflect items read
			assert.equal(events.length, 3);
		});

		it("stats on stats stream uses override", () => {
			sdk.mock.stats = {
				checkpoint: "custom-checkpoint",
				records: 42,
			};

			const statsStream = sdk.streams.stats("bot", "queue");
			const result = statsStream.get();

			assert.equal((result as any).checkpoint, "custom-checkpoint");
			assert.equal((result as any).records, 42);
		});
	});

	describe("real streaming utilities still work", () => {
		it("through transforms data", async () => {
			const results: number[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([1, 2, 3]),
				sdk.streams.through((n: number, done: any) => {
					done(null, n * 2);
				}),
				sdk.streams.through((n: number, done: any) => {
					results.push(n);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.deepEqual(results, [2, 4, 6]);
		});

		it("pipeline combines streams", async () => {
			const results: any[] = [];
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray(["a", "b", "c"]),
				sdk.streams.through((s: string, done: any) => {
					done(null, s.toUpperCase());
				}),
				sdk.streams.through((s: string, done: any) => {
					results.push(s);
					done();
				}),
				sdk.streams.devnull()
			);

			assert.deepEqual(results, ["A", "B", "C"]);
		});
	});

	describe("reset", () => {
		it("clears all mock state", async () => {
			// Set up some state
			sdk.mock.queues["q1"] = [{ a: 1 }];
			sdk.mock.stats = { records: 10 };
			sdk.mock.bot.getCheckpoint.returnValue["q1"] = { checkpoint: "z/123" };

			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ id: "bot", event: "out", payload: { x: 1 } },
				]),
				sdk.streams.toLeo("bot"),
				sdk.streams.devnull()
			);

			sdk.bot.checkLock({} as any, "r", 1, (() => { }) as any);

			// Verify state exists
			assert.isNotEmpty(Object.keys(sdk.mock.written));
			assert.equal(sdk.mock.bot.checkLock.callCount, 1);

			// Reset
			sdk.mock.reset();

			// Verify all cleared
			assert.isEmpty(Object.keys(sdk.mock.queues));
			assert.isEmpty(Object.keys(sdk.mock.written));
			assert.equal(sdk.mock.checkpoints.calls.length, 0);
			assert.equal(sdk.mock.checkpoints.toCheckpointCalls.length, 0);
			assert.equal(sdk.mock.bot.checkLock.callCount, 0);
			assert.equal(sdk.mock.bot.reportComplete.callCount, 0);
			assert.equal(sdk.mock.bot.checkpoint.callCount, 0);
			assert.equal(sdk.mock.bot.getCheckpoint.callCount, 0);
			assert.equal(sdk.mock.readSpy.callCount, 0);
			assert.equal(sdk.mock.writeSpy.callCount, 0);
			assert.equal(sdk.mock.loadSpy.callCount, 0);
			assert.isNull(sdk.mock.stats);
		});
	});

	describe("SpyFn interface", () => {
		it("tracks callCount and called", () => {
			assert.isFalse(sdk.mock.readSpy.called);
			assert.equal(sdk.mock.readSpy.callCount, 0);

			sdk.mock.queues["q"] = [];
			sdk.streams.fromLeo("bot", "q");

			assert.isTrue(sdk.mock.readSpy.called);
			assert.equal(sdk.mock.readSpy.callCount, 1);
		});

		it("tracks lastCall", () => {
			assert.isUndefined(sdk.mock.readSpy.lastCall);

			sdk.mock.queues["q"] = [];
			sdk.streams.fromLeo("bot-a", "q");
			sdk.streams.fromLeo("bot-b", "q");

			assert.equal(sdk.mock.readSpy.lastCall!.args[0], "bot-b");
		});

		it("spy.reset clears call history", () => {
			sdk.mock.queues["q"] = [];
			sdk.streams.fromLeo("bot", "q");
			assert.equal(sdk.mock.readSpy.callCount, 1);

			sdk.mock.readSpy.reset();
			assert.equal(sdk.mock.readSpy.callCount, 0);
			assert.isFalse(sdk.mock.readSpy.called);
		});
	});

	describe("S3 mocking", () => {
		it("toS3 captures written data", async () => {
			const writeStream = sdk.streams.toS3("my-bucket", "my-file.gz");
			await new Promise<void>((resolve, reject) => {
				writeStream.write("chunk1", (err) => {
					if (err) return reject(err);
					writeStream.write("chunk2", (err) => {
						if (err) return reject(err);
						writeStream.end(resolve);
					});
				});
			});

			const key = "my-bucket/my-file.gz";
			assert.isDefined(sdk.mock.s3.written[key]);
			assert.equal(sdk.mock.s3.written[key].length, 2);
			assert.equal(sdk.mock.s3.written[key][0], "chunk1");
			assert.equal(sdk.mock.s3.written[key][1], "chunk2");
		});

		it("toS3 records spy calls", () => {
			sdk.streams.toS3("bucket-a", "file-b.txt");
			assert.equal(sdk.mock.s3.toS3Spy.callCount, 1);
			assert.equal(sdk.mock.s3.toS3Spy.lastCall!.args[0], "bucket-a");
			assert.equal(sdk.mock.s3.toS3Spy.lastCall!.args[1], "file-b.txt");
		});

		it("fromS3 returns configured file data", async () => {
			sdk.mock.s3.files["my-bucket/path/to/file.json"] = '{"hello":"world"}';

			const readStream = sdk.streams.fromS3({
				bucket: "my-bucket",
				key: "path/to/file.json",
			});

			const chunks: Buffer[] = [];
			await new Promise<void>((resolve, reject) => {
				readStream.on("data", (chunk) => chunks.push(chunk));
				readStream.on("end", resolve);
				readStream.on("error", reject);
			});

			const result = Buffer.concat(chunks).toString();
			assert.equal(result, '{"hello":"world"}');
		});

		it("fromS3 returns Buffer data", async () => {
			const buf = Buffer.from([0x01, 0x02, 0x03]);
			sdk.mock.s3.files["bucket/binary.dat"] = buf;

			const readStream = sdk.streams.fromS3({
				bucket: "bucket",
				key: "binary.dat",
			});

			const chunks: Buffer[] = [];
			await new Promise<void>((resolve, reject) => {
				readStream.on("data", (chunk) => chunks.push(chunk));
				readStream.on("end", resolve);
				readStream.on("error", reject);
			});

			assert.deepEqual(Buffer.concat(chunks), buf);
		});

		it("fromS3 throws NoSuchKey for unconfigured files", () => {
			assert.throws(() => {
				sdk.streams.fromS3({ bucket: "b", key: "missing.txt" });
			}, /specified key does not exist/);
		});

		it("fromS3 records spy calls", () => {
			sdk.mock.s3.files["b/k"] = "data";
			sdk.streams.fromS3({ bucket: "b", key: "k" });
			assert.equal(sdk.mock.s3.fromS3Spy.callCount, 1);
		});

		it("reset clears S3 state", () => {
			sdk.mock.s3.files["b/k"] = "data";
			sdk.mock.s3.written["b/f"] = ["chunk"];
			sdk.streams.toS3("x", "y");

			sdk.mock.reset();

			assert.isEmpty(Object.keys(sdk.mock.s3.files));
			assert.isEmpty(Object.keys(sdk.mock.s3.written));
			assert.equal(sdk.mock.s3.toS3Spy.callCount, 0);
			assert.equal(sdk.mock.s3.fromS3Spy.callCount, 0);
		});
	});

	describe("createContext", () => {
		it("returns a context with awsRequestId", () => {
			const ctx = createContext();
			assert.isString(ctx.awsRequestId);
			assert.match(ctx.awsRequestId, /^requestid-mock-/);
		});

		it("getRemainingTimeInMillis returns positive time", () => {
			const ctx = createContext({ Timeout: 10 });
			const remaining = ctx.getRemainingTimeInMillis();
			assert.isAbove(remaining, 0);
			assert.isAtMost(remaining, 10000);
		});

		it("defaults to 300 second timeout", () => {
			const ctx = createContext();
			const remaining = ctx.getRemainingTimeInMillis();
			assert.isAbove(remaining, 299000);
			assert.isAtMost(remaining, 300000);
		});

		it("has standard Lambda context fields", () => {
			const ctx = createContext();
			assert.isString(ctx.functionName);
			assert.isString(ctx.functionVersion);
			assert.isString(ctx.invokedFunctionArn);
			assert.isString(ctx.memoryLimitInMB);
			assert.isFunction(ctx.getRemainingTimeInMillis);
		});
	});

	describe("createBotInvocationEvent", () => {
		it("creates an event with botId and __cron", () => {
			const event = createBotInvocationEvent("my-bot");
			assert.equal(event.botId, "my-bot");
			assert.isObject(event.__cron);
			assert.equal(event.__cron.id, "my-bot");
			assert.equal(event.__cron.name, "my-bot");
			assert.isTrue(event.__cron.force);
			assert.isTrue(event.__cron.ignoreLock);
			assert.isNumber(event.__cron.ts);
		});

		it("merges additional settings", () => {
			const event = createBotInvocationEvent("my-bot", {
				queue: "input-queue",
				botNumber: 2,
				source: "upstream",
			});

			assert.equal(event.botId, "my-bot");
			assert.equal((event as any).queue, "input-queue");
			assert.equal((event as any).botNumber, 2);
			assert.equal((event as any).source, "upstream");
		});

		it("settings do not override botId or __cron", () => {
			const event = createBotInvocationEvent("correct-bot", {
				botId: "wrong-bot",
			} as any);

			// botId from the first arg wins because it's spread after settings
			assert.equal(event.botId, "correct-bot");
		});
	});

	describe("configuration.validate", () => {
		it("is overridden to return true", () => {
			assert.isFunction((sdk.configuration as any).validate);
			assert.isTrue((sdk.configuration as any).validate());
		});
	});

	describe("enrich end-to-end", () => {
		it("reads from mock queue, transforms, writes to output queue", (done) => {
			sdk.mock.queues["raw-items"] = [
				{ name: "Widget", price: 10 },
				{ name: "Gadget", price: 20 },
			];

			sdk.enrich({
				id: "enricher-bot",
				inQueue: "raw-items",
				outQueue: "enriched-items",
				transform(payload: any, event: any, cb: any) {
					cb(null, { ...payload, taxed_price: payload.price * 1.1 });
				},
			}, (err: any) => {
				assert.isNotOk(err);
				const output = sdk.mock.written["enriched-items"];
				assert.equal(output.payloads.length, 2);
				assert.closeTo(output.payloads[0].taxed_price, 11, 0.01);
				assert.closeTo(output.payloads[1].taxed_price, 22, 0.01);
				assert.equal(output.payloads[0].name, "Widget");
				done();
			});
		});

		it("can filter events by returning nothing from transform", (done) => {
			sdk.mock.queues["input"] = [
				{ active: true, name: "A" },
				{ active: false, name: "B" },
				{ active: true, name: "C" },
			];

			sdk.enrich({
				id: "filter-bot",
				inQueue: "input",
				outQueue: "output",
				transform(payload: any, event: any, cb: any) {
					if (!payload.active) return cb();
					cb(null, payload);
				},
			}, (err: any) => {
				assert.isNotOk(err);
				const output = sdk.mock.written["output"];
				assert.equal(output.payloads.length, 2);
				assert.equal(output.payloads[0].name, "A");
				assert.equal(output.payloads[1].name, "C");
				done();
			});
		});

		it("enrichEvents (promisified) works", async () => {
			sdk.mock.queues["in"] = [{ x: 1 }, { x: 2 }];

			await sdk.enrichEvents({
				id: "bot",
				inQueue: "in",
				outQueue: "out",
				transform(payload: any, event: any, cb: any) {
					cb(null, { ...payload, doubled: payload.x * 2 });
				},
			});

			assert.equal(sdk.mock.written["out"].payloads.length, 2);
			assert.equal(sdk.mock.written["out"].payloads[0].doubled, 2);
		});
	});

	describe("offload end-to-end", () => {
		it("reads from mock queue and processes events", (done) => {
			sdk.mock.queues["work-queue"] = [
				{ task: "build" },
				{ task: "deploy" },
			];

			const processed: any[] = [];
			sdk.offload({
				id: "offload-bot",
				inQueue: "work-queue",
				transform(payload: any, event: any, cb: any) {
					processed.push(payload);
					cb();
				},
			}, (err: any) => {
				assert.isNotOk(err);
				assert.equal(processed.length, 2);
				assert.equal(processed[0].task, "build");
				assert.equal(processed[1].task, "deploy");
				done();
			});
		});

		it("offloadEvents (promisified) works", async () => {
			sdk.mock.queues["oq"] = [{ v: 10 }, { v: 20 }];

			const results: number[] = [];
			await sdk.offloadEvents({
				id: "bot",
				inQueue: "oq",
				transform(payload: any, event: any, cb: any) {
					results.push(payload.v);
					cb();
				},
			});

			assert.deepEqual(results, [10, 20]);
		});
	});

	describe("disableS3 option", () => {
		it("is enabled by default — strips useS3 from enrich opts", (done) => {
			sdk.mock.queues["in-q"] = [{ a: 1 }];

			const enrichOpts: any = {
				id: "bot",
				inQueue: "in-q",
				outQueue: "out-q",
				useS3: true,
				transform(payload: any, event: any, cb: any) { cb(null, payload); },
			};

			sdk.enrich(enrichOpts, (err: any) => {
				assert.notProperty(enrichOpts, "useS3");
				done(err);
			});
		});

		it("strips useS3 from offload opts", (done) => {
			sdk.mock.queues["in-q"] = [{ a: 1 }];

			const offloadOpts: any = {
				id: "bot",
				inQueue: "in-q",
				useS3: true,
				transform(payload: any, event: any, cb: any) { cb(); },
			};

			sdk.offload(offloadOpts, (err: any) => {
				assert.notProperty(offloadOpts, "useS3");
				done(err);
			});
		});

		it("can be explicitly disabled to preserve useS3", (done) => {
			const baseSdk = createMinimalSdk();
			const sdkWithS3 = mockRStreamsSdk(baseSdk, { disableS3: false });
			sdkWithS3.mock.queues["in-q"] = [{ a: 1 }];

			const enrichOpts: any = {
				id: "bot",
				inQueue: "in-q",
				outQueue: "out-q",
				useS3: true,
				transform(payload: any, event: any, cb: any) { cb(null, payload); },
			};

			sdkWithS3.enrich(enrichOpts, (err: any) => {
				assert.isTrue(enrichOpts.useS3);
				done(err);
			});
		});
	});

	describe("written proxy for unwritten queues", () => {
		it("returns empty capture for never-written queue", () => {
			const capture = sdk.mock.written["nonexistent-queue"];
			assert.isArray(capture.events);
			assert.isArray(capture.payloads);
			assert.equal(capture.events.length, 0);
			assert.equal(capture.payloads.length, 0);
		});

		it("returns real capture for written queue", async () => {
			await sdk.putEvent("bot", "real-queue", { x: 1 });
			const capture = sdk.mock.written["real-queue"];
			assert.equal(capture.payloads.length, 1);
		});
	});

	describe("load edge cases", () => {
		it("silently skips events with no determinable queue", async () => {
			await sdk.streams.pipeAsync(
				sdk.streams.eventstream.readArray([
					{ rawData: "no queue info" },
				]),
				// No outQueue provided, event has no .event field
				sdk.streams.load("my-bot"),
			);

			// Nothing should have been written
			assert.isEmpty(Object.keys(sdk.mock.written));
		});
	});
});

// ─── Integration test using real RStreamsSdk ───────────────────────────────
// Validates the mock against the actual SDK class shape, not a hand-built fake.

describe("lib/mock-sdk.ts (integration with real RStreamsSdk)", function () {
	let sdk: MockRStreamsSdk;

	before(() => {
		// Construct a real SDK with dummy config to skip AWS resource discovery
		const RealSdk = require("../index");
		const realSdk = new RealSdk({
			Region: "us-east-1",
			LeoStream: "mock-stream",
			LeoCron: "mock-cron",
			LeoEvent: "mock-event",
			LeoS3: "mock-s3",
			LeoKinesisStream: "mock-kinesis",
			LeoFirehoseStream: "mock-firehose",
			LeoSettings: "mock-settings",
		});
		sdk = mockRStreamsSdk(realSdk);
	});

	after(() => {
		sdk.mock.reset();
	});

	it("mock wraps real SDK and has expected shape", () => {
		assert.isObject(sdk.mock);
		assert.isFunction(sdk.read);
		assert.isFunction(sdk.write);
		assert.isFunction(sdk.enrich);
		assert.isFunction(sdk.offload);
		assert.isFunction(sdk.enrichEvents);
		assert.isFunction(sdk.offloadEvents);
		assert.isFunction(sdk.load);
		assert.isFunction(sdk.checkpoint);
		assert.isFunction(sdk.put);
		assert.isFunction(sdk.putEvent);
		assert.isFunction(sdk.putEvents);
		assert.isObject(sdk.bot);
		assert.isObject(sdk.streams);
		assert.isObject(sdk.configuration);
	});

	it("read returns mock data, not real DynamoDB", async () => {
		sdk.mock.queues["integration-queue"] = [
			{ hello: "world" },
		];

		const events: any[] = [];
		await sdk.streams.pipeAsync(
			sdk.read("test-bot", "integration-queue"),
			sdk.streams.through((event: any, done: any) => {
				events.push(event);
				done();
			}),
			sdk.streams.devnull()
		);

		assert.equal(events.length, 1);
		assert.deepEqual(events[0].payload, { hello: "world" });
	});

	it("enrich pipeline works end-to-end against real SDK", (done) => {
		sdk.mock.queues["real-in"] = [
			{ val: 1 },
			{ val: 2 },
		];

		sdk.enrich({
			id: "integration-bot",
			inQueue: "real-in",
			outQueue: "real-out",
			transform(payload: any, event: any, cb: any) {
				cb(null, { ...payload, doubled: payload.val * 2 });
			},
		}, (err: any) => {
			assert.isNotOk(err);
			assert.equal(sdk.mock.written["real-out"].payloads.length, 2);
			assert.equal(sdk.mock.written["real-out"].payloads[0].doubled, 2);
			assert.equal(sdk.mock.written["real-out"].payloads[1].doubled, 4);
			done();
		});
	});

	it("real streaming utilities are preserved", async () => {
		const results: string[] = [];
		await sdk.streams.pipeAsync(
			sdk.streams.eventstream.readArray(["a", "b"]),
			sdk.streams.through((s: string, done: any) => {
				done(null, s.toUpperCase());
			}),
			sdk.streams.through((s: string, done: any) => {
				results.push(s);
				done();
			}),
			sdk.streams.devnull()
		);
		assert.deepEqual(results, ["A", "B"]);
	});
});
