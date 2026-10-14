import sinon from "sinon";
import { assert } from "chai";
import zlib from "zlib";
import { PassThrough } from "stream";
import utilFn from "../lib/stream/leo-stream";

const EVENT_TABLE = "mock-LeoEvent";
const CRON_TABLE = "mock-LeoCron";
const QUEUE = "queue1";

describe("lib/stream/leo-stream.js read", function () {
	const sandbox = sinon.createSandbox();
	let ls: any;
	let configure: any;
	let batchGet: sinon.SinonStub;
	let query: sinon.SinonStub;
	let fromS3: sinon.SinonStub;
	let s3Files: Record<string, Buffer>;

	function build(extra: any = {}) {
		delete (process as any).__config;
		configure = {
			onUpdate: () => { },
			validate: () => { },
			resources: { LeoCron: CRON_TABLE, LeoEvent: EVENT_TABLE, LeoStream: "mock-LeoStream", LeoS3: "mock-leos3", LeoSettings: "mock-LeoSettings" },
			aws: { region: "us-west-2" },
			...extra
		};
		ls = utilFn(configure);
		batchGet = sandbox.stub(ls.dynamodb.docClient, "batchGet");
		query = sandbox.stub(ls.dynamodb.docClient, "query");
		s3Files = {};
		fromS3 = sandbox.stub(ls, "fromS3").callsFake((file: any) => {
			const pass = new PassThrough();
			pass.end(s3Files[file.key]);
			return pass;
		});
		return ls;
	}

	beforeEach(() => {
		delete (process as any).__config;
		build();
	});

	afterEach(() => {
		sandbox.restore();
	});

	const BASE = 1647297513618;

	function eidPrefix(ms: number) {
		return ls.eventIdFromTimestamp(ms) + "-";
	}

	function makeItem(n: number, opts: { ms?: number, asS3?: boolean, key?: string, offset?: number, label?: string } = {}) {
		const ms = opts.ms || BASE;
		const offset = opts.offset || 0;
		const events = Array.from({ length: n }, (_, i) => ({
			id: "upstream", event: QUEUE, payload: { label: opts.label || "e", n: offset + i },
			event_source_timestamp: 1000 + i, timestamp: 2000 + i
		}));
		const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
		const gzip = zlib.gzipSync(text);
		const base: any = {
			event: QUEUE, v: 2, size: Buffer.byteLength(text), gzipSize: gzip.length, records: n,
			start: eidPrefix(ms) + String(offset).padStart(7, "0"),
			end: eidPrefix(ms) + String(offset + n - 1).padStart(7, "0")
		};
		if (opts.asS3) {
			const key = opts.key || `file-${ms}-${offset}`;
			s3Files[key] = gzip;
			return {
				...base,
				s3: { bucket: "mock-leos3", key },
				offsets: [{ size: base.size, gzipOffset: 0, gzipSize: gzip.length, records: n, start: 0, end: n - 1, event: QUEUE, offset: 0 }]
			};
		}
		return { ...base, gzip };
	}

	function leoEvent(items: any[], extra: any = {}) {
		const last = items[items.length - 1];
		return { event: QUEUE, v: 2, max_eid: last ? last.end : ls.eventIdFromTimestamp(BASE), ...extra };
	}

	function setup(items: any[], opts: { event?: any, cron?: any, pages?: any[][] } = {}) {
		batchGet.callsFake((params: any, cb: any) => cb(null, {
			Responses: {
				[EVENT_TABLE]: opts.event === null ? [] : [opts.event || leoEvent(items)],
				[CRON_TABLE]: opts.cron ? [opts.cron] : []
			},
			UnprocessedKeys: {}
		}));
		const pages = opts.pages || [items];
		pages.forEach((page, i) => {
			query.onCall(i).callsFake((params: any, cb: any) => cb(null, { Items: page, Count: page.length, ConsumedCapacity: { CapacityUnits: 1 } }));
		});
		query.callsFake((params: any, cb: any) => cb(null, { Items: [], Count: 0 }));
	}

	function readAll(opts: any = {}, id = "bot1", queue = QUEUE) {
		return new Promise<any[]>((resolve, reject) => {
			const out: any[] = [];
			const stream = ls.fromLeo(id, queue, { start: ls.eventIdFromTimestamp(BASE - 1000), ...opts });
			stream.on("error", reject);
			stream.on("data", (e: any) => out.push(e));
			stream.on("end", () => resolve(out));
		});
	}

	describe("start position and query", function () {
		it("fromLeo reads every event of an inline gzip item and assigns eids from the item start", async function () {
			const item = makeItem(3);
			setup([item]);
			const events = await readAll();
			assert.deepEqual(events.map((e) => e.payload.n), [0, 1, 2]);
			assert.deepEqual(events.map((e) => e.eid), [0, 1, 2].map((i) => eidPrefix(BASE) + String(i).padStart(7, "0")));
			assert.isTrue(events.every((e) => e.event === QUEUE));
		});

		it("fromLeo looks up the cron row and event row together", async function () {
			setup([makeItem(1)]);
			await readAll();
			assert.deepEqual(batchGet.getCall(0).args[0].RequestItems, {
				[CRON_TABLE]: { Keys: [{ id: "bot1" }] },
				[EVENT_TABLE]: { Keys: [{ event: QUEUE }] }
			});
		});

		it("fromLeo queries the stream table between start and the event max eid", async function () {
			const item = makeItem(1);
			setup([item]);
			const startEid = ls.eventIdFromTimestamp(BASE - 1000);
			await readAll({ start: startEid, stream_query_limit: 7 });
			const params = query.getCall(0).args[0];
			assert.equal(params.TableName, "mock-LeoStream");
			assert.equal(params.KeyConditionExpression, "#event = :event and #key between :start and :maxkey");
			assert.deepEqual(params.ExpressionAttributeNames, { "#event": "event", "#key": "end" });
			assert.equal(params.Limit, 7);
			assert.deepEqual(params.ExpressionAttributeValues, { ":event": QUEUE, ":start": startEid + " ", ":maxkey": item.end });
		});

		it("fromLeo defaults the query limit to 50 and to 1000 with fast_s3_read", async function () {
			setup([makeItem(1)]);
			await readAll();
			assert.equal(query.getCall(0).args[0].Limit, 50);
			sandbox.restore();
			build();
			setup([makeItem(1, { asS3: true })]);
			await readAll({ fast_s3_read: true });
			assert.equal(query.getCall(0).args[0].Limit, 1000);
		});

		it("fromLeo starts after the cron checkpoint when no start is given", async function () {
			const item = makeItem(1);
			setup([item], { cron: { id: "bot1", checkpoints: { read: { "queue:queue1": { checkpoint: "z/2022/03/14/22/00/1647295200000-0000005" } } } } });
			await readAll({ start: undefined });
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":start"], "z/2022/03/14/22/00/1647295200000-0000005 ");
		});

		it("fromLeo starts at the registry starteid when set", async function () {
			setup([makeItem(1)]);
			configure.registry.__cron = { starteid: { "queue:queue1": "z/2022/03/14/22/00/1647295200000-0000001" } };
			await readAll({ start: undefined });
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":start"], "z/2022/03/14/22/00/1647295200000-0000001 ");
		});

		it("fromLeo records the cron checkpoint in the registry", async function () {
			const cp = { checkpoint: "z/2022/03/14/22/00/1-0", records: 3 };
			setup([makeItem(1)], { cron: { id: "bot1", checkpoints: { read: { "queue:queue1": cp } } } });
			await readAll();
			assert.deepEqual(configure.registry.__cron.checkpoints.read["queue:queue1"], cp);
		});

		it("fromLeo caps the read at the registry maxeid, then maxOverride, then the event max eid", async function () {
			const item = makeItem(1);
			setup([item]);
			configure.registry.__cron = { maxeid: "z/9999/maxeid" };
			await readAll();
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":maxkey"], "z/9999/maxeid");
			sandbox.restore();
			build();
			setup([item]);
			await readAll({ maxOverride: item.end });
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":maxkey"], item.end);
		});

		it("fromLeo applies subqueue to the queue name", async function () {
			setup([makeItem(1)]);
			await readAll({ subqueue: "sub" });
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":event"], "queue1.sub");
		});

		it("fromLeo ends empty when the queue has no event row", async function () {
			setup([], { event: null });
			assert.deepEqual(await readAll(), []);
			assert.equal(query.callCount, 0);
		});

		it("fromLeo reads a phantom queue even without an event row", async function () {
			setup([], { event: null });
			assert.deepEqual(await readAll({}, "bot1", "queue1/_phantom"), []);
		});

		it("fromLeo emits an error when the lookup fails", async function () {
			batchGet.callsFake((params: any, cb: any) => cb(new Error("lookup failed")));
			let err: any;
			try { await readAll(); } catch (e) { err = e; }
			assert.match(err.message, /lookup failed/);
		});

		it("fromLeo emits an error when the lookup is throttled", async function () {
			batchGet.callsFake((params: any, cb: any) => cb(null, { Responses: {}, UnprocessedKeys: { [EVENT_TABLE]: {} } }));
			let err: any;
			try { await readAll(); } catch (e) { err = e; }
			assert.equal(err.message, "Not enough capacity to read");
		});

		it("fromLeo emits an error when the stream query fails", async function () {
			setup([makeItem(1)]);
			query.reset();
			query.callsFake((params: any, cb: any) => cb(new Error("query failed")));
			let err: any;
			try { await readAll(); } catch (e) { err = e; }
			assert.equal(err.message, "query failed");
		});

		it("fromLeo does not read when the start is already past the max eid", async function () {
			const item = makeItem(1);
			setup([item]);
			const hooks = { onEnd: sandbox.stub().resolves() };
			assert.deepEqual(await readAll({ start: item.end, hooks }), []);
			assert.equal(query.callCount, 0);
			assert.equal(hooks.onEnd.callCount, 1);
		});
	});

	describe("limits", function () {
		it("limit stops after that many events", async function () {
			setup([makeItem(5)]);
			const events = await readAll({ limit: 2 });
			assert.deepEqual(events.map((e) => e.payload.n), [0, 1]);
		});

		it("size stops once that many bytes were read", async function () {
			setup([makeItem(5)]);
			const events = await readAll({ size: 1 });
			assert.isBelow(events.length, 5);
			assert.isAtLeast(events.length, 1);
		});

		it("events at or before start are skipped", async function () {
			const item = makeItem(4);
			setup([item]);
			const events = await readAll({ start: eidPrefix(BASE) + "0000001" });
			assert.deepEqual(events.map((e) => e.payload.n), [2, 3]);
		});

		it("loops caps the number of query pages", async function () {
			const pages = [[makeItem(1, { ms: BASE })], [makeItem(1, { ms: BASE + 1000 })], [makeItem(1, { ms: BASE + 2000 })]];
			setup(pages[0], { pages, event: leoEvent(pages[2]) });
			const events = await readAll({ loops: 2 });
			assert.equal(events.length, 2);
			assert.equal(query.callCount >= 2, true);
		});

		it("multiple pages are read in order", async function () {
			const pages = [[makeItem(2, { ms: BASE, label: "p1" })], [makeItem(2, { ms: BASE + 1000, label: "p2" })]];
			setup(pages[0], { pages, event: leoEvent(pages[1]) });
			const events = await readAll();
			assert.deepEqual(events.map((e) => `${e.payload.label}${e.payload.n}`), ["p10", "p11", "p20", "p21"]);
		});

		it("pass.get reports the stats of what was read and checkpoint writes them", async function () {
			setup([makeItem(3)]);
			const stream = ls.fromLeo("bot1", QUEUE, { start: ls.eventIdFromTimestamp(BASE - 1000) });
			stream.on("data", () => { });
			await new Promise((r) => stream.on("end", r));
			const stats = stream.get();
			assert.equal(stats.units, 3);
			assert.equal(stats.eid, eidPrefix(BASE) + "0000002");
			assert.equal(stats.start_eid, eidPrefix(BASE) + "0000000");
			const checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, queue: string, data: any, cb: any) => cb());
			const result = await new Promise((resolve) => stream.checkpoint((err: any, data: any) => resolve(data)));
			assert.equal(checkpoint.getCall(0).args[0], "bot1");
			assert.equal(checkpoint.getCall(0).args[1], QUEUE);
			assert.equal((result as any).units, 3);
			assert.equal(stream.get().units, 0);
		});

		it("checkpoint with no events read skips the cron write", async function () {
			setup([], { event: null });
			const stream = ls.fromLeo("bot1", QUEUE, {});
			stream.on("data", () => { });
			await new Promise((r) => stream.on("end", r));
			const checkpoint = sandbox.stub(ls.cron, "checkpoint");
			const data = await new Promise((resolve) => stream.checkpoint({ extra: 1 }, (err: any, d: any) => resolve(d)));
			assert.equal(checkpoint.callCount, 0);
			assert.equal((data as any).extra, 1);
		});

		it("destroying the stream stops reading", async function () {
			setup([makeItem(50)]);
			const stream = ls.fromLeo("bot1", QUEUE, { start: ls.eventIdFromTimestamp(BASE - 1000), buffer: 1 });
			const seen: any[] = [];
			await new Promise<void>((resolve) => {
				stream.on("data", (e: any) => {
					seen.push(e);
					if (seen.length === 2) { stream.destroy(); resolve(); }
				});
			});
			assert.isBelow(seen.length, 50);
		});

		it("getOpts returns the resolved options", function () {
			setup([makeItem(1)]);
			const stream = ls.fromLeo("bot1", QUEUE, { loops: 5 });
			assert.equal(stream.getOpts().loops, 5);
			assert.equal(stream.getOpts().buffer, 16);
			assert.equal(stream.getOpts().fast_s3_read_timeout_retry_count, 1);
			assert.equal(stream.getOpts().fast_s3_read_parallel_fetch_max_bytes, 5 * 1024 * 1024);
			stream.destroy();
		});

		it("runTime sets the stop time from a duration", function () {
			setup([makeItem(1)]);
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
			const stream = ls.fromLeo("bot1", QUEUE, { runTime: { seconds: 30 } });
			assert.equal(stream.getOpts().stopTime, 1700000030000);
			stream.destroy();
		});

		it("the lambda context shortens the stop time to 80 percent of the remaining time", function () {
			setup([makeItem(1)]);
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
			configure.registry.context = { getRemainingTimeInMillis: () => 10000 };
			const stream = ls.fromLeo("bot1", QUEUE, {});
			assert.equal(stream.getOpts().stopTime, 1700000008000);
			stream.destroy();
		});
	});

	describe("s3 items", function () {
		it("reads events from an S3 item through fromS3 with the byte range", async function () {
			const item: any = makeItem(3, { asS3: true });
			setup([item]);
			const events = await readAll();
			assert.deepEqual(events.map((e) => e.payload.n), [0, 1, 2]);
			assert.equal(fromS3.callCount, 1);
			assert.deepEqual(fromS3.getCall(0).args[0], { bucket: "mock-leos3", key: item.s3.key, range: `bytes=0-${item.gzipSize}` });
		});

		it("jumps into the file at the offset that contains the start", async function () {
			const item: any = makeItem(4, { asS3: true });
			item.offsets = [
				{ size: 10, gzipOffset: 0, gzipSize: 10, records: 2, start: 0, end: 1, event: QUEUE, offset: 0 },
				{ size: 10, gzipOffset: 10, gzipSize: 10, records: 2, start: 2, end: 3, event: QUEUE, offset: 10 }
			];
			setup([item]);
			await readAll({ start: eidPrefix(BASE) + "0000001" });
			assert.equal(fromS3.getCall(0).args[0].range, `bytes=10-${item.gzipSize}`);
		});

		it("reads from a local tmp file when one exists for the range", async function () {
			const fs = require("fs");
			const os = require("os");
			const path = require("path");
			const item: any = makeItem(2, { asS3: true });
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rstreams-tmp-"));
			try {
				ls.tmpDir = dir;
				const local = path.resolve(dir, `s3/${item.event}/${item.end.replace(/\//g, "_")}-0-${item.gzipSize}.jsonl.gz`);
				fs.mkdirSync(path.dirname(local), { recursive: true });
				fs.writeFileSync(local, s3Files[item.s3.key]);
				setup([item]);
				const events = await readAll();
				assert.equal(events.length, 2);
				assert.equal(fromS3.callCount, 0);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	describe("fast_s3_read timeout retry", function () {
		function timeoutError() {
			const err: any = new Error("timed out");
			err.name = "TimeoutError";
			return err;
		}

		function slowGood(key: string, ms = 30) {
			const pass = new PassThrough();
			setTimeout(() => pass.end(s3Files[key]), ms);
			return pass;
		}

		function deferred() {
			let resolve: () => void = () => { };
			const promise = new Promise<void>((r) => { resolve = r; });
			return { promise, resolve };
		}

		async function flushEventLoop() {
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setImmediate(r));
			}
		}

		function gatedGood(key: string, gate: Promise<void>) {
			const pass = new PassThrough();
			gate.then(() => pass.end(s3Files[key]));
			return pass;
		}

		function failing(err: any) {
			const pass = new PassThrough();
			setImmediate(() => pass.emit("error", err));
			return pass;
		}

		function twoFiles() {
			const a: any = makeItem(2, { asS3: true, ms: BASE, key: "file-a", label: "a" });
			const b: any = makeItem(2, { asS3: true, ms: BASE + 1000, key: "file-b", label: "b" });
			setup([a, b]);
			return [a, b];
		}

		function labels(events: any[]) {
			return events.map((e) => `${e.payload.label}${e.payload.n}`);
		}

		it("a pre-connected file that times out is connected again once", async function () {
			twoFiles();
			let bCalls = 0;
			fromS3.callsFake((file: any) => {
				if (file.key === "file-a") { return slowGood("file-a"); }
				bCalls++;
				return bCalls === 1 ? failing(timeoutError()) : slowGood("file-b", 0);
			});
			const events = await readAll({ fast_s3_read: true });
			assert.deepEqual(labels(events), ["a0", "a1", "b0", "b1"]);
			assert.equal(bCalls, 2);
		});

		it("after the retry count is used up the file is connected when it is needed", async function () {
			twoFiles();
			let bCalls = 0;
			fromS3.callsFake((file: any) => {
				if (file.key === "file-a") { return slowGood("file-a", 60); }
				bCalls++;
				return bCalls <= 2 ? failing(timeoutError()) : slowGood("file-b", 0);
			});
			const events = await readAll({ fast_s3_read: true });
			assert.deepEqual(labels(events), ["a0", "a1", "b0", "b1"]);
			assert.equal(bCalls, 3);
		});

		it("fast_s3_read_timeout_retry_count 0 does not reconnect early", async function () {
			twoFiles();
			let bCalls = 0;
			fromS3.callsFake((file: any) => {
				if (file.key === "file-a") { return slowGood("file-a", 60); }
				bCalls++;
				return bCalls === 1 ? failing(timeoutError()) : slowGood("file-b", 0);
			});
			const events = await readAll({ fast_s3_read: true, fast_s3_read_timeout_retry_count: 0 });
			assert.deepEqual(labels(events), ["a0", "a1", "b0", "b1"]);
			assert.equal(bCalls, 2);
		});

		it("a non-timeout error on a pre-connected file is raised when the file is read", async function () {
			twoFiles();
			fromS3.callsFake((file: any) => {
				if (file.key === "file-a") { return slowGood("file-a", 60); }
				const err: any = new Error("access denied");
				err.name = "AccessDenied";
				return failing(err);
			});
			let err: any;
			try { await readAll({ fast_s3_read: true }); } catch (e) { err = e; }
			assert.equal(err.message, "access denied");
		});

		it("without fast_s3_read files are fetched one at a time with no retry", async function () {
			twoFiles();
			const order: string[] = [];
			fromS3.callsFake((file: any) => { order.push(file.key); return slowGood(file.key, 0); });
			const events = await readAll();
			assert.deepEqual(labels(events), ["a0", "a1", "b0", "b1"]);
			assert.deepEqual(order, ["file-a", "file-b"]);
		});

		it("fast_s3_read connects to following files while reading the first", async function () {
			twoFiles();
			const connectedWhileReadingFirst: string[] = [];
			const gateA = deferred();
			const bConnected = deferred();
			fromS3.callsFake((file: any) => {
				connectedWhileReadingFirst.push(file.key);
				if (file.key === "file-b") { bConnected.resolve(); }
				return file.key === "file-a" ? gatedGood(file.key, gateA.promise) : slowGood(file.key, 0);
			});
			const stream = ls.fromLeo("bot1", QUEUE, { start: ls.eventIdFromTimestamp(BASE - 1000), fast_s3_read: true });
			const first = new Promise((resolve) => stream.once("data", resolve));
			stream.on("data", () => { });
			await bConnected.promise;
			assert.deepEqual(connectedWhileReadingFirst, ["file-a", "file-b"]);
			gateA.resolve();
			await first;
			await new Promise((r) => stream.on("end", r));
		});

		it("fast_s3_read_parallel_fetch_max_bytes limits how many files connect ahead", async function () {
			const a: any = makeItem(2, { asS3: true, ms: BASE, key: "file-a" });
			const b: any = makeItem(2, { asS3: true, ms: BASE + 1000, key: "file-b" });
			const c: any = makeItem(2, { asS3: true, ms: BASE + 2000, key: "file-c" });
			setup([a, b, c]);
			const connected: string[] = [];
			const gateA = deferred();
			const aConnected = deferred();
			fromS3.callsFake((file: any) => {
				connected.push(file.key);
				if (file.key === "file-a") { aConnected.resolve(); }
				return file.key === "file-a" ? gatedGood(file.key, gateA.promise) : slowGood(file.key, 0);
			});
			const stream = ls.fromLeo("bot1", QUEUE, { start: ls.eventIdFromTimestamp(BASE - 1000), fast_s3_read: true, fast_s3_read_parallel_fetch_max_bytes: 1 });
			stream.on("data", () => { });
			await aConnected.promise;
			await flushEventLoop();
			assert.deepEqual(connected, ["file-a"]);
			const ended = new Promise((r) => stream.on("end", r));
			gateA.resolve();
			await ended;
			assert.deepEqual(connected, ["file-a", "file-b", "file-c"]);
		});
	});

	describe("read hooks", function () {
		function hookLog() {
			const log: string[] = [];
			const hooks = {
				onStart: (info: any) => { log.push(`start:${info.queue}`); },
				onGetEvents: (items: any[]) => { log.push(`getEvents:${items.length}`); },
				onBatchStart: (items: any[]) => { log.push(`batchStart:${items.length}`); },
				onRecordStart: (item: any, i: number) => { log.push(`recordStart:${i}`); },
				onRecordEnd: (item: any, i: number) => { log.push(`recordEnd:${i}`); },
				onBatchEnd: async (items: any[]) => { log.push(`batchEnd:${items.length}`); },
				onEnd: async () => { log.push("end"); }
			};
			return { log, hooks };
		}

		it("hooks run in order, with onGetEvents also running for the prefetched page that is never read", async function () {
			setup([makeItem(2), makeItem(1, { ms: BASE + 1000 })]);
			const { log, hooks } = hookLog();
			await readAll({ hooks });
			assert.deepEqual(log, [
				"start:queue1", "getEvents:2", "getEvents:0", "batchStart:2",
				"recordStart:0", "recordEnd:0", "recordStart:1", "recordEnd:1",
				"batchEnd:2", "end"
			]);
		});

		it("onStart receives the queue and the start eid", async function () {
			setup([makeItem(1)]);
			const onStart = sandbox.stub();
			const start = ls.eventIdFromTimestamp(BASE - 1000);
			await readAll({ start, hooks: { onStart } });
			assert.deepEqual(onStart.getCall(0).args[0], { queue: QUEUE, eid: start + " " });
		});

		it("onGetEvents may replace the items returned by the query", async function () {
			const real = makeItem(2, { label: "real" });
			setup([makeItem(2, { label: "ignored" })], { event: leoEvent([real]) });
			const events = await readAll({ hooks: { onGetEvents: (items: any[]) => items.length ? [real] : undefined } });
			assert.deepEqual(events.map((e) => e.payload.label), ["real", "real"]);
		});

		it("onBatchStart may replace the items to read", async function () {
			const first = makeItem(1, { ms: BASE, label: "first" });
			const second = makeItem(1, { ms: BASE + 1000, label: "second" });
			setup([first, second]);
			const events = await readAll({ hooks: { onBatchStart: (items: any[]) => items.length ? [items[1]] : undefined } });
			assert.deepEqual(events.map((e) => e.payload.label), ["second"]);
		});

		it("onBatchEnd and onEnd are awaited before the stream ends", async function () {
			setup([makeItem(1)]);
			const order: string[] = [];
			let ended = false;
			const stream = ls.fromLeo("bot1", QUEUE, {
				start: ls.eventIdFromTimestamp(BASE - 1000),
				hooks: {
					onBatchEnd: async () => { await new Promise((r) => setTimeout(r, 20)); order.push("batchEnd"); },
					onEnd: async () => { await new Promise((r) => setTimeout(r, 20)); order.push("end"); }
				}
			});
			stream.on("data", () => { });
			stream.on("end", () => { ended = true; order.push("streamEnd"); });
			await new Promise((r) => stream.on("end", r));
			assert.isTrue(ended);
			assert.deepEqual(order, ["batchEnd", "end", "streamEnd"]);
		});

		it("onEnd is not called when there is nothing to read", async function () {
			setup([], { event: null });
			const onEnd = sandbox.stub().resolves();
			await readAll({ hooks: { onEnd } });
			assert.equal(onEnd.callCount, 0);
		});

		it("getS3Stream supplies the stream for an S3 item", async function () {
			const item: any = makeItem(2, { asS3: true });
			setup([item]);
			const stream: any = new PassThrough();
			stream.idOffset = 0;
			stream.end(s3Files[item.s3.key]);
			const getS3Stream = sandbox.stub().returns(stream);
			const events = await readAll({ hooks: { getS3Stream } });
			assert.equal(events.length, 2);
			assert.equal(fromS3.callCount, 0);
			assert.equal(getS3Stream.getCall(0).args[1], 0);
		});

		it("createS3Stream supplies a wrapper whose get returns the stream", async function () {
			const item: any = makeItem(2, { asS3: true });
			setup([item]);
			const createS3Stream = sandbox.stub().callsFake(() => {
				const stream: any = new PassThrough();
				stream.idOffset = 0;
				stream.end(s3Files[item.s3.key]);
				return { get: () => stream };
			});
			const events = await readAll({ hooks: { createS3Stream } });
			assert.equal(events.length, 2);
			assert.equal(fromS3.callCount, 0);
		});

		it("createSplitParseStream replaces the line parser", async function () {
			const item = makeItem(2);
			setup([item]);
			const createSplitParseStream = sandbox.stub().callsFake(() => {
				const { Transform } = require("stream");
				return new Transform({
					objectMode: true,
					transform(chunk: any, enc: any, cb: any) {
						chunk.toString().split("\n").filter(Boolean).forEach((l: string) => this.push({ ...JSON.parse(l), custom: true }));
						cb();
					}
				});
			});
			const events = await readAll({ hooks: { createSplitParseStream } });
			assert.isTrue(events.every((e) => e.custom === true));
			assert.equal(events.length, 2);
		});
	});

	describe("snapshot and archive", function () {
		it("starting at z/ with a snapshot reads the _snapshot queue first and the page prefetched at the switch still uses the snapshot queue", async function () {
			const snapRaw: any = makeItem(1, { label: "snap", ms: BASE, offset: 1 });
			const snapItem = { ...snapRaw, start: snapRaw.start.replace(/^z\//, ""), end: snapRaw.end.replace(/^z\//, "") };
			const realItem: any = makeItem(1, { label: "real", ms: BASE + 5000 });
			batchGet.callsFake((params: any, cb: any) => cb(null, {
				Responses: {
					[EVENT_TABLE]: [{ event: QUEUE, v: 2, max_eid: realItem.end, snapshot: { start: "_snapshot/" + snapItem.start.replace(/-\d+$/, "-0000000"), next: "z/2022/03/14/22/38/1647297513618-0000000" } }],
					[CRON_TABLE]: []
				},
				UnprocessedKeys: {}
			}));
			query.onFirstCall().callsFake((p: any, cb: any) => cb(null, { Items: [snapItem], Count: 1 }));
			query.onSecondCall().callsFake((p: any, cb: any) => cb(null, { Items: [], Count: 0 }));
			query.onThirdCall().callsFake((p: any, cb: any) => cb(null, { Items: [realItem], Count: 1 }));
			query.callsFake((p: any, cb: any) => cb(null, { Items: [], Count: 0 }));
			const events = await readAll({ start: "z/" });
			const first = query.getCall(0).args[0].ExpressionAttributeValues;
			assert.equal(first[":event"], "queue1/_snapshot");
			assert.equal(first[":start"], snapItem.start.replace(/-\d+$/, "-0000000"));
			assert.match(first[":maxkey"], /^2022\/03\/14\/22\/38\/99999999999$/);
			assert.deepEqual(events.map((e) => e.payload.label), ["snap", "real"]);
			assert.equal(events[0].eid, "_snapshot/" + snapItem.start);
			assert.equal(query.getCall(2).args[0].ExpressionAttributeValues[":event"], "queue1/_snapshot");
			assert.equal(query.getCall(3).args[0].ExpressionAttributeValues[":event"], "queue1");
		});

		it("an archive end after the start reads the _archive queue first", async function () {
			const archived: any = makeItem(1, { label: "old", ms: BASE });
			archived.archive = true;
			archived.gzip = zlib.gzipSync(JSON.stringify({ id: "u", event: QUEUE, payload: { label: "old", n: 0 }, eid: archived.end }) + "\n");
			const item = makeItem(1, { label: "new", ms: BASE + 5000 });
			batchGet.callsFake((params: any, cb: any) => cb(null, {
				Responses: { [EVENT_TABLE]: [{ event: QUEUE, v: 2, max_eid: item.end, archive: { end: archived.end } }], [CRON_TABLE]: [] },
				UnprocessedKeys: {}
			}));
			query.onFirstCall().callsFake((p: any, cb: any) => cb(null, { Items: [archived], Count: 1 }));
			query.onSecondCall().callsFake((p: any, cb: any) => cb(null, { Items: [], Count: 0 }));
			query.onThirdCall().callsFake((p: any, cb: any) => cb(null, { Items: [item], Count: 1 }));
			query.callsFake((p: any, cb: any) => cb(null, { Items: [], Count: 0 }));
			const events = await readAll({ start: ls.eventIdFromTimestamp(BASE - 1000) });
			assert.equal(query.getCall(0).args[0].ExpressionAttributeValues[":event"], "queue1/_archive");
			assert.deepEqual(events.map((e) => e.payload.label), ["old", "new"]);
		});
	});

	describe("parsers", function () {
		it("an unparsable line ends the stream with a push-after-EOF error", async function () {
			const item: any = makeItem(2);
			const text = JSON.stringify({ id: "u", event: QUEUE, payload: { n: 0 } }) + "\nnot json\n" + JSON.stringify({ id: "u", event: QUEUE, payload: { n: 1 } }) + "\n";
			item.gzip = zlib.gzipSync(text);
			setup([item]);
			let err: any;
			try { await readAll(); } catch (e) { err = e; }
			assert.equal(err.message, "stream.push() after EOF");
		});

		it("setBaseEid commands change the eid prefix and restart the offset", async function () {
			const item: any = makeItem(2);
			const text = JSON.stringify({ _cmd: "setBaseEid", eid: "z/2030/01/01/00/00/1893456000000-0000010" }) + "\n" + JSON.stringify({ id: "u", event: QUEUE, payload: { n: 0 } }) + "\n";
			item.gzip = zlib.gzipSync(text);
			item.end = "z/2031/01/01/00/00/1924992000000-0000000";
			setup([item]);
			const events = await readAll();
			assert.equal(events[0].eid, "z/2030/01/01/00/00/1893456000000-0000010");
		});
	});
});
