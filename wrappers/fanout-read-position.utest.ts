import path from "path";
import moment from "moment";
import { assert } from "chai";
import { Readable, Transform } from "stream";

/**
 * Replays the 2026-09-30 13:03 lost-events incident through the real fanout wrapper.
 * Instances are invoked in-process (the AWS Lambda client is faked) and the queue is a fake that lets a
 * batch land after the workers have read but before the master (which starts 200ms later) reads.
 */
const MODULE = process.env.FANOUT_UNDER_TEST || "./fanout";
const QUEUE = "notification-intent";
const BOT = "notification-prod-intent-to-recipient-intent";

const indexPath = path.resolve(__dirname, "../index.js");
const lambdaPath = require.resolve("@aws-sdk/client-lambda");
const modulePath = require.resolve(MODULE);

const eid = (ms: number, seq: number) => moment.utc(ms).format("[z/]YYYY/MM/DD/HH/mm/") + ms + "-" + String(seq).padStart(7, "0");

interface TestEvent {
	eid: string;
	partition: number;
}

describe("Fanout read positions (13:03 incident replay)", function () {
	this.timeout(5000);

	const saved: any = {};
	let T0: number, START: string, E923: TestEvent, batch: TestEvent[], world: { events: TestEvent[] }, persisted: any[];

	function makeInstance() {
		const leo: any = {
			bot: {
				checkpoint: (id: string, queue: string, params: any, cb: () => void) => {
					persisted.push({ id, queue, params });
					cb();
				},
				checkLock: (cron: any, runid: any, remaining: any, cb: Function) => cb(null, {}),
				reportComplete: (cron: any, runid: any, status: any, log: any, opts: any, cb: Function) => cb(null, {})
			},
			streams: {
				fromLeo: (ID: string, queue: string, opts: any) => {
					const events = world.events
						.filter(e => e.eid > START && (!opts.maxOverride || e.eid <= opts.maxOverride))
						.map(e => Object.assign({}, e));
					const reader: any = Readable.from(events);
					reader.checkpoint = () => { };
					reader.get = () => { };
					return reader;
				},
				pipe: (a: Readable, b: Transform) => a.pipe(b),
				through: (fn: Function) => new Transform({
					objectMode: true,
					transform(obj, enc, cb) {
						fn(obj, (err: any, out: any) => cb(err, out));
					}
				})
			}
		};
		leo.read = leo.streams.fromLeo;
		require.cache[indexPath] = { id: indexPath, filename: indexPath, loaded: true, exports: leo } as any;

		// The "bot": process what this instance owns and checkpoint at the last event it processed
		const handler = async () => {
			const processed: string[] = [];
			await new Promise((resolve, reject) => {
				leo.read(BOT + "_reader", QUEUE, {})
					.on("data", (obj: TestEvent) => processed.push(obj.eid))
					.on("end", resolve)
					.on("error", reject);
			});
			if (processed.length) {
				await new Promise(resolve => leo.bot.checkpoint(BOT + "_reader", QUEUE, {
					eid: processed[processed.length - 1],
					records: processed.length,
					source_timestamp: 1,
					started_timestamp: 1,
					ended_timestamp: 1
				}, resolve));
			}
			return processed;
		};
		const fanout = require(MODULE);
		return fanout(handler, (e: TestEvent) => e.partition, { instances: 4 });
	}

	const context = { getRemainingTimeInMillis: () => 60000 };
	const masterEvent = (ts?: number) => ({
		__cron: { id: BOT, ts, checkpoints: { read: { ["queue:" + QUEUE]: { checkpoint: START } } } }
	});

	before(() => {
		["AWS_LAMBDA_FUNCTION_NAME", "AWS_DEFAULT_REGION", "AWS_LAMBDA_FUNCTION_VERSION"].forEach(k => saved[k] = process.env[k]);
		process.env.AWS_LAMBDA_FUNCTION_NAME = "fanout-under-test";
		process.env.AWS_DEFAULT_REGION = "us-east-1";
		process.env.AWS_LAMBDA_FUNCTION_VERSION = "$LATEST";
		require("@aws-sdk/client-lambda");
		saved.lambdaExports = require.cache[lambdaPath]!.exports;
		class FakeLambda {
			invoke(params: any, cb: Function) {
				makeInstance()(JSON.parse(params.Payload), context)
					.then((res: any) => cb(null, { StatusCode: 200, Payload: JSON.stringify(res) }), (err: any) => cb(err));
			}
		}
		require.cache[lambdaPath]!.exports = { Lambda: FakeLambda };
		delete require.cache[modulePath];
		saved.index = require.cache[indexPath];
	});

	after(() => {
		["AWS_LAMBDA_FUNCTION_NAME", "AWS_DEFAULT_REGION", "AWS_LAMBDA_FUNCTION_VERSION"].forEach(k => {
			if (saved[k] === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = saved[k];
			}
		});
		require.cache[lambdaPath]!.exports = saved.lambdaExports;
		if (saved.index) {
			require.cache[indexPath] = saved.index;
		} else {
			delete require.cache[indexPath];
		}
		delete require.cache[modulePath];
	});

	beforeEach(() => {
		T0 = Date.now() - 20000;
		START = eid(T0, 922);
		E923 = { eid: eid(T0, 923), partition: 0 };
		const owners = [1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 2, 3]; // 398..411
		batch = owners.map((partition, i) => ({ eid: eid(T0 + 8000, 398 + i), partition }));
		world = { events: [E923] };
		persisted = [];
	});

	it("does not advance past events the owners have not read (batch lands between the workers and the master)", async () => {
		// the batch lands after the workers read (t~0) and before the master reads (t=200ms)
		setTimeout(() => world.events.push(...batch), 100);
		await makeInstance()(masterEvent(), context);
		assert.lengthOf(persisted, 1);
		// every owner still has to read the batch, so the stored checkpoint must stay at 0923
		assert.equal(persisted[0].params.eid, E923.eid);
	});

	it("advances to the last event read when every instance saw the whole batch", async () => {
		world.events.push(...batch);
		await makeInstance()(masterEvent(), context);
		assert.lengthOf(persisted, 1);
		assert.equal(persisted[0].params.eid, batch[batch.length - 1].eid);
	});

	it("leaves events assigned after __cron.ts for the next run, even if every instance could read them", async () => {
		world.events.push(...batch);
		// the trigger fired before the batch's eids were assigned (T0+8000)
		await makeInstance()(masterEvent(T0 + 5000), context);
		assert.lengthOf(persisted, 1);
		assert.equal(persisted[0].params.eid, E923.eid);
	});

	it("reads events assigned before __cron.ts", async () => {
		world.events.push(...batch);
		await makeInstance()(masterEvent(T0 + 9000), context);
		assert.lengthOf(persisted, 1);
		assert.equal(persisted[0].params.eid, batch[batch.length - 1].eid);
	});
});

describe("Fanout getMaxEid", () => {
	const { getMaxEid } = require("./fanout");
	const now = moment.utc("2026-09-30T13:03:19.394Z");

	it("pins to __cron.ts", () => {
		assert.equal(getMaxEid({ ts: 1790773391546 }, now), "z/2026/09/30/13/03/1790773391546");
	});

	it("accepts a numeric string", () => {
		assert.equal(getMaxEid({ ts: "1790773391546" }, now), "z/2026/09/30/13/03/1790773391546");
	});

	it("falls back to now if there is no ts", () => {
		assert.equal(getMaxEid({}, now), "z/2026/09/30/13/03/" + now.valueOf());
	});

	it("falls back to now if ts is not a number", () => {
		assert.equal(getMaxEid({ ts: "abc" }, now), "z/2026/09/30/13/03/" + now.valueOf());
	});

	it("falls back to now if ts is in the future", () => {
		assert.equal(getMaxEid({ ts: now.valueOf() + 60000 }, now), "z/2026/09/30/13/03/" + now.valueOf());
	});
});
