import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import utilFn from "../lib/stream/leo-stream";
import { promisify } from "util";
import AWS from "aws-sdk";
import { CorrelationId, ReadEvent } from "../lib/types";
chai.use(sinonchai);
let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

let mockSdkConfig = {
	Region: "mock-Region",
	LeoStream: "mock-LeoStream",
	LeoCron: "mock-LeoCron",
	LeoEvent: "mock-LeoEvent",
	LeoS3: "mock-leos3",
	LeoKinesisStream: "mock-LeoKinesisStream",
	LeoFirehoseStream: "mock-LeoFirehoseStream",
	LeoSettings: "mock-LeoSettings",
};

describe("leo-stream", function () {
	let sandbox;
	beforeEach(() => {
		delete (process as any).__config;
		sandbox = sinon.createSandbox()
	});
	afterEach(() => {
		sandbox.restore();
	});

	it("stats - get", async function () {
		let stats = ls.stats("bot-id", "mock-queue");
		await ls.pipeAsync(
			ls.eventstream.readArray([
				{ payload: {}, eid: "0", event_source_timestamp: 10 },
				{ payload: {}, eid: "1", event_source_timestamp: 11 },
				{ payload: {}, eid: "2", event_source_timestamp: 12 },
				{ payload: {}, eid: "3", event_source_timestamp: 13 },
				{ payload: {}, eid: "4", event_source_timestamp: 14 }
			]),
			ls.through((data, done) => {
				setTimeout(() => done(null, data), 1);
			}),
			stats,
			ls.devnull()
		);

		let data = stats.get();
		assert.exists(data.started_timestamp, "started_timestamp should exist");
		assert.exists(data.ended_timestamp, "ended_timestamp should exist");

		// This is weird.  Should they actually always be the same
		assert(data.started_timestamp == data.ended_timestamp);
		delete data.started_timestamp;
		delete data.ended_timestamp;

		assert.deepEqual(data, {
			eid: "4",
			source_timestamp: 10,
			start_eid: "0",
			units: 5
		});

	});
	it("stats - checkpoint", async function () {
		let update = sandbox.stub()
			.onFirstCall().callsArgWith(1, null, {});

		sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });
		let ls = utilFn({ onUpdate: () => { }, resources: { LeoCron: "mock-LeoCron" }, aws: {} });

		let stats = ls.stats("mock-bot", "mock-queue");
		await ls.pipeAsync(
			ls.eventstream.readArray([
				{ payload: {}, eid: "0", event_source_timestamp: 10 },
				{ payload: {}, eid: "1", event_source_timestamp: 11 },
				{ payload: {}, eid: "2", event_source_timestamp: 12 },
				{ payload: {}, eid: "3", event_source_timestamp: 13 },
				{ payload: {}, eid: "4", event_source_timestamp: 14 }
			]),
			stats,
			ls.devnull()
		);


		await promisify(stats.checkpoint).call(stats);

		expect(update).is.called;
		let updateCallArgs = update.getCall(0).args[0];
		delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
		delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;


		assert.deepEqual(updateCallArgs, {
			"ExpressionAttributeNames": {
				"#checkpoints": "checkpoints",
				"#event": "queue:mock-queue",
				"#type": "read"
			},
			"ExpressionAttributeValues": {
				":value": {
					"checkpoint": "4",
					"records": 5,
					"source_timestamp": 10,
				}
			},
			"Key": {
				"id": "mock-bot"
			},
			"ReturnConsumedCapacity": "TOTAL",
			"TableName": "mock-LeoCron",
			"UpdateExpression": "set #checkpoints.#type.#event = :value"
		});

	});


	describe("createCorrelation", function () {
		it("single event", function () {
			let event: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/1234",
				payload: {}
			};
			assert.deepEqual(ls.createCorrelation(event), {
				source: "MyQueue",
				start: "z/1234",
				end: undefined,
				units: 1
			});
		});

		it("single event undefined", function () {
			let event: ReadEvent<any> = undefined;
			expect(() => ls.createCorrelation(event)).to.throw("startEvent is required");
		});

		it("single event with options", function () {
			let event: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/12345",
				payload: {}
			};
			assert.deepEqual(ls.createCorrelation(event, { partial: true }), {
				source: "MyQueue",
				partial_start: "z/12345",
				partial_end: undefined,
				units: 1
			} as unknown as CorrelationId);
		});


		it("start & end event", function () {
			let startEvent: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/12345",
				payload: {}
			};

			let endEvent: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/1234567",
				payload: {}
			};
			assert.deepEqual(ls.createCorrelation(startEvent, endEvent, 100), {
				source: "MyQueue",
				start: "z/12345",
				end: "z/1234567",
				units: 100
			});
		});
		it("start & end event with options", function () {
			let startEvent: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/123456",
				payload: {}
			};

			let endEvent: ReadEvent<any> = {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/12345678",
				payload: {}
			};
			assert.deepEqual(ls.createCorrelation(startEvent, endEvent, 100, { partial: true }), {
				source: "MyQueue",
				partial_start: "z/123456",
				partial_end: "z/12345678",
				units: 100
			} as unknown as CorrelationId);
		});


		it("array of events", function () {
			let events: ReadEvent<any>[] = [{
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/1234567",
				payload: {}
			}, {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/123456789",
				payload: {}
			}];
			assert.deepEqual(ls.createCorrelation(events), {
				source: "MyQueue",
				start: "z/1234567",
				end: "z/123456789",
				units: 2
			});
		});
		it("array of events with options", function () {
			let events: ReadEvent<any>[] = [{
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/1234567",
				payload: {}
			}, {
				id: "SomeBot",
				event: "MyQueue",
				eid: "z/123456789",
				payload: {}
			}];
			assert.deepEqual(ls.createCorrelation(events, { partial: true }), {
				source: "MyQueue",
				partial_start: "z/1234567",
				partial_end: "z/123456789",
				units: 2
			} as unknown as CorrelationId);
		});
		it("array of events 0 len", function () {
			let events: ReadEvent<any>[] = [];
			expect(() => ls.createCorrelation(events, { partial: true })).to.throw("startEvent must not be empty");
		});
	});
});

