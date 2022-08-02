import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import AWS from "aws-sdk";
import zlib from "zlib";
import { RStreamsSdk } from "../index";
chai.use(sinonchai);

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

describe("kinesis-shard", function () {


	let sandbox;
	beforeEach(() => {
		delete (process as any).__config;
		sandbox = sinon.createSandbox();
	});

	afterEach(() => {
		sandbox.restore();
	});

	function uncompressKinesis(records) {
		records.forEach((r: { Data: any; }) => {
			// convert buffers to strings
			r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString();
		});
	}

	function setupTest() {
		let kinesisPutRecordsRespone: AWS.Kinesis.Types.PutRecordsOutput = {
			Records: [{
				SequenceNumber: "0",
				ShardId: "shard-0"
			}]
		};
		let kinesisPutRecords = sandbox.stub();
		kinesisPutRecords
			.callsArgWith(1, null, kinesisPutRecordsRespone);

		let firehosePutRecordBatch = sandbox.stub();


		sandbox.stub(AWS, 'Kinesis').returns({ putRecords: kinesisPutRecords });
		sandbox.stub(AWS, 'Firehose').returns({ putRecordBatch: firehosePutRecordBatch });

		return {
			kinesisPutRecords,
			firehosePutRecordBatch
		};
	}

	it('Writes To a Queue shard', async function () {
		let queue = "mock-out-queue";
		let botId = "mock-bot-id";

		let { kinesisPutRecords, firehosePutRecordBatch } = setupTest();

		let sdk = new RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		await ls.pipeAsync(
			ls.eventstream.readArray([{
				id: botId,
				payload: { hello: "world" },
				event_source_timestamp: 1647463353000,
				timestamp: 1647463353000,
			}, {
				id: botId,
				payload: { good: "bye" },
				event_source_timestamp: 1647463353001,
				timestamp: 1647463353001,
			}]),
			sdk.load(botId, queue, { useQueuePartition: true })
		);
		expect(firehosePutRecordBatch).is.not.called;
		expect(kinesisPutRecords).is.called;
		uncompressKinesis(kinesisPutRecords.getCall(0).args[0].Records);
		assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
			"Records": [
				{
					"Data": [
						{ "id": "mock-bot-id", "payload": { "hello": "world" }, "event_source_timestamp": 1647463353000, "timestamp": 1647463353000, "event": "mock-out-queue", "eid": 0 },
						{ "id": "mock-bot-id", "payload": { "good": "bye" }, "event_source_timestamp": 1647463353001, "timestamp": 1647463353001, "event": "mock-out-queue", "eid": 1 }
					].map(j => JSON.stringify(j)).join("\n") + "\n",
					"ExplicitHashKey": undefined,
					"PartitionKey": "mock-out-queue"
				}
			],
			"StreamName": "mock-LeoKinesisStream"
		});

	});



	it('Writes To a Queue shard w/ 2 queues', async function () {
		let queue1 = "mock-out-queue-1";
		let queue2 = "mock-out-queue-2";
		let botId = "mock-bot-id";


		let { kinesisPutRecords, firehosePutRecordBatch } = setupTest();

		let sdk = new RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		await ls.pipeAsync(
			ls.eventstream.readArray([{
				id: botId,
				event: queue1,
				payload: { hello: "world" },
				event_source_timestamp: 1647463353000,
				timestamp: 1647463353000,
			}, {
				id: botId,
				event: queue2,
				payload: { good: "bye" },
				event_source_timestamp: 1647463353001,
				timestamp: 1647463353001,
			}]),
			sdk.load(botId, queue1, { useQueuePartition: true })
		);
		expect(firehosePutRecordBatch).is.not.called;
		expect(kinesisPutRecords).is.called;

		uncompressKinesis(kinesisPutRecords.getCall(0).args[0].Records);
		assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
			"Records": [
				{
					"Data": [
						{ "id": "mock-bot-id", "event": "mock-out-queue-1", "payload": { "hello": "world" }, "event_source_timestamp": 1647463353000, "timestamp": 1647463353000, "eid": 0 },
						{ "id": "mock-bot-id", "event": "mock-out-queue-2", "payload": { "good": "bye" }, "event_source_timestamp": 1647463353001, "timestamp": 1647463353001, "eid": 1 }
					].map(j => JSON.stringify(j)).join("\n") + "\n",
					"ExplicitHashKey": undefined,
					"PartitionKey": "mock-out-queue-1"
				}
			],
			"StreamName": "mock-LeoKinesisStream"
		});

	});

	it('Writes To a Queue shard w/ 2 queues reversed', async function () {
		let queue1 = "mock-out-queue-1";
		let queue2 = "mock-out-queue-2";
		let botId = "mock-bot-id";


		let { kinesisPutRecords, firehosePutRecordBatch } = setupTest();

		let sdk = new RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		await ls.pipeAsync(
			ls.eventstream.readArray([{
				id: botId,
				event: queue2,
				payload: { hello: "world" },
				event_source_timestamp: 1647463353000,
				timestamp: 1647463353000,
			}, {
				id: botId,
				event: queue1,
				payload: { good: "bye" },
				event_source_timestamp: 1647463353001,
				timestamp: 1647463353001,
			}]),
			sdk.load(botId, queue1, { useQueuePartition: true })
		);
		expect(firehosePutRecordBatch).is.not.called;
		expect(kinesisPutRecords).is.called;
		uncompressKinesis(kinesisPutRecords.getCall(0).args[0].Records);
		assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
			"Records": [
				{
					"Data": [
						{ "id": "mock-bot-id", "event": "mock-out-queue-2", "payload": { "hello": "world" }, "event_source_timestamp": 1647463353000, "timestamp": 1647463353000, "eid": 0 },
						{ "id": "mock-bot-id", "event": "mock-out-queue-1", "payload": { "good": "bye" }, "event_source_timestamp": 1647463353001, "timestamp": 1647463353001, "eid": 1 }
					].map(j => JSON.stringify(j)).join("\n") + "\n",
					"ExplicitHashKey": undefined,
					"PartitionKey": "mock-out-queue-2"
				}
			],
			"StreamName": "mock-LeoKinesisStream"
		});

	});

	it('Writes To a default shard', async function () {
		let queue = "mock-out-queue";
		let botId = "mock-bot-id";


		let { kinesisPutRecords, firehosePutRecordBatch } = setupTest();

		let sdk = new RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		await ls.pipeAsync(
			ls.eventstream.readArray([{
				id: botId,
				payload: { hello: "world" },
				event_source_timestamp: 1647463353000,
				timestamp: 1647463353000,
			}, {
				id: botId,
				payload: { good: "bye" },
				event_source_timestamp: 1647463353001,
				timestamp: 1647463353001,
			}]),
			sdk.load(botId, queue, { useQueuePartition: false })
		);
		expect(firehosePutRecordBatch).is.not.called;
		expect(kinesisPutRecords).is.called;
		uncompressKinesis(kinesisPutRecords.getCall(0).args[0].Records);
		assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
			"Records": [
				{
					"Data": [
						{ "id": "mock-bot-id", "payload": { "hello": "world" }, "event_source_timestamp": 1647463353000, "timestamp": 1647463353000, "event": "mock-out-queue", "eid": 0 },
						{ "id": "mock-bot-id", "payload": { "good": "bye" }, "event_source_timestamp": 1647463353001, "timestamp": 1647463353001, "event": "mock-out-queue", "eid": 1 }
					].map(j => JSON.stringify(j)).join("\n") + "\n",
					"ExplicitHashKey": "0",
					"PartitionKey": "0"
				}
			],
			"StreamName": "mock-LeoKinesisStream"
		});

	});


	it('Writes To a explicit shard', async function () {
		let queue = "mock-out-queue";
		let botId = "mock-bot-id";


		let { kinesisPutRecords, firehosePutRecordBatch } = setupTest();

		let sdk = new RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		await ls.pipeAsync(
			ls.eventstream.readArray([{
				id: botId,
				payload: { hello: "world" },
				event_source_timestamp: 1647463353000,
				timestamp: 1647463353000,
			}, {
				id: botId,
				payload: { good: "bye" },
				event_source_timestamp: 1647463353001,
				timestamp: 1647463353001,
			}]),
			sdk.load(botId, queue, { useQueuePartition: false, partitionHashKey: "12" })
		);
		expect(firehosePutRecordBatch).is.not.called;
		expect(kinesisPutRecords).is.called;
		uncompressKinesis(kinesisPutRecords.getCall(0).args[0].Records);
		assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
			"Records": [
				{
					"Data": [
						{ "id": "mock-bot-id", "payload": { "hello": "world" }, "event_source_timestamp": 1647463353000, "timestamp": 1647463353000, "event": "mock-out-queue", "eid": 0 },
						{ "id": "mock-bot-id", "payload": { "good": "bye" }, "event_source_timestamp": 1647463353001, "timestamp": 1647463353001, "event": "mock-out-queue", "eid": 1 }
					].map(j => JSON.stringify(j)).join("\n") + "\n",
					"ExplicitHashKey": "12",
					"PartitionKey": "0"
				}
			],
			"StreamName": "mock-LeoKinesisStream"
		});

	});
});
