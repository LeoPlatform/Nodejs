import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import utilFn from "../lib/stream/leo-stream";
import { promisify } from "util";
import { CorrelationId, ReadEvent } from "../lib/types";
import { RStreamsSdk } from "../index";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

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

describe("lib/streams/leo-stream", function () {
	let sandbox;
	beforeEach(() => {
		delete (process as any).__config;
		sandbox = sinon.createSandbox();
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

		sandbox.stub(DynamoDBDocument, 'from').returns({ update } as unknown as DynamoDBDocument);
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

	describe("process", () => {
		interface MyInData {
			a: number;
		}

		interface MyOutData {
			b: string;
		}

		describe("callback", () => {
			it("done(null, data)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, (data, wrapper, done) => {
						done(null, {
							b: (data.a * 100).toString()
						});
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("done(null, false)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, (data, wrapper, done) => {
						done(null, false);
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, []);
			});

			it("done(null, true)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, (data, wrapper, done) => {
						done(null, true);
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
				]
				);
			});

			it("done(null, true|data)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				let i = 0;
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, (data, wrapper, done) => {
						done(null, (i++) % 2 == 0 ? true : { b: data.a.toString() });
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
				]
				);
			});

			it("push(data) && done()", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, function (data, wrapper, done) {
						this.push({
							b: data.a.toString()
						});
						done();
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "1"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "3"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "5"
						}
					},
				]
				);
			});

			it("push(data, partial) && done(null, true)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, function (data, wrapper, done) {
						this.push({
							b: data.a.toString()
						}, { partial: true });
						done(null, true);
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "1"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "3"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "5"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
				]);
			});

			it("done(error)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				let error;
				try {
					await ls.pipeAsync(
						ls.eventstream.readArray(sourceData),
						ls.process<MyInData, MyOutData>(botId, function (data, wrapper, done) {
							done(new Error("Bad Error"));
						}, queue),
						ls.write((data, done) => {
							result.push(data);
							done();
						})
					);
				} catch (err) {
					error = err;
				}

				assert.isNotNull(error, "Should throw an error");
				assert.deepEqual(result, []);
			});

			it("done(null, data, opts)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, (data, wrapper, done) => {
						done(null, {
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("push(data, opts) && done()", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, function (data, wrapper, done) {
						this.push({
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
						done();
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("push(data, opts) && done(null, true)", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, function (data, wrapper, done) {
						this.push({
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
						done(null, true);
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					}
				]);
			});

		});

		describe("async", () => {
			it("return data", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data) => {
						return {
							b: (data.a * 100).toString()
						};
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("return false", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async () => {
						return false;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, []);
			});

			it("return true", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async () => {
						return true;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
				]
				);
			});

			it("return true|data", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				let i = 0;
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data) => {
						return (i++) % 2 == 0 ? true : { b: data.a.toString() };
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
				]
				);
			});

			it("push(data) && return", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data) {
						this.push({
							b: data.a.toString()
						});
						return true;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "1"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "3"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "5"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
				]
				);
			});

			it("push(data) && return false", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data, wrapper) {
						this.push({
							b: data.a.toString()
						});
						return false;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "1"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "3"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "5"
						}
					},
				]
				);
			});

			it("push(data, partial) && return true", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data, wrapper) {
						this.push({
							b: data.a.toString()
						}, { partial: true });
						return true;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "1"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "2"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "3"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "4"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"event": "MyOutQueue",
						"payload": {
							"b": "5"
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
				]);
			});

			it("throw error", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				let error;
				try {
					await ls.pipeAsync(
						ls.eventstream.readArray(sourceData),
						ls.process<MyInData, MyOutData>(botId, async function () {
							throw new Error("Bad Error");
						}, queue),
						ls.write((data, done) => {
							result.push(data);
							done();
						})
					);
				} catch (err) {
					error = err;
				}

				assert.isNotNull(error, "Should throw an error");
				assert.deepEqual(result, []);
			});

			it("return {data, opts}", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data, wrapper) => {
						return {
							data: {
								b: (data.a * 100).toString()
							},
							options: {
								queue: wrapper.event + "Override",
								eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
								units: data.a * 2,
								event_source_timestamp: est_override
							}
						};
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("push(data, opts) && return", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data, wrapper) {
						this.push({
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
						return true;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					}
				]);
			});

			it("push(data, opts) && return false", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data, wrapper) {
						this.push({
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
						return false;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("push(data, opts) && return true", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let est_override = 1650656791035;

				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async function (data, wrapper) {
						this.push({
							b: (data.a * 100).toString()
						}, {
							queue: wrapper.event + "Override",
							eid: ls.eventIdFromTimestamp(est_override, "full", data.a * 100),
							units: data.a * 2,
							event_source_timestamp: est_override
						});
						return true;
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000100",
							"units": 2,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000100",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000200",
							"units": 4,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000200",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000300",
							"units": 6,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000300",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000400",
							"units": 8,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000400",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/46/1650656791035-0000500",
							"units": 10,
						},
						"eid": "z/2022/04/22/19/46/1650656791035-0000500",
						"event": "SourceQueueOverride",
						"event_source_timestamp": 1650656791035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					}
				]);
			});

			it("return data[] - 2", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data) => {
						return [{
							b: (data.a * 100).toString()
						}, {
							b: (data.a * 1000).toString()
						}];
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					}, {
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "1000",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					}, {
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "2000",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					}, {
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "3000",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					}, {
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "4000",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"partial_start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "5000",
						}
					},]);
			});

			it("return data[] - 1", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data) => {
						return [{
							b: (data.a * 100).toString()
						}];
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "100",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "200",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "300",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "400",
						},
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event": "MyOutQueue",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
						"payload": {
							"b": "500",
						}
					}
				]);
			});

			it("return data[] - 0", async () => {
				let botId = "MyBot";
				let queue = "MyOutQueue";
				let now = 1650656691035;
				let sourceData: ReadEvent<MyInData>[] = [1, 2, 3, 4, 5].map(i => ({
					event: "SourceQueue",
					id: "SourceBot",
					payload: {
						a: i
					},
					eid: ls.eventIdFromTimestamp(now, "full", i),
					timestamp: now,
					event_source_timestamp: now
				}));
				let result = [];
				await ls.pipeAsync(
					ls.eventstream.readArray(sourceData),
					ls.process<MyInData, MyOutData>(botId, async (data) => {
						return [];
					}, queue),
					ls.write((data, done) => {
						result.push(data);
						done();
					})
				);

				assert.deepEqual(result, [
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000001",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000001",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000002",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000002",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000003",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000003",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000004",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000004",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot",
					},
					{
						"correlation_id": {
							"source": "SourceQueue",
							"start": "z/2022/04/22/19/44/1650656691035-0000005",
							"units": 1,
						},
						"eid": "z/2022/04/22/19/44/1650656691035-0000005",
						"event_source_timestamp": 1650656691035,
						"id": "MyBot"
					}
				]);
			});
		});
	});
	// batch
	// flush
	// sync

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

	describe("from-leo", function () {
		it("ddb throw error", function (cb) {
			let queue = "mock-queue";
			let botId = "mock-bot-id";

			let batchGet = sandbox.stub()
				.onFirstCall()
				.callsFake((_, cb) => {
					process.nextTick(() => cb(Object.assign(new Error("Socket timed out!"), { code: "SOCKET_TIMEOUT" })));
				});

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet } as unknown as DynamoDBDocument);

			let sdk = new RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;
			ls.pipe(
				sdk.read(botId, queue, { start: ls.eventIdFromTimestamp(1647460979244) }),
				ls.devnull(),
				(err) => {
					assert.exists(err, "Expected an error");
					cb();
				}
			);
		});
	});
});
