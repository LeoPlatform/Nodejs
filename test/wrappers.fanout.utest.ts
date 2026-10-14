import sinon from "sinon";
import { expect, assert } from "chai";
import { Lambda } from "@aws-sdk/client-lambda";
import childProcess from "child_process";

const leo = require("../index.js");
const fanout = require("../wrappers/fanout.js");

describe("wrappers/fanout.js", function () {
	const sandbox = sinon.createSandbox();
	const originals: any = {};
	let originalCheckpoint: sinon.SinonStub;
	let originalCheckLock: sinon.SinonStub;
	let originalReportComplete: sinon.SinonStub;
	let originalFromLeo: sinon.SinonStub;
	let envKeys = ["FANOUT_iid", "FANOUT_icount", "FANOUT_maxeid", "AWS_LAMBDA_FUNCTION_NAME", "AWS_LAMBDA_FUNCTION_VERSION", "AWS_DEFAULT_REGION"];
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		originals.fromLeo = leo.streams.fromLeo;
		originals.read = leo.read;
		originals.checkpoint = leo.bot.checkpoint;
		originals.checkLock = leo.bot.checkLock;
		originals.reportComplete = leo.bot.reportComplete;
		savedEnv = {};
		envKeys.forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });

		originalCheckpoint = sandbox.stub().callsFake((id, event, params, done) => done());
		originalCheckLock = sandbox.stub().callsFake((cron, runid, remaining, cb) => cb(null, { original: true }));
		originalReportComplete = sandbox.stub().callsFake((cron, runid, status, log, opts, cb) => cb(null, { original: true }));
		originalFromLeo = sandbox.stub();
		sandbox.stub(childProcess, "fork").throws(new Error("fanout test must not fork a process"));
		leo.bot.checkpoint = originalCheckpoint;
		leo.bot.checkLock = originalCheckLock;
		leo.bot.reportComplete = originalReportComplete;
		leo.streams.fromLeo = originalFromLeo;
	});

	afterEach(() => {
		leo.streams.fromLeo = originals.fromLeo;
		leo.read = originals.read;
		leo.bot.checkpoint = originals.checkpoint;
		leo.bot.checkLock = originals.checkLock;
		leo.bot.reportComplete = originals.reportComplete;
		envKeys.forEach((k) => {
			if (savedEnv[k] === undefined) { delete process.env[k]; } else { process.env[k] = savedEnv[k]; }
		});
		sandbox.restore();
	});

	function context(remaining = 60000) {
		return { getRemainingTimeInMillis: () => remaining };
	}

	function workerEvent(iid: number, icount: number, extra: any = {}) {
		return { __cron: { iid, icount, maxeid: "z/2023/11/14/22/13/1700000000000", ...extra } };
	}

	function collect(stream) {
		return new Promise<any[]>((resolve, reject) => {
			leo.streams.pipe(stream, leo.streams.eventstream.writeArray((err, results) => err ? reject(err) : resolve(results)), (err) => err && reject(err));
		});
	}

	describe("process safety", function () {
		it("master with instances above 1 and no Lambda environment forks through child_process", async function () {
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
			const handler = fanout((event, ctx, cb) => cb(null), { instances: 2 });
			let err;
			try { await handler({ __cron: {} }, context()); } catch (e) { err = e; }
			assert.equal((childProcess.fork as sinon.SinonStub).callCount, 1);
			assert.match(err.message, /must not fork/);
		});
	});

	describe("reduceCheckpoints", function () {
		it("reduceCheckpoints returns the single worker checkpoints with eid set", function () {
			const result = fanout.reduceCheckpoints([{
				iid: 0,
				checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/2", records: 3 } }, write: {} } }
			}]);
			assert.deepEqual(result, [{
				bot1: { read: { "queue:q": { checkpoint: "z/2", records: 3, eid: "z/2" } }, write: {} }
			}]);
		});

		it("reduceCheckpoints keeps the lowest checkpoint across workers", function () {
			const result = fanout.reduceCheckpoints([
				{ checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/5", records: 1 } }, write: {} } } },
				{ checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/3", records: 2 } }, write: {} } } },
				{ checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/4", records: 3 } }, write: {} } } }
			]);
			assert.deepEqual(result[0].bot1.read["queue:q"], { checkpoint: "z/3", records: 2, eid: "z/3" });
		});

		it("reduceCheckpoints keeps the first worker checkpoint when it is already lowest", function () {
			const result = fanout.reduceCheckpoints([
				{ checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/1", records: 1 } }, write: {} } } },
				{ checkpoints: { bot1: { read: { "queue:q": { checkpoint: "z/9", records: 2 } }, write: {} } } }
			]);
			assert.deepEqual(result[0].bot1.read["queue:q"], { checkpoint: "z/1", records: 1, eid: "z/1" });
		});

		it("reduceCheckpoints takes write checkpoints from the first worker only", function () {
			const result = fanout.reduceCheckpoints([
				{ checkpoints: { bot1: { read: {}, write: { "queue:w": { checkpoint: "z/1" } } } } },
				{ checkpoints: { bot1: { read: {}, write: { "queue:w": { checkpoint: "z/0" } } } } }
			]);
			assert.deepEqual(result[0].bot1.write, { "queue:w": { checkpoint: "z/1" } });
		});

		it("reduceCheckpoints throws when any worker reported an error", function () {
			assert.throws(() => fanout.reduceCheckpoints([
				{ checkpoints: { bot1: { read: {}, write: {} } } },
				{ error: "worker failed" }
			]), "errors from sub lambdas");
		});

		it("reduceCheckpoints ignores empty worker responses", function () {
			assert.deepEqual(fanout.reduceCheckpoints([null, {}]), [{}]);
		});

		it("reduceCheckpoints throws a TypeError when a later worker has a queue the first lacks", function () {
			assert.throws(() => fanout.reduceCheckpoints([
				{ checkpoints: { bot1: { read: { "queue:a": { checkpoint: "z/1" } }, write: {} } } },
				{ checkpoints: { bot1: { read: { "queue:b": { checkpoint: "z/2" } }, write: {} } } }
			]), TypeError);
		});
	});

	describe("callCheckpointOnResponses", function () {
		it("callCheckpointOnResponses checkpoints read then write queues with the type set", function (done) {
			const checkpoint = sandbox.stub().callsFake((id, queue, params, cb) => cb(null, "ok"));
			fanout.callCheckpointOnResponses(checkpoint, (err, results) => {
				assert.isNull(err);
				assert.deepEqual(results, ["ok", "ok"]);
				assert.equal(checkpoint.callCount, 2);
				assert.deepEqual(checkpoint.getCall(0).args.slice(0, 3), ["bot1", "queue:r", { checkpoint: "z/2", records: 4, eid: "z/2", type: "read" }]);
				assert.deepEqual(checkpoint.getCall(1).args.slice(0, 3), ["bot1", "queue:w", { checkpoint: "z/7", type: "write" }]);
				done();
			})([{ checkpoints: { bot1: { read: { "queue:r": { checkpoint: "z/2", records: 4 } }, write: { "queue:w": { checkpoint: "z/7" } } } } }]);
		});

		it("callCheckpointOnResponses calls back true when no worker processed events", function (done) {
			const checkpoint = sandbox.stub();
			fanout.callCheckpointOnResponses(checkpoint, (err, result) => {
				assert.isNull(err);
				assert.isTrue(result);
				assert.equal(checkpoint.callCount, 0);
				done();
			})([{ checkpoints: {} }]);
		});

		it("callCheckpointOnResponses only checkpoints the first bot", function (done) {
			const checkpoint = sandbox.stub().callsFake((id, queue, params, cb) => cb());
			fanout.callCheckpointOnResponses(checkpoint, () => {
				assert.deepEqual(checkpoint.getCalls().map((c) => c.args[0]), ["bot1"]);
				done();
			})([{
				checkpoints: {
					bot1: { read: { "queue:r": { checkpoint: "z/1" } }, write: {} },
					bot2: { read: { "queue:r": { checkpoint: "z/1" } }, write: {} }
				}
			}]);
		});

		it("callCheckpointOnResponses reports a checkpoint failure", function (done) {
			const checkpoint = sandbox.stub().callsFake((id, queue, params, cb) => cb("Stale Checkpoint"));
			fanout.callCheckpointOnResponses(checkpoint, (err) => {
				assert.equal(err, "Stale Checkpoint");
				done();
			})([{ checkpoints: { bot1: { read: { "queue:r": { checkpoint: "z/1" } }, write: {} } } }]);
		});
	});

	describe("eventPartition hashing", function () {
		async function readThroughWorker(iid: number, icount: number, events: any[], partition?: any, maxOverride?: any) {
			const reader: any = leo.streams.eventstream.readArray(events);
			reader.checkpoint = () => "cp";
			reader.get = () => "got";
			originalFromLeo.returns(reader);
			leo.streams.fromLeo = originalFromLeo;
			let readerOut: any;
			let stream: any;
			const inner = fanout((event, ctx, cb) => {
				stream = leo.streams.fromLeo("bot1", "queue:q", { maxOverride });
				collect(stream).then((r) => { readerOut = r; cb(null, "done"); }, cb);
			}, partition, { instances: icount });
			await inner(workerEvent(iid, icount), context());
			return { out: readerOut, stream };
		}

		it("string eventPartition values are hashed and only the matching instance processes the event", async function () {
			const events = [{ eid: "e1", k: "a" }, { eid: "e2", k: "b" }, { eid: "e3", k: "c" }];
			const part = (e) => e.k;
			assert.deepEqual((await readThroughWorker(1, 3, events, part)).out.map((e) => e.eid), ["e1"]);
			assert.deepEqual((await readThroughWorker(2, 3, events, part)).out.map((e) => e.eid), ["e2"]);
		});

		it("numeric and array partition values hash to their value and the sum of their parts", async function () {
			const events = [{ eid: "n", k: 100 }, { eid: "arr", k: ["a", "b"] }];
			const part = (e) => e.k;
			assert.deepEqual((await readThroughWorker(1, 3, events, part)).out.map((e) => e.eid), ["n"]);
			assert.deepEqual((await readThroughWorker(2, 3, events, part)).out, []);
		});

		it("partition defaults to the event eid and handles negative hashes", async function () {
			const events = [{ eid: "order-1" }, { eid: "order-2" }, { eid: "order-3" }, { eid: "order-4" }];
			assert.deepEqual((await readThroughWorker(1, 3, events)).out.map((e) => e.eid), ["order-2"]);
			assert.deepEqual((await readThroughWorker(2, 3, events)).out.map((e) => e.eid), ["order-1", "order-4"]);
		});

		it("a partition object argument supplies eventPartition", async function () {
			const events = [{ eid: "e1", k: "a" }, { eid: "e2", k: "b" }];
			const reader: any = leo.streams.eventstream.readArray(events);
			originalFromLeo.returns(reader);
			let out;
			await fanout((event, ctx, cb) => {
				collect(leo.streams.fromLeo("bot1", "queue:q")).then((r) => { out = r; cb(null); }, cb);
			}, { eventPartition: (e) => e.k, instances: 3 })(workerEvent(2, 3), context());
			assert.deepEqual(out.map((e) => e.eid), ["e2"]);
		});

		it("the wrapped reader keeps the original checkpoint and get functions", async function () {
			const { stream } = await readThroughWorker(1, 2, [{ eid: "e1" }]);
			assert.equal(stream.checkpoint(), "cp");
			assert.equal(stream.get(), "got");
		});

		it("reads are capped at the lowest of the requested max and the master maxeid", async function () {
			await readThroughWorker(1, 2, [], undefined, undefined);
			assert.equal(originalFromLeo.getCall(0).args[2].maxOverride, "z/2023/11/14/22/13/1700000000000");
			await readThroughWorker(1, 2, [], undefined, "z/2020/01/01/00/00/1");
			assert.equal(originalFromLeo.getCall(1).args[2].maxOverride, "z/2020/01/01/00/00/1");
			await readThroughWorker(1, 2, [], undefined, "z/2030/01/01/00/00/1");
			assert.equal(originalFromLeo.getCall(2).args[2].maxOverride, "z/2023/11/14/22/13/1700000000000");
		});

		it("the override is installed on both leo.streams.fromLeo and leo.read", function () {
			fanout(() => { });
			assert.equal(leo.streams.fromLeo, leo.read);
			assert.notEqual(leo.read, originalFromLeo);
		});
	});

	describe("checkpoint/lock overrides", function () {
		it("checkLock runs the real lock check only on instance 0", function (done) {
			fanout(() => { });
			leo.bot.checkLock({ iid: 0 }, "run1", 1000, (err, data) => {
				assert.deepEqual(data, { original: true });
				assert.deepEqual(originalCheckLock.getCall(0).args.slice(0, 3), [{ iid: 0 }, "run1", 1000]);
				done();
			});
		});

		it("checkLock is a no-op on worker instances", function (done) {
			fanout(() => { });
			leo.bot.checkLock({ iid: 2 }, "run1", 1000, (err, data) => {
				assert.isNull(err);
				assert.deepEqual(data, {});
				assert.equal(originalCheckLock.callCount, 0);
				done();
			});
		});

		it("checkLock takes the instance from FANOUT_iid when running locally", function (done) {
			fanout(() => { });
			process.env.FANOUT_iid = "3";
			process.env.FANOUT_icount = "4";
			process.env.FANOUT_maxeid = "z/9";
			const cron: any = { iid: 0 };
			leo.bot.checkLock(cron, "run1", 1000, (err, data) => {
				assert.deepEqual(data, {});
				assert.equal(cron.iid, 3);
				assert.equal(cron.icount, 4);
				assert.equal(cron.maxeid, "z/9");
				assert.equal(originalCheckLock.callCount, 0);
				done();
			});
		});

		it("reportComplete reports only from instance 0", function (done) {
			fanout(() => { });
			leo.bot.reportComplete({ iid: 0 }, "run1", "complete", "", {}, (err, data) => {
				assert.deepEqual(data, { original: true });
				assert.equal(originalReportComplete.callCount, 1);
				leo.bot.reportComplete({ iid: 1 }, "run1", "complete", "", {}, (err2, data2) => {
					assert.deepEqual(data2, {});
					assert.equal(originalReportComplete.callCount, 1);
					done();
				});
			});
		});

		it("options passed as a third argument are ignored when eventPartition is not a function", function () {
			fanout(() => { }, undefined, { allowCheckpoint: true });
			assert.notEqual(leo.bot.checkpoint, originalCheckpoint);
		});

		it("options passed as a third argument are honored when eventPartition is a function", function () {
			fanout(() => { }, (e) => e.eid, { allowCheckpoint: true });
			assert.equal(leo.bot.checkpoint, originalCheckpoint);
		});

		it("allowCheckpoint leaves the real checkpoint function in place", function () {
			fanout(() => { }, { allowCheckpoint: true });
			assert.equal(leo.bot.checkpoint, originalCheckpoint);
		});

		it("checkpoint is captured for the master instead of written", async function () {
			let resolved;
			const handler = fanout((event, ctx, cb) => {
				leo.bot.checkpoint("bot1_reader", "queue:q", { eid: "z/1", units: 2, source_timestamp: 10, started_timestamp: 20, ended_timestamp: 30 }, () => {
					leo.bot.checkpoint("bot1", "queue:q", { kinesis_number: "k/2", records: 3 }, () => {
						leo.bot.checkpoint("bot1", "queue:w", { type: "write", eid: "z/9" }, () => cb(null, "data"));
					});
				});
			});
			resolved = await handler(workerEvent(1, 2), context());
			assert.equal(originalCheckpoint.callCount, 0);
			assert.deepEqual(resolved.checkpoints, {
				bot1: {
					read: {
						"queue:q": { records: 5, checkpoint: "k/2", source_timestamp: undefined, started_timestamp: undefined, ended_timestamp: undefined }
					},
					write: {
						"queue:w": { records: 0, checkpoint: "z/9", source_timestamp: undefined, started_timestamp: undefined, ended_timestamp: undefined }
					}
				}
			});
		});
	});

	describe("worker invocation", function () {
		it("worker returns error, checkpoints, data and iid and trims 3s from the remaining time", async function () {
			let remaining;
			const handler = fanout((event, ctx, cb) => {
				remaining = ctx.getRemainingTimeInMillis();
				cb(null, "worker-data");
			});
			const response = await handler(workerEvent(1, 2), context(10000));
			assert.equal(remaining, 7000);
			assert.deepEqual(response, { error: null, checkpoints: {}, data: "worker-data", iid: 1 });
		});

		it("worker resolves from a promise returned by the handler", async function () {
			const handler = fanout(() => Promise.resolve("promised"));
			const response = await handler(workerEvent(2, 3), context());
			assert.equal(response.data, "promised");
			assert.equal(response.iid, 2);
		});

		it("worker reports a rejected promise as the response error", async function () {
			const boom = new Error("handler failed");
			const handler = fanout(() => Promise.reject(boom));
			const response = await handler(workerEvent(1, 2), context());
			assert.equal(response.error, boom);
		});

		it("worker only responds once when the handler calls back and returns a promise", async function () {
			const handler = fanout((event, ctx, cb) => {
				cb(null, "first");
				return Promise.resolve("second");
			});
			const response = await handler(workerEvent(1, 2), context());
			assert.equal(response.data, "first");
		});

		it("FANOUT_ environment variables turn an unmarked event into a worker", async function () {
			process.env.FANOUT_iid = "2";
			process.env.FANOUT_icount = "4";
			process.env.FANOUT_maxeid = "z/local";
			let seen;
			const handler = fanout((event, ctx, cb) => { seen = event; cb(null, "x"); });
			const response = await handler({}, context());
			assert.deepEqual(seen, {});
			assert.equal(response.iid, 2);
		});
	});

	describe("master invocation", function () {
		beforeEach(() => {
			sandbox.useFakeTimers({ now: 1700000000000, toFake: ["Date"] });
		});

		it("master with a single instance runs the handler as iid 0 with the maxeid stamp", async function () {
			let seen;
			const handler = fanout((event, ctx, cb) => { seen = event.__cron; cb(null, "data"); }, { instances: 1 });
			const result = await handler({ __cron: { id: "bot1" } }, context());
			assert.deepEqual(seen, { id: "bot1", maxeid: "z/2023/11/14/22/13/1700000000000", iid: 0, icount: 1 });
			assert.isTrue(result);
		});

		it("master clamps instances to at least 1 and uses an instances function", async function () {
			let seen;
			const instances = sandbox.stub().returns(0);
			const handler = fanout((event, ctx, cb) => { seen = event.__cron.icount; cb(null); }, { instances });
			await handler({ __cron: { id: "bot1" } }, context());
			assert.equal(seen, 1);
			assert.equal(instances.getCall(0).args[0].__cron.id, "bot1");
			assert.equal(instances.getCall(0).args[1].id, "bot1");
		});

		it("master writes the reduced checkpoints through the real checkpoint function", async function () {
			const handler = fanout((event, ctx, cb) => {
				leo.bot.checkpoint("bot1", "queue:q", { eid: "z/5", units: 7, source_timestamp: 1 }, () => cb(null));
			}, { instances: 1 });
			const result = await handler({ __cron: { id: "bot1" } }, context());
			assert.equal(originalCheckpoint.callCount, 1);
			assert.deepEqual(originalCheckpoint.getCall(0).args.slice(0, 3), ["bot1", "queue:q", {
				records: 7,
				checkpoint: "z/5",
				source_timestamp: 1,
				started_timestamp: undefined,
				ended_timestamp: undefined,
				eid: "z/5",
				type: "read"
			}]);
		});

		it("master surfaces a handler error as a failure", async function () {
			const handler = fanout((event, ctx, cb) => cb(new Error("bad")), { instances: 1 });
			let err;
			try { await handler({ __cron: {} }, context()); } catch (e) { err = e; }
			assert.equal(err.message, "errors from sub lambdas");
		});

		it("master invokes the other instances through Lambda and merges their checkpoints", async function () {
			process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
			process.env.AWS_LAMBDA_FUNCTION_VERSION = "7";
			process.env.AWS_DEFAULT_REGION = "us-west-2";
			const invoke = sandbox.stub(Lambda.prototype, "invoke").callsFake((params: any, cb: any) => {
				const payload = JSON.parse(params.Payload);
				cb(null, {
					Payload: JSON.stringify({
						error: null,
						iid: payload.__cron.iid,
						checkpoints: { bot1: { read: { "queue:q": { checkpoint: `z/${10 - payload.__cron.iid}`, records: 1 } }, write: {} } }
					})
				});
			});
			const handler = fanout((event, ctx, cb) => {
				leo.bot.checkpoint("bot1", "queue:q", { eid: "z/8", units: 1 }, () => cb(null));
			}, { instances: 3 });
			await handler({ __cron: { id: "bot1" }, other: "keep" }, context());
			assert.equal(invoke.callCount, 2);
			const payloads = invoke.getCalls().map((c) => JSON.parse((c.args[0] as any).Payload));
			assert.deepEqual(payloads.map((p) => [p.__cron.iid, p.__cron.icount]).sort(), [[1, 3], [2, 3]]);
			assert.equal(payloads[0].other, "keep");
			const first: any = invoke.getCall(0).args[0];
			assert.equal(first.FunctionName, "my-fn");
			assert.equal(first.InvocationType, "RequestResponse");
			assert.equal(first.Qualifier, "7");
			assert.equal(originalCheckpoint.callCount, 1);
			assert.equal(originalCheckpoint.getCall(0).args[2].checkpoint, "z/8");
		});

		it("master fails when a Lambda instance returns a FunctionError", async function () {
			process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
			sandbox.stub(Lambda.prototype, "invoke").callsFake((params: any, cb: any) => cb(null, { FunctionError: "Unhandled", Payload: "boom" }));
			const handler = fanout((event, ctx, cb) => cb(null), { instances: 2 });
			let err;
			try { await handler({ __cron: {} }, context()); } catch (e) { err = e; }
			assert.equal(err, "boom");
		});

		it("master fails when the Lambda invoke itself errors", async function () {
			process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
			const boom = new Error("invoke failed");
			sandbox.stub(Lambda.prototype, "invoke").callsFake((params: any, cb: any) => cb(boom));
			const handler = fanout((event, ctx, cb) => cb(null), { instances: 2 });
			let err;
			try { await handler({ __cron: {} }, context()); } catch (e) { err = e; }
			assert.equal(err, boom);
		});

		it("master caps instances at maxInstances", async function () {
			process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
			const invoke = sandbox.stub(Lambda.prototype, "invoke").callsFake((params: any, cb: any) => cb(null, { Payload: "null" }));
			const handler = fanout((event, ctx, cb) => cb(null), { instances: 10, maxInstances: 3 });
			await handler({ __cron: {} }, context());
			assert.equal(invoke.callCount, 2);
		});
	});
});
