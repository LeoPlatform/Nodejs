import sinon from "sinon";
import { assert } from "chai";
import zlib from "zlib";
import { Writable } from "stream";
import utilFn from "../lib/stream/leo-stream";

describe("lib/stream/leo-stream.js write", function () {
	const sandbox = sinon.createSandbox();
	let ls: any;
	let configure: any;
	let putRecords: sinon.SinonStub;
	let putRecordBatch: sinon.SinonStub;
	let toS3Uploads: { bucket: string, key: string, chunks: Buffer[] }[];

	function build(extra: any = {}) {
		configure = {
			onUpdate: () => { },
			validate: () => { },
			resources: { LeoCron: "mock-LeoCron", LeoEvent: "mock-LeoEvent", LeoStream: "mock-LeoStream", LeoS3: "mock-leos3", LeoSettings: "mock-LeoSettings" },
			aws: { region: "us-west-2" },
			stream: "mock-stream",
			bus: { firehose: "mock-firehose" },
			...extra
		};
		ls = utilFn(configure);
		putRecords = sandbox.stub(ls.kinesis, "putRecords").callsFake((params: any, cb: any) => cb(null, { FailedRecordCount: 0, Records: params.Records.map(() => ({})) }));
		putRecordBatch = sandbox.stub(ls.firehose, "putRecordBatch").callsFake((params: any, cb: any) => cb(null, { FailedPutCount: 0 }));
		toS3Uploads = [];
		sandbox.stub(ls, "toS3").callsFake((bucket: string, key: string) => {
			const upload = { bucket, key, chunks: [] as Buffer[] };
			toS3Uploads.push(upload);
			return new Writable({
				write(chunk, enc, cb) { upload.chunks.push(Buffer.from(chunk)); cb(); }
			});
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

	function evt(n: number, extra: any = {}) {
		return { id: "bot1", event: "queue1", payload: { n }, event_source_timestamp: 1000 + n, timestamp: 2000 + n, ...extra };
	}

	function decodeGzipRecord(data: Buffer) {
		return zlib.gunzipSync(data).toString().trim().split("\n").map((l) => JSON.parse(l));
	}

	function write(events: any[], stream: any) {
		const out: any[] = [];
		return ls.pipeAsync(
			ls.eventstream.readArray(events),
			stream,
			ls.write({ hasCommands: false }, (o, done) => { out.push(o); done(); })
		).then(() => out);
	}

	function sink(events: any[], stream: any) {
		return ls.pipeAsync(ls.eventstream.readArray(events), stream);
	}

	describe("W1 toLeo to kinesis", function () {
		it("W1 toLeo sends one gzipped putRecords with the default partition and hash key", async function () {
			await write([evt(1), evt(2)], ls.toLeo("bot1", {}));
			assert.equal(putRecords.callCount, 1);
			const params = putRecords.getCall(0).args[0];
			assert.equal(params.StreamName, "mock-stream");
			assert.equal(params.Records.length, 1);
			assert.equal(params.Records[0].PartitionKey, "0");
			assert.equal(params.Records[0].ExplicitHashKey, "0");
			const events = decodeGzipRecord(params.Records[0].Data);
			assert.deepEqual(events.map((e) => e.payload), [{ n: 1 }, { n: 2 }]);
			assert.deepEqual(events.map((e) => e.eid), [0, 1]);
		});

		it("W1 toLeo emits a checkpoint command carrying the correlations after the write", async function () {
			const correlation = { source: "src", start: "z/1", end: "z/2", units: 2 };
			const out = await write([evt(1, { correlation_id: correlation })], ls.toLeo("bot1", {}));
			assert.equal(out.length, 1);
			assert.equal(out[0].__cmd, "checkpoint");
			assert.equal(out[0].id, "bot1");
			assert.deepEqual(out[0].correlations, [{
				src: { source: "src", start: "z/1", end: "z/2", records: 2, source_timestamp: 1001, timestamp: 2001 }
			}]);
		});

		it("W1 toLeo does not call kinesis when nothing is written", async function () {
			await write([], ls.toLeo("bot1", {}));
			assert.equal(putRecords.callCount, 0);
		});
	});

	describe("W6 useQueuePartition", function () {
		it("W6 uses the queue name as the partition key and drops the explicit hash key", async function () {
			await write([evt(1)], ls.toLeo("bot1", { useQueuePartition: true }));
			const record = putRecords.getCall(0).args[0].Records[0];
			assert.equal(record.PartitionKey, "queue1");
			assert.isUndefined(record.ExplicitHashKey);
		});

		it("W6 uses the first queue seen when events target several queues", async function () {
			await write([evt(1, { event: "qa" }), evt(2, { event: "qb" })], ls.toLeo("bot1", { useQueuePartition: true }));
			assert.equal(putRecords.getCall(0).args[0].Records[0].PartitionKey, "qa");
		});

		it("W6 partitions per record on queue only when the option is set", async function () {
			await write([evt(1, { event: "qa" })], ls.toLeo("bot1", {}));
			assert.equal(putRecords.getCall(0).args[0].Records[0].PartitionKey, "0");
		});

		it("W6 uses partition 0 with the option set and no queue stats", async function () {
			await write([], ls.toLeo("bot1", { useQueuePartition: true }));
			assert.equal(putRecords.callCount, 0);
		});
	});

	describe("W7 partitionHashKey", function () {
		it("W7 sends partitionHashKey as the string explicit hash key", async function () {
			await write([evt(1)], ls.toLeo("bot1", { partitionHashKey: 12345 }));
			assert.strictEqual(putRecords.getCall(0).args[0].Records[0].ExplicitHashKey, "12345");
		});

		it("W7 a zero partitionHashKey stays the string 0", async function () {
			await write([evt(1)], ls.toLeo("bot1", { partitionHashKey: 0 }));
			assert.strictEqual(putRecords.getCall(0).args[0].Records[0].ExplicitHashKey, "0");
		});

		it("W7 useQueuePartition takes precedence over partitionHashKey", async function () {
			await write([evt(1)], ls.toLeo("bot1", { partitionHashKey: 99, useQueuePartition: true }));
			const record = putRecords.getCall(0).args[0].Records[0];
			assert.isUndefined(record.ExplicitHashKey);
			assert.equal(record.PartitionKey, "queue1");
		});
	});

	describe("W8 backoff", function () {
		const fast = { backoff: { initialDelay: 1, maxDelay: 2 } };

		it("W8 retries the whole batch when putRecords errors", async function () {
			putRecords.onFirstCall().callsFake((p: any, cb: any) => cb(new Error("throttled")));
			await write([evt(1)], ls.toLeo("bot1", fast));
			assert.equal(putRecords.callCount, 2);
			assert.deepEqual(putRecords.getCall(0).args[0].Records.length, putRecords.getCall(1).args[0].Records.length);
		});

		it("W8 retries only the records that failed", async function () {
			sandbox.restore();
			build();
			putRecords.onFirstCall().callsFake((p: any, cb: any) => cb(null, { FailedRecordCount: 1, Records: [{ ErrorCode: "ProvisionedThroughputExceededException" }] }));
			await write([evt(1)], ls.toLeo("bot1", fast));
			assert.equal(putRecords.callCount, 2);
			assert.equal(putRecords.getCall(1).args[0].Records.length, 1);
		});

		it("W8 fails the stream after ten failed attempts", async function () {
			putRecords.callsFake((p: any, cb: any) => cb(new Error("always")));
			let err: any;
			try { await write([evt(1)], ls.toLeo("bot1", fast)); } catch (e) { err = e; }
			assert.exists(err);
			assert.isAtLeast(putRecords.callCount, 10);
		});
	});

	describe("W5 gzipFirehose", function () {
		const fh = { firehose: true, time: { milliseconds: 5 } };

		it("W5 sends raw newline-delimited json to firehose by default", async function () {
			await write([evt(1), evt(2)], ls.toLeo("bot1", fh));
			assert.equal(putRecords.callCount, 0);
			const params = putRecordBatch.getCall(0).args[0];
			assert.equal(params.DeliveryStreamName, "mock-firehose");
			assert.equal(params.Records.length, 1);
			const lines = params.Records[0].Data.toString().trim().split("\n").map((l: string) => JSON.parse(l));
			assert.deepEqual(lines.map((e: any) => e.payload), [{ n: 1 }, { n: 2 }]);
		});

		it("W5 gzipFirehose sends one base64 gzip chunk per line", async function () {
			await write([evt(1), evt(2)], ls.toLeo("bot1", { ...fh, gzipFirehose: true }));
			const data = putRecordBatch.getCall(0).args[0].Records[0].Data.toString();
			assert.isTrue(data.endsWith("\n"));
			const lines = data.trim().split("\n");
			assert.equal(lines.length, 1);
			const events = decodeGzipRecord(Buffer.from(lines[0], "base64"));
			assert.deepEqual(events.map((e) => e.payload), [{ n: 1 }, { n: 2 }]);
		});

		it("W5 firehose retries only the failed records of a partial failure", async function () {
			putRecordBatch.onFirstCall().callsFake((p: any, cb: any) => cb(null, { FailedPutCount: 1, RequestResponses: [{ ErrorCode: "ServiceUnavailableException" }] }));
			await write([evt(1)], ls.toLeo("bot1", { ...fh, backoff: { initialDelay: 1, maxDelay: 2 } }));
			assert.equal(putRecordBatch.callCount, 2);
		});

		it("W5 firehose retries after an error", async function () {
			putRecordBatch.onFirstCall().callsFake((p: any, cb: any) => cb(new Error("down")));
			await write([evt(1)], ls.toLeo("bot1", { ...fh, backoff: { initialDelay: 1, maxDelay: 2 } }));
			assert.equal(putRecordBatch.callCount, 2);
		});
	});

	describe("W3 useS3 and s3Opts", function () {
		it("W3 load with useS3 uploads to bus/<queue>/<botId>/z/ and sends the s3 pointer to kinesis", async function () {
			await sink([{ n: 1 }, { n: 2 }], ls.load("bot1", "queue1", { useS3: true }));
			assert.isAtLeast(toS3Uploads.length, 1);
			const upload = toS3Uploads.find((u) => u.chunks.length > 0)!;
			assert.equal(upload.bucket, "mock-leos3");
			assert.match(upload.key, /^bus\/queue1\/bot1\/z\/\d{4}\/\d\d\/\d\d\/\d\d\/\d\d\/\d+-0000001-[0-9a-f-]{36}\.gz$/);
			const stored = decodeGzipRecord(Buffer.concat(upload.chunks));
			assert.deepEqual(stored.map((e) => e.payload), [{ n: 1 }, { n: 2 }]);

			const pointers = putRecords.getCalls().flatMap((c: any) => c.args[0].Records.map((r: any) => decodeGzipRecord(r.Data)[0]));
			assert.equal(pointers.length, 1);
			assert.equal(pointers[0].s3.bucket, "mock-leos3");
			assert.equal(pointers[0].s3.key, upload.key);
			assert.equal(pointers[0].records, 2);
		});

		it("W3 prefix replaces the bot id in the S3 key", async function () {
			await sink([{ n: 1 }], ls.load("bot1", "queue1", { useS3: true, prefix: "custom" }));
			assert.match(toS3Uploads[0].key, /^bus\/queue1\/custom\/z\//);
		});

		it("W3 s3Opts can switch the file to the archive layout", async function () {
			await sink([{ n: 1 }], ls.load("bot1", "queue1", { useS3: true, s3Opts: { archive: true } }));
			assert.match(toS3Uploads[0].key, /^bus\/_archive\/q=queue1\/dt=\d{4}-\d\d-\d\d\/\d+-0000001-[0-9a-f-]{36}\.gz$/);
		});

		it("W3 s3Opts values override the defaults passed by load", async function () {
			await sink([{ n: 1 }], ls.load("bot1", "queue1", { useS3: true, s3Opts: { prefix: "from-s3-opts" } }));
			assert.match(toS3Uploads[0].key, /^bus\/queue1\/from-s3-opts\/z\//);
		});

		it("W3 toLeo with useS3 forwards an existing s3 pointer record to kinesis", async function () {
			await sink([{ id: "bot1", event: "queue1", payload: { n: 1 }, s3: { bucket: "b", key: "k" }, records: 1, size: 10, gzipSize: 10, start: 0, end: 0, stats: {}, correlations: [], offsets: [] }], ls.toLeo("bot1", { useS3: true }));
			assert.equal(putRecords.callCount, 1);
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data);
			assert.equal(sent[0].s3.key, "k");
		});
	});

	describe("W4 automatic S3 switch for large events", function () {
		const THRESHOLD = 1024 * 200 * 3;

		function sizedEvent(totalBytes: number) {
			const base = evt(1, { payload: { d: "" } });
			const baseSize = Buffer.byteLength(JSON.stringify(base));
			return evt(1, { payload: { d: "x".repeat(totalBytes - baseSize) } });
		}

		it("W4 an event below the threshold stays inline", async function () {
			const e = sizedEvent(THRESHOLD - 1000);
			await write([e], ls.toLeo("bot1", {}));
			assert.equal(toS3Uploads.length, 0);
			assert.equal(decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0].payload.d.length, e.payload.d.length);
		});

		it("W4 an event of exactly 614400 bytes is not moved to S3 but is replaced by an error event once the eid is added", async function () {
			const e = sizedEvent(THRESHOLD);
			assert.equal(Buffer.byteLength(JSON.stringify(e)), THRESHOLD);
			await write([e], ls.toLeo("bot1", {}));
			assert.equal(toS3Uploads.length, 0);
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.match(sent.payload.error, /^Event was too large \d+ > 614400$/);
			assert.equal(sent.payload.maxSize, THRESHOLD);
			assert.deepEqual([sent.event.type, sent.event.id], ["queue", "bot.bot1.error"]);
		});

		it("W4 an event of 614401 bytes is moved to S3 and replaced by a pointer", async function () {
			const e = sizedEvent(THRESHOLD + 1);
			await write([e], ls.toLeo("bot1", {}));
			const upload = toS3Uploads.find((u) => u.chunks.length > 0)!;
			assert.match(upload.key, /^bus\/queue1\/bot1\/z\//);
			const stored = decodeGzipRecord(Buffer.concat(upload.chunks));
			assert.equal(stored[0].payload.d.length, e.payload.d.length);
			const sent = putRecords.getCalls().flatMap((c: any) => c.args[0].Records.map((r: any) => decodeGzipRecord(r.Data)[0]));
			assert.equal(sent.length, 1);
			assert.equal(sent[0].s3.key, upload.key);
			assert.isUndefined(sent[0].payload);
		});

		it("W4 the S3 prefix defaults to the event id and honors opts.prefix", async function () {
			await write([sizedEvent(THRESHOLD + 1)], ls.toLeo("bot1", { prefix: "pre" }));
			assert.match(toS3Uploads[0].key, /^bus\/queue1\/pre\/z\//);
		});

		it("W4 load applies the same threshold before toLeo", async function () {
			const e = sizedEvent(THRESHOLD + 1);
			await sink([e], ls.load("bot1", "queue1", {}));
			assert.isAtLeast(toS3Uploads.length, 1);
			assert.match(toS3Uploads[0].key, /^bus\/queue1\/bot1\/z\//);
		});

		it("W4 load with firehose still moves large events to S3 through toLeo", async function () {
			const e = sizedEvent(THRESHOLD + 1);
			await sink([e], ls.load("bot1", "queue1", { firehose: true }));
			assert.equal(toS3Uploads.filter((u) => u.chunks.length > 0).length, 1);
		});
	});

	describe("W13 onCheckpoint", function () {
		function update(id: string, correlations: any[]) {
			return { id, correlations };
		}
		function corr(queue: string, start: string, end: string, records: number) {
			return { [queue]: { start, end, records, source_timestamp: 10, timestamp: 20 } };
		}

		let checkpoint: sinon.SinonStub;
		beforeEach(() => {
			checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
		});

		it("W13 a sync hook receives the checkpointed eid per bot and queue ref", async function () {
			const hook = sandbox.stub();
			await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({ onCheckpoint: hook }));
			assert.equal(hook.callCount, 1);
			assert.deepEqual(hook.getCall(0).args[0], { error: null, checkpoints: { bot1: { "queue:queue1": "z/5" } } });
		});

		it("W13 an async hook is awaited before the stream finishes", async function () {
			let finished = false;
			const hook = async () => { await new Promise((r) => setTimeout(r, 20)); finished = true; };
			await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({ onCheckpoint: hook }));
			assert.isTrue(finished);
		});

		it("W13 the hook sees the checkpoint error and the stream fails with it", async function () {
			checkpoint.callsFake((id: string, event: string, cp: any, cb: any) => cb("Stale Checkpoint"));
			const hook = sandbox.stub();
			let err: any;
			try {
				await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({ onCheckpoint: hook }));
			} catch (e) { err = e; }
			assert.equal(hook.getCall(0).args[0].error, "Stale Checkpoint");
			assert.exists(err);
		});

		it("W13 a hook that rejects fails the stream", async function () {
			const boom = new Error("hook failed");
			let err: any;
			try {
				await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({ onCheckpoint: async () => { throw boom; } }));
			} catch (e) { err = e; }
			assert.equal(err, boom);
		});

		it("W13 without a hook the checkpoint still runs", async function () {
			await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({}));
			assert.equal(checkpoint.callCount, 1);
			assert.deepEqual(checkpoint.getCall(0).args.slice(0, 3), ["bot1", "queue1", {
				eid: "z/5", records: 5, source_timestamp: 10, ended_timestamp: 20, started_timestamp: 20, force: undefined
			}]);
		});

		it("W13 force is carried on the checkpoint", async function () {
			await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5)])], ls.toCheckpoint({ force: true }));
			assert.isTrue(checkpoint.getCall(0).args[2].force);
		});

		it("W13 correlations for the same queue are merged and the last end wins", async function () {
			await sink([
				update("bot1", [corr("queue1", "z/1", "z/5", 5)]),
				update("bot1", [corr("queue1", "z/6", "z/9", 4)])
			], ls.toCheckpoint({}));
			assert.equal(checkpoint.callCount, 1);
			const cp = checkpoint.getCall(0).args[2];
			assert.equal(cp.eid, "z/9");
			assert.equal(cp.records, 9);
		});

		it("W13 a correlation_id on a plain event is converted to a correlation", async function () {
			await sink([{ id: "bot1", event: "queue2", payload: 1, event_source_timestamp: 5, timestamp: 8, correlation_id: { source: "queue1", start: "z/1", end: "z/3", units: 3 } }], ls.toCheckpoint({}));
			assert.deepEqual(checkpoint.getCall(0).args.slice(0, 3), ["bot1", "queue1", {
				eid: "z/3", records: 3, source_timestamp: 5, ended_timestamp: 8, started_timestamp: 8, force: undefined
			}]);
		});

		it("W13 the checkpoint is written for the last bot and queue seen for every task", async function () {
			await sink([update("bot1", [corr("queue1", "z/1", "z/5", 5), corr("queue2", "z/1", "z/7", 7)])], ls.toCheckpoint({}));
			assert.equal(checkpoint.callCount, 2);
			assert.deepEqual(checkpoint.getCalls().map((c: any) => c.args[1]), ["queue2", "queue2"]);
			assert.deepEqual(checkpoint.getCalls().map((c: any) => c.args[2].eid), ["z/7", "z/7"]);
		});

		it("W13 toCheckpoint get returns the pending checkpoint for a bot and queue", async function () {
			const stream = ls.toCheckpoint({ records: Number.POSITIVE_INFINITY, time: { days: 1 } });
			stream.write(update("bot1", [corr("queue1", "z/1", "z/5", 5)]));
			await new Promise((r) => setTimeout(r, 10));
			assert.equal(stream.get("bot1", "queue1").eid, "z/5");
			assert.isUndefined(stream.get("bot1"));
			assert.isUndefined(stream.get("bot9", "queue1"));
			await new Promise((r) => stream.end(r));
		});
	});

	describe("W2 load", function () {
		it("W2 load throws when the configuration is invalid", function () {
			build({ validate: undefined });
			assert.throws(() => ls.load("bot1", "queue1", {}), "Invalid Settings: Missing config");
		});

		it("W2 load wraps plain objects as payloads and fills id, event and timestamps", async function () {
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
			await sink([{ n: 1 }], ls.load("bot1", "queue1", {}));
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.equal(sent.id, "bot1");
			assert.equal(sent.event, "queue1");
			assert.deepEqual(sent.payload, { n: 1 });
			assert.equal(sent.event_source_timestamp, 1700000000000);
			assert.equal(sent.timestamp, 1700000000000);
		});

		it("W2 load keeps objects that already carry a payload and their id, event and timestamps", async function () {
			await sink([{ id: "other", event: "q9", payload: { a: 1 }, event_source_timestamp: 5, timestamp: 6 }], ls.load("bot1", "queue1", {}));
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.deepEqual([sent.id, sent.event, sent.event_source_timestamp, sent.timestamp], ["other", "q9", 5, 6]);
		});

		it("W2 load treats an object with a correlation_id as an event", async function () {
			sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			await sink([{ correlation_id: { source: "s", start: "z/1" }, payload: { a: 1 } }], ls.load("bot1", "queue1", {}));
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.equal(sent.correlation_id.source, "s");
		});

		it("W2 load with autoDetectPayload false always wraps the object", async function () {
			await sink([{ payload: { a: 1 } }], ls.load("bot1", "queue1", { autoDetectPayload: false }));
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.deepEqual(sent.payload, { payload: { a: 1 } });
		});

		it("W2 load with autoCheckpoint false does not checkpoint", async function () {
			const checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			await sink([{ id: "bot1", event: "queue1", payload: 1, correlation_id: { source: "s", start: "z/1", end: "z/1" } }], ls.load("bot1", "queue1", { autoCheckpoint: false }));
			assert.equal(checkpoint.callCount, 0);
		});

		it("W2 load checkpoints the correlation sources by default", async function () {
			const checkpoint = sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			await sink([{ id: "bot1", event: "queue1", payload: 1, correlation_id: { source: "src", start: "z/1", end: "z/1" } }], ls.load("bot1", "queue1", {}));
			assert.equal(checkpoint.callCount, 1);
			assert.equal(checkpoint.getCall(0).args[0], "bot1");
			assert.equal(checkpoint.getCall(0).args[1], "src");
			assert.equal(checkpoint.getCall(0).args[2].eid, "z/1");
		});

		it("W2 load calls the onCheckpoint hook", async function () {
			sandbox.stub(ls.cron, "checkpoint").callsFake((id: string, event: string, cp: any, cb: any) => cb());
			const hook = sandbox.stub();
			await sink([{ id: "bot1", event: "queue1", payload: 1, correlation_id: { source: "src", start: "z/1", end: "z/1" } }], ls.load("bot1", "queue1", { onCheckpoint: hook }));
			assert.equal(hook.callCount, 1);
			assert.deepEqual(hook.getCall(0).args[0].checkpoints, { bot1: { "queue:src": "z/1" } });
		});

		it("W2 putEvent writes the object through load and calls back", async function () {
			const err = await new Promise((resolve) => ls.putEvent("bot1", "queue1", { n: 7 }, {}, resolve));
			assert.isUndefined(err);
			const sent = decodeGzipRecord(putRecords.getCall(0).args[0].Records[0].Data)[0];
			assert.deepEqual(sent.payload, { n: 7 });
		});

		it("W2 putEvent accepts the callback in place of options", async function () {
			await new Promise((resolve) => ls.putEvent("bot1", "queue1", { n: 8 }, resolve));
			assert.equal(putRecords.callCount, 1);
		});
	});
});
