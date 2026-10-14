import sinon from "sinon";
import { expect, assert } from "chai";
import zlib from "zlib";
import cronLib from "../lib/cron";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

describe("lib/cron.js lifecycle", function () {
	const sandbox = sinon.createSandbox();

	function build(doc: Record<string, any>, registry?: any) {
		const wrapped = DynamoDBDocument.from as any;
		if (wrapped.restore) {
			wrapped.restore();
		}
		sandbox.stub(DynamoDBDocument, "from").returns(doc as unknown as DynamoDBDocument);
		const configure: any = {
			onUpdate: () => { },
			resources: { LeoCron: "MockLeoCron", LeoSettings: "MockLeoSettings", LeoSystem: "MockLeoSystem" },
			aws: {},
			registry
		};
		return { cron: (cronLib as any)(configure), configure };
	}

	beforeEach(() => {
		delete global.cron_run_again;
		delete global.preventRunAgain;
		delete process["__config"];
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe("update", function () {
		it("update merges the bot onto the stored cron row and resolves Success", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "b1", name: "old", paused: false } }));
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, put });
			const result = await cron.update({ id: "b1", name: "new" });
			assert.equal(result, "Success");
			assert.equal(get.getCall(0).args[0].TableName, "MockLeoCron");
			assert.deepEqual(put.getCall(0).args[0].Item, { id: "b1", name: "new", paused: false });
		});

		it("update also invokes the callback", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, put });
			const cbArgs = await new Promise<any[]>((resolve) => {
				cron.update({ id: "b1" }, (...args) => resolve(args));
			});
			assert.deepEqual(cbArgs, [null, "Success"]);
		});

		it("update rejects and calls back with the failure", async function () {
			const boom = new Error("get failed");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const { cron } = build({ get });
			const cb = sandbox.stub();
			let err;
			try { await cron.update({ id: "b1" }, cb); } catch (e) { err = e; }
			assert.equal(err, boom);
			assert.equal(cb.getCall(0).args[0], boom);
		});
	});

	describe("subscribe/createBot", function () {
		it("subscribe requires id and queue", async function () {
			const { cron } = build({});
			let err;
			try { await cron.subscribe("", "q"); } catch (e) { err = e; }
			assert.equal(err.message, "'id' and 'queue' are required");
			err = undefined;
			try { await cron.subscribe("bot1"); } catch (e) { err = e; }
			assert.equal(err.message, "'id' and 'queue' are required");
		});

		it("subscribe creates a bot that triggers on the queue and resolves the bot ref", async function () {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ update });
			const result = await cron.subscribe("bot1", "q1", { name: "My Bot" });
			assert.deepEqual(result, { refId: "bot:bot1" });
			const params = update.getCall(0).args[0];
			assert.equal(params.TableName, "MockLeoCron");
			assert.deepEqual(params.Key, { id: "bot1" });
			assert.equal(params.ExpressionAttributeValues[":name"], "My Bot");
			assert.equal(params.ExpressionAttributeValues[":lambdaName"], "bot1");
			assert.equal(params.ExpressionAttributeValues[":executionType"], "lambda");
			assert.deepEqual(params.ExpressionAttributeValues[":triggers"], ["q1", "queue:q1"]);
			assert.deepEqual(params.ExpressionAttributeValues[":checkpoints"], {
				read: { "queue:q1": {} },
				write: {}
			});
			assert.deepEqual(params.ExpressionAttributeValues[":lambda"], { settings: [{ source: "q1" }] });
			assert.include(params.UpdateExpression, "#instances = if_not_exists(#instances, :instances)");
			assert.include(params.UpdateExpression, "#checkpoints = if_not_exists(#checkpoints, :checkpoints)");
			assert.include(params.UpdateExpression, "#requested_kinesis = if_not_exists(#requested_kinesis, :requested_kinesis)");
			assert.include(params.UpdateExpression, "#name = :name");
		});

		it("subscribe accepts an array of queues as triggers", async function () {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ update });
			await cron.subscribe("bot1", ["q1", "q2"]);
			const values = update.getCall(0).args[0].ExpressionAttributeValues;
			assert.deepEqual(values[":triggers"], ["q1", "q2", "queue:q1,q2"]);
		});

		it("createBot builds write checkpoints from the destination and skips source trigger when settings.time is set", async function () {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ update });
			await cron.createBot("bot1", {
				triggers: ["t1"],
				settings: { source: "src", destination: "dest", time: "0 * * * *" }
			});
			const values = update.getCall(0).args[0].ExpressionAttributeValues;
			assert.deepEqual(values[":triggers"], ["t1"]);
			assert.deepEqual(values[":checkpoints"], {
				read: { "queue:t1": {}, "queue:src": {} },
				write: { "queue:dest": {} }
			});
		});

		it("createBot rejects when the dynamodb update fails", async function () {
			const boom = new Error("update failed");
			const update = sandbox.stub().callsFake((p, cb) => cb(boom));
			const { cron } = build({ update });
			let err;
			try { await cron.createBot("bot1", { settings: {} }); } catch (e) { err = e; }
			assert.equal(err, boom);
		});

		it("createBot merges caller opts into the update options", async function () {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ update });
			await cron.createBot("bot1", { settings: {} }, { ReturnValues: "ALL_NEW" });
			assert.equal(update.getCall(0).args[0].ReturnValues, "ALL_NEW");
		});
	});

	describe("runAgain/setMessage/getLastResult", function () {
		it("runAgain sets the global run-again flag", function () {
			const { cron } = build({});
			assert.isUndefined(global.cron_run_again);
			cron.runAgain();
			assert.equal(global.cron_run_again, true);
		});

		it("setMessage wraps a string as a msg entry on the registry", function () {
			const { cron, configure } = build({});
			cron.setMessage("hello");
			assert.deepEqual(configure.registry.cron_message, [{ msg: "hello" }]);
		});

		it("setMessage stores non-string messages as given", function () {
			const { cron, configure } = build({});
			const msg = [{ msg: "a", level: "warn" }];
			cron.setMessage(msg);
			assert.equal(configure.registry.cron_message, msg);
		});

		it("getLastResult decodes the gzipped base64 result", function () {
			const encoded = zlib.gzipSync(JSON.stringify({ ok: true })).toString("base64");
			const { cron } = build({}, { __cron: { lastResult: encoded } });
			assert.deepEqual(cron.getLastResult(), { ok: true });
		});

		it("getLastResult returns null when there is no result", function () {
			const { cron } = build({}, { __cron: {} });
			assert.isNull(cron.getLastResult());
		});
	});

	describe("getAttachedSystem/getAttachedSystemByAlias", function () {
		const systems = {
			s1: { id: "s1", aliases: ["source", "default"] },
			s2: { id: "s2", aliases: ["destination"] }
		};

		it("getAttachedSystem looks up by system id", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.equal(cron.getAttachedSystem("s2"), systems.s2);
		});

		it("getAttachedSystem strips a system. prefix", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.equal(cron.getAttachedSystem("system.s1"), systems.s1);
		});

		it("getAttachedSystem accepts a system: reference", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.equal(cron.getAttachedSystem("system:s1"), systems.s1);
		});

		it("getAttachedSystem returns undefined for an unknown system or no registry", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.isUndefined(cron.getAttachedSystem("nope"));
			delete process["__config"];
			const other = build({});
			assert.isUndefined(other.cron.getAttachedSystem("s1"));
		});

		it("getAttachedSystemByAlias returns the first system carrying the alias", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.equal(cron.getAttachedSystemByAlias("destination"), systems.s2);
			assert.equal(cron.getAttachedSystemByAlias("default"), systems.s1);
		});

		it("getAttachedSystemByAlias returns undefined when no alias matches", function () {
			const { cron } = build({}, { __cron: { systems } });
			assert.isUndefined(cron.getAttachedSystemByAlias("missing"));
			delete process["__config"];
			const other = build({});
			assert.isUndefined(other.cron.getAttachedSystemByAlias("source"));
		});
	});

	describe("get/buildPayloads", function () {
		it("get builds a payload for a stored bot and registers checkpoints", async function () {
			const row = {
				id: "b1",
				name: "Bot One",
				lambdaName: "lam",
				trigger: 111,
				instances: { "0": {} },
				checkpoints: { read: { "queue:q1": { checkpoint: "z/1" } }, write: {} },
				lambda: { settings: [{ source: "queue:q1", batch: 5 }] }
			};
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: row }));
			const { cron, configure } = build({ get });
			sandbox.stub(Date, "now").returns(5000);
			const payload: any = await new Promise((resolve, reject) => cron.get("b1", {}, (err, d) => err ? reject(err) : resolve(d)));
			assert.deepEqual(get.getCall(0).args[0].Key, { id: "b1" });
			assert.deepEqual(payload.__cron, {
				id: "b1",
				name: "lam",
				ts: 111,
				time: 5000,
				checkpoints: row.checkpoints,
				botName: "Bot One",
				instances: row.instances,
				iid: "0"
			});
			assert.equal(payload.botId, "b1");
			assert.equal(payload.source, "queue:q1");
			assert.equal(payload.batch, 5);
			assert.deepEqual(configure.registry.__cron.checkpoints.read["queue:q1"], { checkpoint: "z/1" });
		});

		it("get applies overrides and the requested instance", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "b1", lambda: { settings: [{ a: 1 }] } } }));
			const { cron } = build({ get });
			const payload: any = await new Promise((resolve, reject) => cron.get("b1", { instance: 3, overrides: { a: 2, extra: true } }, (err, d) => err ? reject(err) : resolve(d)));
			assert.equal(payload.a, 2);
			assert.isTrue(payload.extra);
			assert.equal(payload.__cron.iid, "3");
		});

		it("get returns one payload per instance when instances is given", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "b1", namedSettings: { b: { flag: "B" } } } }));
			const { cron } = build({ get });
			const payloads: any[] = await new Promise((resolve, reject) => cron.get("b1", { instances: ["a", "b"] }, (err, d) => err ? reject(err) : resolve(d)));
			assert.equal(payloads.length, 2);
			assert.deepEqual(payloads.map((p) => p.__cron.iid), ["a", "b"]);
			assert.isUndefined(payloads[0].flag);
			assert.equal(payloads[1].flag, "B");
		});

		it("get falls back to a stub row when the bot does not exist", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get });
			const payload: any = await new Promise((resolve, reject) => cron.get("bot:b9", {}, (err, d) => err ? reject(err) : resolve(d)));
			assert.equal(payload.__cron.id, "b9");
			assert.equal(payload.botId, "b9");
		});

		it("get with register false leaves the registry alone", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "b1", checkpoints: { read: { q: { checkpoint: "x" } } } } }));
			const { cron, configure } = build({ get });
			await new Promise((resolve, reject) => cron.get("b1", { register: false }, (err, d) => err ? reject(err) : resolve(d)));
			assert.isUndefined(configure.registry.__cron);
		});

		it("get passes the dynamodb error to the callback", async function () {
			const boom = new Error("get failed");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const { cron } = build({ get });
			const err = await new Promise((resolve) => cron.get("b1", {}, (e) => resolve(e)));
			assert.equal(err, boom);
		});

		it("buildPayloads sends the requested checkpoint for the source", async function () {
			const { cron } = build({});
			const [payload]: any[] = await cron.buildPayloads({
				id: "b1",
				checkpoint: "z/9",
				lambda: { settings: [{ source: "queue:q1" }] }
			}, {}, {});
			assert.deepEqual(payload.__cron.checkpoints, { read: { "queue:q1": { checkpoint: "z/9" } } });
		});

		it("buildPayloads defaults to instance 0 and merges namedSettings", async function () {
			const { cron } = build({});
			const [payload]: any[] = await cron.buildPayloads({
				id: "b1",
				lambda: { settings: { x: 1 } },
				namedSettings: { "0": { y: 2 } }
			}, {}, undefined);
			assert.equal(payload.x, 1);
			assert.equal(payload.y, 2);
			assert.equal(payload.__cron.iid, "0");
		});

		it("buildPayloads loads attached systems from the system table", async function () {
			const batchGet = sandbox.stub().callsFake((p, cb) => cb(null, { Responses: { MockLeoSystem: [] } }));
			const { cron } = build({ batchGet });
			const [payload]: any[] = await cron.buildPayloads({
				id: "b1",
				system: { id: "sys-default" },
				lambda: { settings: [{ source: "system:sys-src", destination: "system:sys-dest" }] }
			}, {}, {});
			assert.deepEqual(batchGet.getCall(0).args[0], {
				RequestItems: { MockLeoSystem: { Keys: [{ id: "sys-dest" }, { id: "sys-src" }, { id: "sys-default" }] } }
			});
			assert.deepEqual(Object.keys(payload.__cron.systems).sort(), ["sys-default", "sys-dest", "sys-src"]);
			assert.deepEqual(payload.__cron.systems["sys-src"].aliases, ["source"]);
			assert.deepEqual(payload.__cron.systems["sys-dest"].aliases, ["destination"]);
			assert.deepEqual(payload.__cron.systems["sys-default"].aliases, ["default"]);
		});

		it("buildPayloads rejects when the system lookup fails", async function () {
			const boom = new Error("batchGet failed");
			const batchGet = sandbox.stub().callsFake((p, cb) => cb(boom));
			const { cron } = build({ batchGet });
			let err;
			try {
				await cron.buildPayloads({ id: "b1", system: { id: "s" } }, {}, {});
			} catch (e) { err = e; }
			assert.equal(err, boom);
		});
	});

	describe("hasMoreToDo", function () {
		it("hasMoreToDo is true when a trigger queue has no checkpoint", function () {
			const { cron } = build({});
			assert.isTrue(cron.hasMoreToDo({}, {
				triggers: ["q1"], requested_kinesis: { q1: "z/2" }, checkpoints: { read: {} }
			}));
		});

		it("hasMoreToDo is true when the latest event is past the checkpoint", function () {
			const { cron } = build({});
			assert.isTrue(cron.hasMoreToDo({}, {
				triggers: ["q1"], requested_kinesis: { q1: "z/2" }, checkpoints: { read: { q1: { checkpoint: "z/1" } } }
			}));
		});

		it("hasMoreToDo is false when the checkpoint has caught up", function () {
			const { cron } = build({});
			assert.isFalse(cron.hasMoreToDo({}, {
				triggers: ["q1"], requested_kinesis: { q1: "z/2" }, checkpoints: { read: { q1: { checkpoint: "z/2" } } }
			}));
		});

		it("hasMoreToDo ignores queues that are not triggers", function () {
			const { cron } = build({});
			assert.isFalse(cron.hasMoreToDo({}, {
				triggers: ["q1"], requested_kinesis: { other: "z/9" }, checkpoints: { read: {} }
			}));
		});

		it("hasMoreToDo ignores triggers when ignoreHasMore is set", function () {
			const { cron } = build({});
			assert.isFalse(cron.hasMoreToDo({}, {
				triggers: ["q1"], ignoreHasMore: true, requested_kinesis: { q1: "z/9" }, checkpoints: { read: {} }
			}));
		});

		it("hasMoreToDo restricts to the given key", function () {
			const { cron } = build({});
			const image = { triggers: ["q1", "q2"], requested_kinesis: { q1: "z/9", q2: "z/9" }, checkpoints: { read: { q1: { checkpoint: "z/9" } } } };
			assert.isFalse(cron.hasMoreToDo({}, image, "q1"));
			assert.isTrue(cron.hasMoreToDo({}, image, "q2"));
		});

		it("hasMoreToDo is false without requested_kinesis", function () {
			const { cron } = build({});
			assert.isFalse(cron.hasMoreToDo({}, { triggers: ["q1"] }));
		});
	});

	describe("shouldRun", function () {
		const NOW = 1_700_000_000_000;

		function run(cron, oldImage, newImage, cache) {
			return new Promise<any>((resolve) => cron.shouldRun(oldImage, newImage, cache, resolve));
		}

		beforeEach(() => {
			sandbox.stub(Date, "now").returns(NOW);
		});

		it("shouldRun is false when the bot has no code", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", trigger: NOW }, { _instances: { b1: {} } });
			assert.isFalse(r.value);
		});

		it("shouldRun is false when paused unless ignorePaused", async function () {
			const { cron } = build({});
			const cache = { _instances: { b1: {} } };
			const base = { id: "b1", lambdaName: "l", trigger: NOW };
			assert.isFalse((await run(cron, {}, { ...base, paused: true }, cache)).value);
			assert.isTrue((await run(cron, {}, { ...base, paused: true, ignorePaused: true }, cache)).value);
		});

		it("shouldRun is false after more than 10 errors", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", trigger: NOW, errorCount: 11 }, { _instances: { b1: {} } });
			assert.isFalse(r.value);
		});

		it("shouldRun treats cache._remoteCode as having code", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", trigger: NOW }, { _instances: { b1: {} }, _remoteCode: true });
			assert.isTrue(r.value);
		});

		it("shouldRun is false for step-function execution types", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", executionType: "stepfunction", trigger: NOW }, { _instances: { b1: {} } });
			assert.deepEqual(r, { msg: "Step functions not supported yet", value: false });
		});

		it("shouldRun is true when triggered after the last invoke", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", trigger: NOW }, { _instances: { b1: { "0": { completedTime: NOW - 10, invokeTime: NOW - 100, token: NOW - 50 } } } });
			assert.isTrue(r.value);
			assert.isFalse(r.timedout);
		});

		it("shouldRun is false while an instance is still running within its timeout", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", trigger: NOW }, { _instances: { b1: { "0": { invokeTime: NOW - 1000 } } } });
			assert.isFalse(r.value);
		});

		it("shouldRun is true for a running instance that has timed out", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", trigger: NOW, timeout: 1000 }, { _instances: { b1: { "0": { invokeTime: NOW - 5000, token: 1 } } } });
			assert.isTrue(r.value);
			assert.isTrue(r.timedout);
		});

		it("shouldRun is false when the token matches and nothing more is pending", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, { id: "b1", lambdaName: "l", trigger: NOW }, { _instances: { b1: { "0": { completedTime: NOW - 10, invokeTime: NOW - 100, token: NOW } } } });
			assert.isFalse(r.value);
		});

		it("shouldRun is true with a matching token when more work is pending", async function () {
			const { cron } = build({});
			const r = await run(cron, {}, {
				id: "b1", lambdaName: "l", trigger: NOW, triggers: ["q1"], requested_kinesis: { q1: "z/2" }, checkpoints: { read: { q1: { checkpoint: "z/1" } } }
			}, { _instances: { b1: { "0": { completedTime: NOW - 10, invokeTime: NOW - 100, token: NOW } } } });
			assert.isTrue(r.value);
		});

		it("shouldRun honors the delay after the last invoke", async function () {
			const { cron } = build({});
			const image = { id: "b1", lambdaName: "l", trigger: NOW, delay: "PT1M" };
			const cache = { _instances: { b1: { "0": { completedTime: NOW - 10, invokeTime: NOW - 1000, token: 1 } } } };
			assert.isFalse((await run(cron, {}, image, cache)).value);
			assert.isTrue((await run(cron, {}, { ...image, trigger: NOW + 120000 }, cache)).value);
		});

		it("shouldRun evaluates each named trigger and lets only one sync instance run", async function () {
			const { cron } = build({});
			const image = {
				id: "b1", lambdaName: "l", trigger: 0, namedTrigger: { a: NOW, b: NOW },
				lambda: { settings: [{}] }
			};
			const results = await run(cron, {}, image, { _instances: { b1: { a: { completedTime: 1, invokeTime: 1 }, b: { completedTime: 1, invokeTime: 2 } } } });
			assert.isArray(results);
			assert.deepEqual(results.map((r) => r.iid).sort(), ["0", "a", "b"]);
			assert.equal(results.filter((r) => r.value).length, 1);
		});
	});

	describe("start/end/run", function () {
		function lockableRow(extra = {}) {
			return {
				id: "b1",
				name: "Bot One",
				lambdaName: "lam",
				trigger: 1,
				instances: {},
				checkpoints: { read: {}, write: {} },
				lambda: { settings: [{}] },
				...extra
			};
		}

		it("start without a callback marks the run forceComplete and stamps ts", async function () {
			const { cron, configure } = build({});
			sandbox.stub(Date, "now").returns(4242);
			const event: any = { id: "b1" };
			await cron.start(event);
			assert.equal(event.__cron.ts, 4242);
			assert.isTrue(event.__cron.forceComplete);
			assert.equal(configure.registry.__cron, event.__cron);
		});

		it("start with a callback loads the bot, writes the instance token and then checks the lock", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: lockableRow() }));
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron, configure } = build({ get, update });
			const event: any = { id: "b1" };
			await new Promise<void>((resolve, reject) => { cron.start(event, (err) => err ? reject(err) : resolve()); });
			const command = update.getCall(0).args[0];
			assert.deepEqual(command.Key, { id: "b1" });
			assert.equal(command.UpdateExpression, "set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused");
			assert.equal(command.ExpressionAttributeNames["#index"], "0");
			assert.equal(command.ExpressionAttributeValues[":value"].status, null);
			assert.equal(update.callCount, 2);
			assert.match(update.getCall(1).args[0].UpdateExpression, /^set #instances\.#index\.#startTime = :startTime/);
			assert.equal(configure.registry.__cron.id, "b1");
			assert.equal(event.__cron.id, "b1");
		});

		it("start creates the cron row when the bot has no checkpoints", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, put, update });
			await new Promise<void>((resolve, reject) => { cron.start({ id: "b9" }, (err) => err ? reject(err) : resolve()); });
			assert.equal(update.callCount, 1);
			const item = put.getCall(0).args[0].Item;
			assert.equal(item.id, "b9");
			assert.equal(item.name, "b9");
			assert.deepEqual(item.checkpoints, { read: {}, write: {} });
			assert.deepEqual(Object.keys(item.instances), ["0"]);
		});

		it("start reports a get error", async function () {
			const boom = new Error("get failed");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const { cron } = build({ get });
			let err;
			try {
				await cron.start({ id: "b1" }, () => { });
			} catch (e) { err = e; }
			assert.equal(err, boom);
		});

		it("start with lock acquires the lock and rejects when already running", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: lockableRow() }));
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, update });
			const checkLock = sandbox.stub(cron, "checkLock");
			checkLock.onFirstCall().callsFake((c, runid, remaining, cb) => cb(null, {}));
			checkLock.onSecondCall().callsFake((c, runid, remaining, cb) => cb(new Error("locked")));

			const event: any = { id: "b1" };
			await cron.start(event, { lock: true, timeout: 1234, requestId: "req-1" }, () => { });
			assert.equal(checkLock.getCall(0).args[2], 1234);
			assert.equal(checkLock.getCall(0).args[1], "req-1");
			assert.isFalse(event.__cron.forceComplete);

			let err;
			try {
				await cron.start({ id: "b1" }, { lock: true, timeout: 1234 }, () => { });
			} catch (e) { err = e; }
			assert.equal(err, "already running");
		});

		it("end with nothing registered calls back and resolves", async function () {
			const { cron } = build({});
			const cb = sandbox.stub();
			await cron.end(cb);
			assert.equal(cb.callCount, 1);
		});

		it("end reports complete with forceComplete from the registry", async function () {
			const { cron, configure } = build({});
			configure.registry.__cron = { id: "b1", __requestId: "r1", forceComplete: true };
			const reportComplete = sandbox.stub(cron, "reportComplete").callsFake((c, runid, status, log, opts, cb: any) => cb());
			await cron.end();
			assert.deepEqual(reportComplete.getCall(0).args.slice(1, 5), ["r1", "complete", "", { forceComplete: true }]);
		});

		it("end with a non-complete status reports an error with that status as the log", async function () {
			const { cron, configure } = build({});
			configure.registry.__cron = { id: "b1", __requestId: "r1", forceComplete: false };
			const reportComplete = sandbox.stub(cron, "reportComplete").callsFake((c, runid, status, log, opts, cb: any) => cb());
			await cron.end("it broke", {});
			const args = reportComplete.getCall(0).args;
			assert.equal(args[2], "error");
			assert.equal(args[3], "it broke");
			assert.deepEqual(args[4], { forceComplete: false });
		});

		it("end accepts status then callback", async function () {
			const { cron, configure } = build({});
			configure.registry.__cron = { id: "b1" };
			sandbox.stub(cron, "reportComplete").callsFake((c, runid, status, log, opts, cb: any) => cb());
			const cb = sandbox.stub();
			await cron.end("boom", cb);
			assert.equal(cb.callCount, 1);
		});

		it("start without a callback returns a promise whose then returns undefined and never calls the callback", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: lockableRow() }));
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, update });
			const result = cron.start({ id: "b1" });
			assert.instanceOf(result, Promise);
			const callback = sandbox.stub();
			assert.isUndefined(result.then(callback));
			await new Promise((r) => setTimeout(r, 20));
			assert.equal(callback.callCount, 0);
		});

		it("run throws a TypeError when start has no callback because its then returns undefined", function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: lockableRow() }));
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const { cron } = build({ get, update });
			const handler = sandbox.stub();
			const callback = sandbox.stub();
			assert.throws(() => cron.run({ id: "b1" }, handler, callback), TypeError);
			assert.equal(handler.callCount, 0);
			assert.equal(callback.callCount, 0);
		});

		it("run calls start, the handler and end then the callback", async function () {
			const { cron } = build({});
			const calls: string[] = [];
			sandbox.stub(cron, "start").callsFake(() => { calls.push("start"); return Promise.resolve(); });
			sandbox.stub(cron, "end").callsFake((err) => { calls.push(`end:${err}`); return Promise.resolve(); });
			await cron.run({ id: "b1" }, () => { calls.push("handler"); }, () => { calls.push("callback"); });
			assert.deepEqual(calls, ["start", "handler", "end:undefined", "callback"]);
		});

		it("run passes a handler failure to end", async function () {
			const { cron } = build({});
			const end = sandbox.stub(cron, "end").resolves();
			sandbox.stub(cron, "start").resolves();
			const boom = new Error("handler failed");
			await cron.run({ id: "b1" }, () => { throw boom; }, () => { });
			assert.equal(end.getCall(0).args[0], boom);
		});
	});
});
