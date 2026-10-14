import sinon from "sinon";
import { assert } from "chai";
import zlib from "zlib";
import { Readable, Writable, PassThrough } from "stream";
import utilFn from "../lib/stream/leo-stream";

describe("lib/stream/leo-stream.js misc", function () {
	const sandbox = sinon.createSandbox();
	let ls: any;
	let configure: any;
	let putRecords: sinon.SinonStub;
	let toS3Uploads: { bucket: string, key: string, chunks: Buffer[] }[];
	let onUpdateCallbacks: ((c: any) => void)[];

	function build(extra: any = {}, stubToS3 = true) {
		onUpdateCallbacks = [];
		configure = {
			onUpdate: (cb: any) => onUpdateCallbacks.push(cb),
			validate: () => { },
			resources: { LeoCron: "mock-LeoCron", LeoEvent: "mock-LeoEvent", LeoStream: "mock-LeoStream", LeoS3: "mock-leos3", LeoSettings: "mock-LeoSettings" },
			aws: { region: "us-west-2" },
			stream: "mock-stream",
			bus: { firehose: "mock-firehose" },
			...extra
		};
		ls = utilFn(configure);
		putRecords = sandbox.stub(ls.kinesis, "putRecords").callsFake((params: any, cb: any) => cb(null, { FailedRecordCount: 0, Records: params.Records.map(() => ({})) }));
		toS3Uploads = [];
		if (stubToS3) {
			sandbox.stub(ls, "toS3").callsFake((bucket: string, key: string) => {
				const upload = { bucket, key, chunks: [] as Buffer[] };
				toS3Uploads.push(upload);
				return new Writable({ write(chunk, enc, cb) { upload.chunks.push(Buffer.from(chunk)); cb(); } });
			});
		}
		return ls;
	}

	beforeEach(() => {
		delete (process as any).__config;
		build();
	});

	afterEach(() => {
		sandbox.restore();
	});

	function decodeGzipRecord(data: Buffer) {
		return zlib.gunzipSync(data).toString().trim().split("\n").map((l) => JSON.parse(l));
	}

	function readEvents(queue: string, count: number, extra: any = {}) {
		return Array.from({ length: count }, (_, i) => ({
			id: "upstream", event: queue, eid: `z/2022/03/14/22/38/1647297513618-000000${i}`, payload: { n: i },
			event_source_timestamp: 1000 + i, timestamp: 2000 + i, ...extra
		}));
	}

	function collect(stream: any, events: any[]) {
		const out: any[] = [];
		return ls.pipeAsync(ls.eventstream.readArray(events), stream, ls.write({ hasCommands: false }, (o, done) => { out.push(o); done(); })).then(() => out);
	}

	describe("D3 toDynamoDB", function () {
		let batchWrite: sinon.SinonStub;
		beforeEach(() => {
			batchWrite = sandbox.stub(ls.dynamodb.docClient, "batchWrite").callsFake((p: any, cb: any) => cb(null, { UnprocessedItems: {} }));
		});

		function itemsOf(call: any) {
			return call.args[0].RequestItems.T.map((r: any) => r.PutRequest.Item);
		}

		it("D3 toDynamoDB writes records as PutRequests", async function () {
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a" }, { id: "b" }]), ls.toDynamoDB("T", {}));
			assert.equal(batchWrite.callCount, 1);
			assert.deepEqual(batchWrite.getCall(0).args[0], {
				RequestItems: { T: [{ PutRequest: { Item: { id: "a" } } }, { PutRequest: { Item: { id: "b" } } }] },
				ReturnConsumedCapacity: "TOTAL"
			});
		});

		it("D3 toDynamoDB splits a flush into batches of 25", async function () {
			const records = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}` }));
			await ls.pipeAsync(ls.eventstream.readArray(records), ls.toDynamoDB("T", { records: 100 }));
			assert.deepEqual(batchWrite.getCalls().map((c: any) => c.args[0].RequestItems.T.length).sort((a: number, b: number) => b - a), [25, 25, 10]);
		});

		it("D3 toDynamoDB flushes every opts.records records", async function () {
			const records = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}` }));
			await ls.pipeAsync(ls.eventstream.readArray(records), ls.toDynamoDB("T", { records: 3 }));
			assert.deepEqual(batchWrite.getCalls().map((c: any) => c.args[0].RequestItems.T.length), [3, 3]);
		});

		it("D3 toDynamoDB keeps only the last record per hash key", async function () {
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "a", v: 2 }]), ls.toDynamoDB("T", { hash: "id" }));
			assert.deepEqual(itemsOf(batchWrite.getCall(0)), [{ id: "a", v: 2 }, { id: "b", v: 1 }]);
		});

		it("D3 toDynamoDB keys on hash and range together", async function () {
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a", r: 1, v: 1 }, { id: "a", r: 2, v: 2 }, { id: "a", r: 1, v: 3 }]), ls.toDynamoDB("T", { hash: "id", range: "r" }));
			assert.deepEqual(itemsOf(batchWrite.getCall(0)), [{ id: "a", r: 1, v: 3 }, { id: "a", r: 2, v: 2 }]);
		});

		it("D3 toDynamoDB merge deep-merges duplicates within a batch", async function () {
			sandbox.stub(ls.dynamodb, "batchGetTable").callsFake((t: string, keys: any[], o: any, cb: any) => cb(null, []));
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a", n: { x: 1 } }, { id: "a", n: { y: 2 } }]), ls.toDynamoDB("T", { hash: "id", merge: true }));
			assert.deepEqual(itemsOf(batchWrite.getCall(0)), [{ id: "a", n: { x: 1, y: 2 } }]);
		});

		it("D3 toDynamoDB merge reads existing items by key and merges the new data over them", async function () {
			const batchGetTable = sandbox.stub(ls.dynamodb, "batchGetTable").callsFake((t: string, keys: any[], o: any, cb: any) => cb(null, [{ id: "a", old: true, n: { x: 0, z: 9 } }]));
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a", n: { x: 1 } }, { id: "b" }]), ls.toDynamoDB("T", { hash: "id", merge: true }));
			assert.equal(batchGetTable.getCall(0).args[0], "T");
			assert.deepEqual(batchGetTable.getCall(0).args[1].map((k: any) => k.id), ["a", "b"]);
			assert.deepEqual(itemsOf(batchWrite.getCall(0)), [{ id: "a", old: true, n: { x: 1, z: 9 } }, { id: "b" }]);
		});

		it("D3 toDynamoDB merge fails the stream when the existing-item lookup fails", async function () {
			sandbox.stub(ls.dynamodb, "batchGetTable").callsFake((t: string, keys: any[], o: any, cb: any) => cb(new Error("lookup failed")));
			let err: any;
			try {
				await ls.pipeAsync(ls.eventstream.readArray([{ id: "a" }]), ls.toDynamoDB("T", { hash: "id", merge: true }));
			} catch (e) { err = e; }
			assert.exists(err);
			assert.equal(batchWrite.callCount, 0);
		});

		it("D3 toDynamoDB resends only unprocessed items", async function () {
			batchWrite.onFirstCall().callsFake((p: any, cb: any) => cb(null, { UnprocessedItems: { T: [{ PutRequest: { Item: { id: "b" } } }] } }));
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a" }, { id: "b" }]), ls.toDynamoDB("T", {}));
			assert.equal(batchWrite.callCount, 2);
			assert.deepEqual(itemsOf(batchWrite.getCall(1)), [{ id: "b" }]);
		});

		it("D3 toDynamoDB retries after a retryable error", async function () {
			const retryable: any = new Error("throttled");
			retryable.retryable = true;
			batchWrite.onFirstCall().callsFake((p: any, cb: any) => cb(retryable));
			await ls.pipeAsync(ls.eventstream.readArray([{ id: "a" }]), ls.toDynamoDB("T", {}));
			assert.equal(batchWrite.callCount, 2);
			assert.deepEqual(itemsOf(batchWrite.getCall(1)), [{ id: "a" }]);
		});

		it("D3 toDynamoDB fails the stream on a non-retryable error", async function () {
			batchWrite.callsFake((p: any, cb: any) => cb(new Error("validation")));
			let err: any;
			try {
				await ls.pipeAsync(ls.eventstream.readArray([{ id: "a" }]), ls.toDynamoDB("T", {}));
			} catch (e) { err = e; }
			assert.exists(err);
			assert.equal(batchWrite.callCount, 1);
		});

		it("D3 toDynamoDB with no records never calls batchWrite", async function () {
			await ls.pipeAsync(ls.eventstream.readArray([]), ls.toDynamoDB("T", {}));
			assert.equal(batchWrite.callCount, 0);
		});
	});

	describe("W9 autoSwitch", function () {
		it("W9 autoSwitch consumes events without emitting them or flushing the inner pipeline", async function () {
			const out = await collect(ls.autoSwitch("q1", { recordsPerSecond: 1e9 }), [{ id: "bot1", event: "q1", payload: { n: 1 } }, { id: "bot1", event: "q1", payload: { n: 2 } }]);
			assert.deepEqual(out, []);
			assert.equal(putRecords.callCount, 0);
			assert.equal(toS3Uploads.filter((u) => u.chunks.length > 0).length, 0);
		});
	});

	describe("W10 magic", function () {
		function passStream(seen: any[]) {
			return ls.through((o, done) => { seen.push(o); done(null, o); });
		}

		function slowStream(seen: any[]) {
			return ls.through((o, done) => { seen.push(o.n); setTimeout(() => done(null, o), 5); });
		}

		it("W10 magic sends everything through the first stream that can sustain the load", async function () {
			const seenA: any[] = [];
			const seenB: any[] = [];
			const out = await collect(ls.magic([
				{ stream: passStream(seenA), canSustainLoad: () => true, label: "A" },
				{ stream: passStream(seenB), canSustainLoad: () => true, label: "B" }
			], {}), [{ n: 1 }, { n: 2 }, { n: 3 }]);
			assert.deepEqual(seenA.map((e) => e.n), [1, 2, 3]);
			assert.deepEqual(seenB, []);
			assert.deepEqual(out.map((e) => e.n), [1, 2, 3]);
		});

		it("W10 magic falls back to the last stream when none can sustain the load", async function () {
			const seenA: any[] = [];
			const seenB: any[] = [];
			await collect(ls.magic([
				{ stream: passStream(seenA), label: "A" },
				{ stream: passStream(seenB), label: "B" }
			], {}), [{ n: 1 }, { n: 2 }]);
			assert.deepEqual(seenA, []);
			assert.deepEqual(seenB.map((e) => e.n), [1, 2]);
		});

		it("W10 magic numeric canSustainLoad compares against records per second", async function () {
			const seenA: any[] = [];
			const seenB: any[] = [];
			await collect(ls.magic([
				{ stream: passStream(seenA), canSustainLoad: 1000000 },
				{ stream: passStream(seenB) }
			], {}), [{ n: 1 }, { n: 2 }]);
			assert.deepEqual(seenA.map((e) => e.n), [1, 2]);
			assert.deepEqual(seenB, []);
		});

		it("W10 magic assigns labels from the stream index and a default minimum duration", function () {
			const streams: any[] = [{ stream: passStream([]) }, { stream: passStream([]) }];
			ls.magic(streams, {});
			assert.deepEqual(streams.map((s) => s.label), ["0", "1"]);
			assert.deepEqual(streams.map((s) => s.minDurationMS), [5000, 5000]);
		});

		it("W10 magic switches streams once the current one can no longer sustain the load", async function () {
			const seenA: any[] = [];
			const seenB: any[] = [];
			let calls = 0;
			let clock = 1000000000000;
			sandbox.stub(Date, "now").callsFake(() => (clock += 10));
			const out = await collect(ls.magic([
				{ stream: slowStream(seenA), canSustainLoad: () => ++calls <= 2, minDurationMS: 1, label: "A" },
				{ stream: slowStream(seenB), minDurationMS: 1, label: "B" }
			], {}), [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
			assert.equal(seenA[0], 1);
			assert.isAbove(seenB.length, 0);
			assert.deepEqual(seenA.concat(seenB), [1, 2, 3, 4]);
			assert.deepEqual(out.map((e) => e.n), [1, 2, 3, 4]);
		});
	});

	describe("S1 S3 streams", function () {
		let s3: any;
		beforeEach(() => {
			s3 = ls.s3;
		});

		function read(stream: any) {
			return new Promise<string>((resolve, reject) => {
				const chunks: Buffer[] = [];
				stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
				stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
				stream.on("error", reject);
			});
		}

		it("S1 fromS3 reads the object using bucket, key and range", async function () {
			const getObject = sandbox.stub(s3, "getObject").resolves({ Body: Readable.from([Buffer.from("hello")]) });
			const text = await read(ls.fromS3({ bucket: "b", key: "k", range: "bytes=0-4" }));
			assert.equal(text, "hello");
			assert.deepEqual(getObject.getCall(0).args[0], { Bucket: "b", Key: "k", Range: "bytes=0-4" });
		});

		it("S1 fromS3 accepts capitalized Bucket and Key", async function () {
			const getObject = sandbox.stub(s3, "getObject").resolves({ Body: Readable.from([Buffer.from("x")]) });
			await read(ls.fromS3({ Bucket: "B", Key: "K" }));
			assert.deepEqual(getObject.getCall(0).args[0], { Bucket: "B", Key: "K", Range: undefined });
		});

		it("S1 fromS3 finalizes a partial multipart upload on NoSuchKey and reads again", async function () {
			const failing = new Readable({ read() { const e: any = new Error("missing"); e.name = "NoSuchKey"; this.destroy(e); } });
			const getObject = sandbox.stub(s3, "getObject");
			getObject.onFirstCall().resolves({ Body: failing });
			getObject.onSecondCall().resolves({ Body: Readable.from([Buffer.from("recovered")]) });
			const finalize = sandbox.stub(ls, "tryFinalizeMultipartUpload").resolves();
			const text = await read(ls.fromS3({ bucket: "b", key: "k" }));
			assert.equal(text, "recovered");
			assert.equal(finalize.callCount, 1);
			assert.equal(getObject.callCount, 2);
		});

		it("S1 fromS3 passes the NoSuchKey error along when finalizing fails", async function () {
			const failing = new Readable({ read() { const e: any = new Error("missing"); e.name = "NoSuchKey"; this.destroy(e); } });
			sandbox.stub(s3, "getObject").resolves({ Body: failing });
			sandbox.stub(ls, "tryFinalizeMultipartUpload").rejects(new Error("no uploads"));
			let err: any;
			try { await read(ls.fromS3({ bucket: "b", key: "k" })); } catch (e) { err = e; }
			assert.equal(err.message, "missing");
		});

		it("S1 fromS3 passes other errors along", async function () {
			const failing = new Readable({ read() { this.destroy(new Error("network")); } });
			sandbox.stub(s3, "getObject").resolves({ Body: failing });
			let err: any;
			try { await read(ls.fromS3({ bucket: "b", key: "k" })); } catch (e) { err = e; }
			assert.equal(err.message, "network");
		});

		it("S1 tryFinalizeMultipartUpload completes the first upload with its listed parts", async function () {
			sandbox.stub(s3, "listMultipartUploads").resolves({ Uploads: [{ Key: "bus/k", UploadId: "u1" }] });
			const listParts = sandbox.stub(s3, "listParts").resolves({ Parts: [{ ETag: "e1", PartNumber: 1, Size: 5 }, { ETag: "e2", PartNumber: 2, Size: 5 }] });
			const complete = sandbox.stub(s3, "completeMultipartUpload").resolves({});
			await ls.tryFinalizeMultipartUpload({ bucket: "b", key: "bus/k" });
			assert.deepEqual(s3.listMultipartUploads.getCall(0).args[0], { Bucket: "b", Prefix: "bus/k" });
			assert.deepEqual(listParts.getCall(0).args[0], { Bucket: "b", Key: "bus/k", UploadId: "u1" });
			assert.deepEqual(complete.getCall(0).args[0], {
				Bucket: "b", Key: "bus/k", UploadId: "u1",
				MultipartUpload: { Parts: [{ ETag: "e1", PartNumber: 1 }, { ETag: "e2", PartNumber: 2 }] }
			});
		});

		it("S1 tryFinalizeMultipartUpload does nothing without uploads or parts", async function () {
			const list = sandbox.stub(s3, "listMultipartUploads");
			const complete = sandbox.stub(s3, "completeMultipartUpload").resolves({});
			list.onFirstCall().resolves({ Uploads: [] });
			await ls.tryFinalizeMultipartUpload({ Bucket: "b", Key: "k" });
			list.onSecondCall().resolves({ Uploads: [{ Key: "k", UploadId: "u" }] });
			sandbox.stub(s3, "listParts").resolves({ Parts: [] });
			await ls.tryFinalizeMultipartUpload({ Bucket: "b", Key: "k" });
			assert.equal(complete.callCount, 0);
		});
	});

	describe("S2 toS3", function () {
		it("S2 toS3 uploads written chunks with the bucket and key", async function () {
			sandbox.restore();
			build({}, false);
			const sent: any[] = [];
			sandbox.stub(ls.s3, "send").callsFake(async (command: any) => { sent.push(command.input); return {}; });
			const stream = ls.toS3("bucket-1", "folder/file.gz");
			stream.write("hello ");
			await new Promise<void>((resolve, reject) => stream.end((err: any) => err ? reject(err) : resolve()));
			assert.equal(sent.length, 1);
			assert.equal(sent[0].Bucket, "bucket-1");
			assert.equal(sent[0].Key, "folder/file.gz");
			assert.equal(Buffer.from(sent[0].Body).toString(), "hello ");
		});

		it("S2 toS3 reports an upload failure through the error event and not the end callback", async function () {
			sandbox.restore();
			build({}, false);
			sandbox.stub(ls.s3, "send").rejects(new Error("access denied"));
			const stream = ls.toS3("bucket-1", "folder/file.gz");
			const errors: any[] = [];
			stream.on("error", (e: any) => errors.push(e));
			stream.write("hello");
			const endArg = await new Promise((resolve) => stream.end(resolve));
			assert.isUndefined(endArg);
			assert.isAtLeast(errors.length, 1);
			errors.forEach((e) => assert.equal(e.message, "access denied"));
		});
	});

	describe("W11 logSourceRead/logTargetWrite", function () {
		let checkpoint: sinon.SinonStub;
		beforeEach(() => {
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
			checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
		});

		it("W11 logSourceRead with two strings uses them as bot id and system", async function () {
			await new Promise<void>((resolve) => ls.logSourceRead("bot1", "sysA", 5, {}, resolve));
			assert.deepEqual(checkpoint.getCall(0).args.slice(0, 3), ["bot1", "system.sysA", {
				eid: 1700000000000, records: 5, started_timestamp: undefined, timestamp: 1700000000000, source_timestamp: 1700000000000
			}]);
		});

		it("W11 logSourceRead with one string takes the bot id from the registry", async function () {
			configure.registry.id = "registry-bot";
			await new Promise<void>((resolve) => ls.logSourceRead("sysA", 7, resolve));
			assert.equal(checkpoint.getCall(0).args[0], "registry-bot");
			assert.equal(checkpoint.getCall(0).args[1], "system.sysA");
			assert.equal(checkpoint.getCall(0).args[2].records, 7);
		});

		it("W11 logSourceRead applies subqueue and timestamps from the options", async function () {
			await new Promise<void>((resolve) => ls.logSourceRead("bot1", "sysA", 1, { subqueue: "sub", timestamp: 5, source_timestamp: 3 }, resolve));
			assert.equal(checkpoint.getCall(0).args[1], "system.sysA.sub");
			assert.deepEqual([checkpoint.getCall(0).args[2].started_timestamp, checkpoint.getCall(0).args[2].timestamp, checkpoint.getCall(0).args[2].source_timestamp], [5, 5, 3]);
		});

		it("W11 logSourceRead falls back to event_source_timestamp and defaults records to 0", async function () {
			await new Promise<void>((resolve) => ls.logSourceRead("bot1", "sysA", { event_source_timestamp: 9 }, resolve));
			assert.equal(checkpoint.getCall(0).args[2].source_timestamp, 9);
			assert.equal(checkpoint.getCall(0).args[2].records, 0);
		});

		it("W11 logTargetWrite puts a records event on the system queue", function () {
			const putEvent = sandbox.stub(ls, "putEvent").callsFake((id: string, event: string, obj: any, opts: any, cb: any) => cb());
			const cb = sandbox.stub();
			ls.logTargetWrite("bot1", "sysB", 12, {}, cb);
			assert.deepEqual(putEvent.getCall(0).args.slice(0, 4), ["bot1", "system.sysB", { records: 12 }, { metadata: { units: 12 } }]);
			assert.equal(cb.callCount, 1);
		});

		it("W11 logTargetWrite applies the subqueue", function () {
			const putEvent = sandbox.stub(ls, "putEvent").callsFake((id: string, event: string, obj: any, opts: any, cb: any) => cb());
			ls.logTargetWrite("bot1", "sysB", 1, { subqueue: "out" }, () => { });
			assert.equal(putEvent.getCall(0).args[1], "system.sysB.out");
		});
	});

	describe("W12 checkpoint and manual checkpoint", function () {
		it("W12 checkpoint tracks per-bot per-queue stats as events are visited", function () {
			sandbox.useFakeTimers({ now: 5000, toFake: ["Date"] });
			const stream = ls.checkpoint({});
			stream.visit({ id: "bot1", event: "q1", eid: "z/1", event_source_timestamp: 100, timestamp: 4000, units: 2 });
			stream.visit({ id: "bot1", event: "q1", eid: "z/2", event_source_timestamp: 50, timestamp: 4500 });
			assert.deepEqual(stream.getCheckpoint("bot1", "q1"), {
				eid: "z/2", units: 3, source_timestamp: 50, started_timestamp: 4500, ended_timestamp: 4500, start_eid: "z/1"
			});
		});

		it("W12 checkpoint keeps separate stats per queue", function () {
			const stream = ls.checkpoint({});
			stream.visit({ id: "bot1", event: "q1", eid: "z/1" });
			stream.visit({ id: "bot1", event: "q2", eid: "z/9" });
			assert.equal(stream.getCheckpoint("bot1", "q1").eid, "z/1");
			assert.equal(stream.getCheckpoint("bot1", "q2").eid, "z/9");
		});

		it("W12 checkpoint resets the stats after a checkpoint call", async function () {
			const stream = ls.checkpoint({});
			stream.visit({ id: "bot1", event: "q1", eid: "z/1" });
			await new Promise<void>((resolve) => stream.checkpoint(() => resolve()));
			assert.equal(stream.getCheckpoint("bot1", "q1").units, 0);
		});

		it("W12 checkpoint accepts params before the callback", async function () {
			const stream = ls.checkpoint({});
			stream.visit({ id: "bot1", event: "q1", eid: "z/1" });
			const err = await new Promise((resolve) => stream.checkpoint({ extra: 1 }, resolve));
			assert.notExists(err);
		});

		it("W12 toManualCheckpoint checkpoints what was written when finished", async function () {
			const checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			const stream = ls.toManualCheckpoint("bot1", {});
			stream.write({ id: "src", event: "queue1", eid: "z/1", payload: {}, event_source_timestamp: 5, timestamp: 6 });
			stream.write({ id: "src", event: "queue1", eid: "z/2", payload: {}, event_source_timestamp: 7, timestamp: 8 });
			await new Promise((r) => setTimeout(r, 20));
			assert.equal(stream.get("bot1", "queue1").eid, "z/2");
			await new Promise<void>((resolve) => stream.finish(() => resolve()));
			assert.equal(checkpoint.callCount, 1);
			assert.deepEqual(checkpoint.getCall(0).args.slice(0, 2), ["bot1", "queue1"]);
			assert.equal(checkpoint.getCall(0).args[2].eid, "z/2");
			assert.equal(checkpoint.getCall(0).args[2].records, 2);
		});

		it("W12 toManualCheckpoint flush checkpoints without ending", async function () {
			const checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			const stream = ls.toManualCheckpoint("bot1", {});
			stream.write({ id: "src", event: "queue1", eid: "z/1", payload: {}, event_source_timestamp: 5, timestamp: 6 });
			await new Promise((r) => setTimeout(r, 20));
			await new Promise<void>((resolve) => stream.flush(() => resolve()));
			assert.equal(checkpoint.callCount, 1);
			assert.equal(checkpoint.getCall(0).args[2].eid, "z/1");
		});
	});

	describe("W14 enrich and offload", function () {
		let checkpoint: sinon.SinonStub;
		beforeEach(() => {
			checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
		});

		it("W14 enrich reads the in queue, writes transformed events to the out queue and checkpoints", async function () {
			const fromLeo = sandbox.stub(ls, "fromLeo").callsFake(() => ls.eventstream.readArray(readEvents("in-q", 2)));
			await new Promise<void>((resolve, reject) => ls.enrich({
				id: "bot1", inQueue: "in-q", outQueue: "out-q", start: "z/start",
				transform: (payload: any, event: any, done: any) => done(null, { doubled: payload.n * 2 })
			}, (err: any) => err ? reject(err) : resolve()));
			assert.deepEqual(fromLeo.getCall(0).args.slice(0, 2), ["bot1", "in-q"]);
			assert.equal(fromLeo.getCall(0).args[2].start, "z/start");
			const sent = putRecords.getCalls().flatMap((c: any) => c.args[0].Records.flatMap((r: any) => decodeRecord(r.Data)));
			assert.deepEqual(sent.map((e: any) => [e.id, e.event, e.payload]), [["bot1", "out-q", { doubled: 0 }], ["bot1", "out-q", { doubled: 2 }]]);
			assert.equal(checkpoint.callCount, 1);
			assert.deepEqual(checkpoint.getCall(0).args.slice(0, 2), ["bot1", "in-q"]);
			assert.equal(checkpoint.getCall(0).args[2].eid, "z/2022/03/14/22/38/1647297513618-0000001");
			assert.equal(checkpoint.getCall(0).args[2].records, 2);
		});

		it("W14 enrich batches the input when opts.batch is set", async function () {
			sandbox.stub(ls, "fromLeo").callsFake(() => ls.eventstream.readArray(readEvents("in-q", 3)));
			const batches: any[] = [];
			await new Promise<void>((resolve, reject) => ls.enrich({
				id: "bot1", inQueue: "in-q", outQueue: "out-q", batch: { count: 2 },
				each: (payload: any, event: any, done: any) => { batches.push(payload); done(null, true); }
			}, (err: any) => err ? reject(err) : resolve()));
			assert.deepEqual(batches.map((b) => b.length), [2, 1]);
		});

		it("W14 offload hands each event to the handler and checkpoints the in queue", async function () {
			const fromLeo = sandbox.stub(ls, "fromLeo").callsFake(() => ls.eventstream.readArray(readEvents("in-q", 3)));
			const seen: any[] = [];
			await new Promise<void>((resolve, reject) => ls.offload({
				id: "bot1", inQueue: "in-q",
				each: (payload: any, event: any, done: any) => { seen.push(payload); done(null, true); }
			}, (err: any) => err ? reject(err) : resolve()));
			assert.equal(fromLeo.getCall(0).args[1], "in-q");
			assert.deepEqual(seen, [{ n: 0 }, { n: 1 }, { n: 2 }]);
			assert.equal(checkpoint.getCall(0).args[1], "in-q");
			assert.equal(checkpoint.getCall(0).args[2].records, 3);
		});

		it("W14 offload with a batch size passes arrays of payloads to the handler", async function () {
			sandbox.stub(ls, "fromLeo").callsFake(() => ls.eventstream.readArray(readEvents("in-q", 4)));
			const seen: any[] = [];
			await new Promise<void>((resolve, reject) => ls.offload({
				queue: "in-q", id: "bot1", batch: 2,
				transform: (payload: any, event: any, done: any) => { seen.push(payload); done(null, true); }
			}, (err: any) => err ? reject(err) : resolve()));
			assert.deepEqual(seen.map((b) => b.map((e: any) => e.payload)), [[{ n: 0 }, { n: 1 }], [{ n: 2 }, { n: 3 }]]);
			assert.equal(checkpoint.getCall(0).args[2].eid, "z/2022/03/14/22/38/1647297513618-0000003");
		});

		it("W14 offload drops events when the batch map callback returns nothing", async function () {
			sandbox.stub(ls, "fromLeo").callsFake(() => ls.eventstream.readArray(readEvents("in-q", 3)));
			const seen: any[] = [];
			await new Promise<void>((resolve, reject) => ls.offload({
				id: "bot1", inQueue: "in-q",
				batch: { size: 1, map: (payload: any, meta: any, done: any) => done(null, payload.n === 1 ? null : payload) },
				each: (payload: any, event: any, done: any) => { seen.push(payload); done(null, true); }
			}, (err: any) => err ? reject(err) : resolve()));
			assert.deepEqual(seen, [{ n: 0 }, { n: 2 }]);
		});

		function decodeRecord(data: Buffer) {
			return decodeGzipRecord(data);
		}
	});

	describe("W15 process flush", function () {
		it("W15 a flush function can push an aggregate event correlated to the last event", async function () {
			const out = await collect(ls.process("bot1", (payload: any, event: any, done: any) => done(null, true), "out-q", function (this: any, done: any) {
				this.push({ summary: true });
				done();
			}), readEvents("in-q", 2).map((e) => ({ ...e, units: 1 })));
			const last = out[out.length - 1];
			assert.deepEqual(last, {
				id: "bot1", event: "out-q", payload: { summary: true },
				event_source_timestamp: 1001,
				correlation_id: { source: "in-q", start: "z/2022/03/14/22/38/1647297513618-0000001", units: 1 }
			});
		});

		it("W15 a flush callback result is pushed with its options", async function () {
			const out = await collect(ls.process("bot1", (payload: any, event: any, done: any) => done(null, true), "out-q", (done: any) => done(null, { total: 2 }, { queue: "totals", partial: true })), readEvents("in-q", 1));
			const last = out[out.length - 1];
			assert.equal(last.event, "totals");
			assert.deepEqual(last.payload, { total: 2 });
			assert.equal(last.correlation_id.partial_start, "z/2022/03/14/22/38/1647297513618-0000000");
		});

		it("W15 a flush error fails the stream", async function () {
			let err: any;
			try {
				await collect(ls.process("bot1", (payload: any, event: any, done: any) => done(null, true), "out-q", (done: any) => done(new Error("flush failed"))), readEvents("in-q", 1));
			} catch (e) { err = e; }
			assert.equal(err.message, "flush failed");
		});

		it("W15 outQueue may be the flush function", async function () {
			const flush = sandbox.stub().callsFake(function (this: any, done: any) { done(); });
			await collect(ls.process("bot1", (payload: any, event: any, done: any) => done(null, true), flush), readEvents("in-q", 1));
			assert.equal(flush.callCount, 1);
		});
	});

	describe("C5 client configuration", function () {
		it("C5 awsResourceConfig maps httpOptions and maxRetries onto each client", async function () {
			sandbox.restore();
			build({
				awsResourceConfig: {
					s3Config: { httpOptions: { connectTimeout: 111, timeout: 222 }, maxRetries: 4 },
					kinesisConfig: { maxRetries: 2 },
					firehoseConfig: { maxRetries: 6 },
					dynamodbConfig: { maxRetries: 1 }
				}
			});
			assert.equal(await ls.s3.config.maxAttempts(), 5);
			assert.equal(await ls.kinesis.config.maxAttempts(), 3);
			assert.equal(await ls.firehose.config.maxAttempts(), 7);
			assert.equal(await ls.dynamodb.docClient.config.maxAttempts(), 2);
		});

		it("C5 an explicit request handler is kept when httpOptions is also given", function () {
			sandbox.restore();
			const handler = { handle: () => { }, metadata: { handlerProtocol: "http/1.1" } };
			build({ awsResourceConfig: { s3Config: { httpOptions: { timeout: 1 }, requestHandler: handler } } });
			assert.exists(ls.s3);
		});

		it("C5 the onUpdate listener throws a TypeError because v3 client configs have no update function", function () {
			assert.isAtLeast(onUpdateCallbacks.length, 1);
			assert.throws(() => onUpdateCallbacks[0]({ aws: { region: "eu-west-1" }, credentials: {} }), TypeError);
		});
	});
});
