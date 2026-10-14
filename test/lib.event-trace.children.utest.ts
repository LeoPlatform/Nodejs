import RStreamsSdk from "../index";
import sinon from "sinon";
import { assert } from "chai";
import moment from "moment";
import { trace as eventTrace } from "../lib/event-trace";

const mockSdkConfig = {
	Region: "mock-Region",
	LeoStream: "mock-LeoStream",
	LeoCron: "mock-LeoCron",
	LeoEvent: "mock-LeoEvent",
	LeoS3: "mock-leos3",
	LeoKinesisStream: "mock-LeoKinesisStream",
	LeoFirehoseStream: "mock-LeoFirehoseStream",
	LeoSettings: "mock-LeoSettings",
};

const STATS_TABLE = "MOCK_STATS_TABLE";
const START_EID = "z/2022/03/14/22/38/1647297513618-0000035";
const START_TS = 1647297513413;

describe("lib/event-trace.ts children", function () {
	let sandbox: sinon.SinonSandbox;
	let sdk: any;
	let query: sinon.SinonStub;
	let fromLeo: sinon.SinonStub;

	function startEvent() {
		return { id: "bot0", event: "queue:q0", eid: START_EID, timestamp: START_TS, event_source_timestamp: START_TS - 100, payload: {}, correlation_id: { source: "src", start: "z/1" } };
	}

	function stat(bucket: string, time: number, queue: string, checkpoint: string) {
		return { bucket, time, current: { read: { [queue]: { checkpoint } } } };
	}

	function statsFor(botRefId: string, hourItems: any[], minuteItems: any[] = hourItems) {
		query.callsFake((params: any, cb: any) => {
			if (params.ExpressionAttributeValues[":id"] !== botRefId) {
				return;
			}
			cb(null, { Items: params.Limit === 60 ? minuteItems : hourItems });
		});
	}

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		sdk = RStreamsSdk(mockSdkConfig);
		query = sandbox.stub(sdk.aws.dynamodb.docClient, "query");
		fromLeo = sandbox.stub(sdk.streams, "fromLeo");
	});

	afterEach(() => {
		sandbox.restore();
	});

	function queueReads(map: Record<string, any[]>) {
		fromLeo.callsFake((id, queue) => {
			const events = map[String(queue)];
			return sdk.streams.eventstream.readArray(events || []);
		});
	}

	it("E1 children trace reads the starting event with start just before the eid and limit 1", async function () {
		queueReads({ "queue:q0": [startEvent()] });
		statsFor("bot:bot1", []);
		await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		assert.deepEqual(fromLeo.getCall(0).args.slice(0, 3), ["test", "queue:q0", { start: "z/2022/03/14/22/38/1647297513618-0000034", limit: 1 }]);
	});

	it("E1 children trace queries hourly then minute stats for the bot and reads the queue window", async function () {
		const childEvent = {
			eid: "z/2022/03/14/22/40/1647297650000-0000001", event: "queue:queue1", id: "bot1", payload: { x: 1 },
			timestamp: 1647297650500, event_source_timestamp: 1647297650000, correlation_id: { start: START_EID, units: 1 }
		};
		const statTime = 1647297600000;
		queueReads({ "queue:q0": [startEvent()], "queue:queue1": [childEvent] });
		statsFor("bot:bot1", [stat("hour_2022-03-14 22", statTime, "queue:q0", START_EID)]);

		const result: any = await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });

		assert.deepEqual(query.getCall(0).args[0], {
			TableName: STATS_TABLE,
			KeyConditionExpression: "#id = :id and #bucket >= :bucket",
			ExpressionAttributeNames: { "#bucket": "bucket", "#id": "id" },
			Limit: 336,
			ExpressionAttributeValues: { ":bucket": "hour_2022-03-14 22", ":id": "bot:bot1" },
			ReturnConsumedCapacity: "TOTAL"
		});
		assert.deepEqual(query.getCall(1).args[0], {
			TableName: STATS_TABLE,
			KeyConditionExpression: "#id = :id and #bucket >= :bucket",
			ExpressionAttributeNames: { "#bucket": "bucket", "#id": "id" },
			Limit: 60,
			ExpressionAttributeValues: { ":bucket": "minute_2022-03-14 22:40", ":id": "bot:bot1" },
			ReturnConsumedCapacity: "TOTAL"
		});
		const readArgs = fromLeo.getCall(1).args;
		assert.equal(String(readArgs[1]), "queue:queue1");
		assert.deepEqual(readArgs[2], {
			start: moment(statTime).format("[z/]YYYY/MM/DD/HH/mm/ss"),
			maxOverride: moment(statTime).add(1, "m").format("[z/]YYYY/MM/DD/HH/mm/ss"),
			fast_s3_read: true
		});
		assert.deepEqual(result, {
			"bot:bot1": { checkpoint: childEvent.eid, lag: 500 },
			"queue:queue1": { payload: { x: 1 }, lag: 500, checkpoint: childEvent.eid }
		});
	});

	it("E1 children trace follows the correlation chain across two hops", async function () {
		const hop1 = {
			eid: "z/2022/03/14/22/40/1647297650000-0000001", event: "queue:queue1", id: "bot1", payload: { hop: 1 },
			timestamp: 1647297650500, event_source_timestamp: 1647297650000, correlation_id: { start: START_EID }
		};
		const hop2 = {
			eid: "z/2022/03/14/22/41/1647297710000-0000002", event: "queue:queue2", id: "bot2", payload: { hop: 2 },
			timestamp: 1647297710900, event_source_timestamp: 1647297650000, correlation_id: { start: hop1.eid }
		};
		queueReads({ "queue:q0": [startEvent()], "queue:queue1": [hop1], "queue:queue2": [hop2] });
		query.callsFake((params: any, cb: any) => {
			const id = params.ExpressionAttributeValues[":id"];
			if (id === "bot:bot1") {
				return cb(null, { Items: [stat("hour_2022-03-14 22", 1647297600000, "queue:q0", START_EID)] });
			}
			cb(null, { Items: [stat("hour_2022-03-14 22", 1647297660000, "queue:queue1", hop1.eid)] });
		});

		const result: any = await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1", "bot2", "queue2"] });

		assert.deepEqual(result, {
			"bot:bot1": { checkpoint: hop1.eid, lag: 500 },
			"queue:queue1": { payload: { hop: 1 }, lag: 500, checkpoint: hop1.eid },
			"bot:bot2": { checkpoint: hop2.eid, lag: 60900 },
			"queue:queue2": { payload: { hop: 2 }, lag: 60900, checkpoint: hop2.eid }
		});
		assert.equal(query.getCall(2).args[0].ExpressionAttributeValues[":id"], "bot:bot2");
	});

	it("E1 children trace skips stats whose checkpoint is behind the correlation start", async function () {
		const childEvent = {
			eid: "z/2022/03/14/22/40/1647297650000-0000001", event: "queue:queue1", id: "bot1", payload: {},
			timestamp: 1647297650500, event_source_timestamp: 1647297650000, correlation_id: { start: START_EID }
		};
		queueReads({ "queue:q0": [startEvent()], "queue:queue1": [childEvent] });
		statsFor("bot:bot1", [
			stat("hour_2022-03-14 22", 1647297000000, "queue:q0", "z/2022/03/14/22/00/1647295200000-0000000"),
			stat("hour_2022-03-14 23", 1647297600000, "queue:q0", START_EID)
		]);
		await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		assert.equal(query.getCall(1).args[0].ExpressionAttributeValues[":bucket"], "minute_2022-03-14 22:40");
	});

	it("E1 children trace matches an event whose correlation range covers the start", async function () {
		const rangeEvent = {
			eid: "z/2022/03/14/22/40/1647297650000-0000009", event: "queue:queue1", id: "bot1", payload: { range: true },
			timestamp: 1647297650500, event_source_timestamp: 1647297650000,
			correlation_id: { start: "z/2022/03/14/22/38/1647297500000-0000001", end: "z/2022/03/14/22/38/1647297600000-0000099" }
		};
		queueReads({ "queue:q0": [startEvent()], "queue:queue1": [rangeEvent] });
		statsFor("bot:bot1", [stat("hour_2022-03-14 22", 1647297600000, "queue:q0", START_EID)]);
		const result: any = await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		assert.deepEqual(result["queue:queue1"].payload, { range: true });
	});

	it("E1 children trace keeps the first match when later events also match", async function () {
		const first = {
			eid: "z/2022/03/14/22/40/1647297650000-0000001", event: "queue:queue1", id: "bot1", payload: { n: 1 },
			timestamp: 1647297650500, event_source_timestamp: 1647297650000, correlation_id: { start: START_EID }
		};
		const second = { ...first, eid: "z/2022/03/14/22/40/1647297651000-0000002", payload: { n: 2 } };
		queueReads({ "queue:q0": [startEvent()], "queue:queue1": [first, second] });
		statsFor("bot:bot1", [stat("hour_2022-03-14 22", 1647297600000, "queue:q0", START_EID)]);
		const result: any = await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		assert.deepEqual(result["queue:queue1"].payload, { n: 1 });
	});

	it("E1 children trace reports empty entries when no stats match", async function () {
		queueReads({ "queue:q0": [startEvent()] });
		statsFor("bot:bot1", [stat("hour_2022-03-14 22", 1647297600000, "queue:other", START_EID)]);
		const result: any = await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		assert.deepEqual(result, { "bot:bot1": {}, "queue:queue1": {} });
		assert.equal(query.callCount, 1);
	});

	it("E1 children trace rejects when the stats query fails", async function () {
		queueReads({ "queue:q0": [startEvent()] });
		const boom = new Error("stats failed");
		query.callsFake((params: any, cb: any) => cb(boom));
		let err;
		try {
			await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		} catch (e) { err = e; }
		assert.equal(err, boom);
	});

	it("E1 children trace rejects when the minute stats query fails", async function () {
		queueReads({ "queue:q0": [startEvent()] });
		const boom = new Error("minute stats failed");
		query.callsFake((params: any, cb: any) => {
			if (params.Limit === 60) {
				return cb(boom);
			}
			cb(null, { Items: [stat("hour_2022-03-14 22", 1647297600000, "queue:q0", START_EID)] });
		});
		let err;
		try {
			await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: START_EID, children: ["bot1", "queue1"] });
		} catch (e) { err = e; }
		assert.equal(err, boom);
	});

	it("E1 children trace queue ids with a 0 suffix step back to a space", async function () {
		queueReads({ "queue:q0": [startEvent()] });
		statsFor("bot:bot1", []);
		await eventTrace(sdk, STATS_TABLE, { queue: "q0", eid: "z/2022/03/14/22/38/1647297513618-0000030", children: ["bot1", "queue1"] });
		assert.equal(fromLeo.getCall(0).args[2].start, "z/2022/03/14/22/38/1647297513618-000003 ");
	});
});
