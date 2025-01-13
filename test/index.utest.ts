
import { AwsCredentialIdentity, } from "@smithy/types";
import RStreamsSdk, { ReadEvent } from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import { ListBucketsOutput, S3 } from "@aws-sdk/client-s3";
import { Kinesis, PutRecordsCommandOutput } from "@aws-sdk/client-kinesis";
import { Firehose, PutRecordBatchOutput } from "@aws-sdk/client-firehose";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { gzipSync, gunzipSync } from "zlib";
import streams from "../lib/streams";
import fs, { WriteStream } from "fs";
import zlib from "zlib";
import util from "../lib/aws-util";
import awsSdkSync from "../lib/aws-sdk-sync";
import { Upload } from "@aws-sdk/lib-storage";
import { STSClient } from "@aws-sdk/client-sts";
import * as stsIni from "@aws-sdk/credential-provider-ini";
chai.use(sinonchai);

const AwsMocks = [];

const nodeVersion = parseInt(process.version.split(/[v.]/)[1]);

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

let envVars = ["RSTREAMS_CONFIG", "RSTREAMS_CONFIG_SECRET"];
let keys = [
	"Region",
	"LeoStream",
	"LeoCron",
	"LeoEvent",
	"LeoS3",
	"LeoKinesisStream",
	"LeoFirehoseStream",
	"LeoSettings"
];


function removeEmpty(obj: any) {
	Object.entries(obj || {}).forEach(([key, value]) => {
		if (value === undefined) {
			delete obj[key];
		}
	});
	return obj;
}
describe('index', function () {
	let sandbox: sinon.SinonSandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
		AwsMocks.forEach(m => m.reset());
	});
	afterEach(() => {
		sandbox.restore();
		AwsMocks.forEach(m => m.restore());
		envVars.forEach(field => {
			delete process.env[field];
			delete process[field];
			delete global[field];
			keys.forEach(key => {
				delete process.env[`${field}_${key}`];
			});
		});

		delete process.env.LEO_ENVIRONMENT;
		delete require("leo-config").leosdk;
		delete require("leo-config").leoaws;
		delete global.leosdk;
		delete (process as any).__config;
	});
	after(() => {
		delete require[require.resolve("leo-config")];
	});

	describe('sdk.read/write', function () {

		it('AWS Mock Test', async function () {
			let response1: ListBucketsOutput = {
				Buckets: [
					{ Name: 'Some-Bucket', CreationDate: new Date("2021-03-01T23:34:09.000Z") },
					{ Name: 'Some-Other-Bucket', CreationDate: new Date("2012-12-05T23:00:08.000Z") },
				],
				Owner: {
					DisplayName: 'DisplayName1',
					ID: '123'
				}
			};
			let response2: ListBucketsOutput = {
				Buckets: [
					{ Name: 'Different-Bucket', CreationDate: new Date("2021-03-01T23:34:09.000Z") },
				],
				Owner: {
					DisplayName: 'DisplayName2',
					ID: '4456'
				}
			};

			sandbox.stub(S3.prototype, "listBuckets")
				.onFirstCall().resolves(response1)
				.onSecondCall().resolves(response2);


			// Create a service and call it 3 times
			let s3 = new S3({});
			assert.deepEqual(await s3.listBuckets({}), response1);
			assert.deepEqual(await s3.listBuckets({}), response2);

		});


		it('Reads From a Queue', async function () {
			let queue = "mock-queue";
			let botId = "mock-bot-id";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: queue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": []
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				queue,
				[
					{
						data: 1
					}, {
						data: 2
					}
				].map(a => ({ payload: a })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(queue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query } as unknown as DynamoDBDocument);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			let events = await new Promise((resolve, reject) => {
				ls.pipe(
					sdk.read(botId, queue, { start: ls.eventIdFromTimestamp(1647460979244) }),
					ls.eventstream.writeArray((err: any, results: unknown) => {
						err ? reject(err) : resolve(results);
					})
				);
			});
			let expectedEvents = [
				{
					"eid": "z/2022/03/16/20/02/1647460979244-0000000",
					"event": "mock-queue",
					"id": "mock-prev-bot-id",
					"payload": {
						"data": 1
					},
					"size": 75
				},
				{
					"eid": "z/2022/03/16/20/02/1647460979244-0000001",
					"event": "mock-queue",
					"id": "mock-prev-bot-id",
					"payload": {
						"data": 2
					},
					"size": 75
				}
			];
			assert.deepEqual(events, expectedEvents);
		});


		it('Writes To a Queue GZip', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

			let kinesisPutRecordsResponse: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};

			let kinesisPutRecords = sandbox.stub(Kinesis.prototype, "putRecords")
				.callsArgWith(1, null, kinesisPutRecordsResponse);

			let firehosePutRecordBatch = sandbox.stub(Firehose.prototype, 'putRecordBatch').callsArgWith(1, "Shouldn't call firehose");

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			//			{"id":"mock-bot-id","payload":{"hello":"world"},"event_source_timestamp":1647463353000,"timestamp":1647463353000,"event":"mock-out-queue","eid":0}
			//{"id":"mock-bot-id","payload":{"good":"bye"},"event_source_timestamp":1647463353001,"timestamp":1647463353001,"event":"mock-out-queue","eid":1}
			await new Promise((resolve, reject) => {
				ls.pipe(
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
					sdk.load(botId, queue, {}),
					(err) => err ? reject(err) : resolve(undefined)
				);
			});
			expect(firehosePutRecordBatch).is.not.called;
			expect(kinesisPutRecords).is.called;
			let expectedData = "H4sIAAAAAAAACo3OwQqDMAwG4LuPkXMLLXUOfBmpGqasXZymDil991VhR3HH5A/5vwhjDzV46p6yJZZ5EjDZzZHN+wgDOkf54EOz6yEJwBVf3CwU5g4bHj0ubP0Eta7Ke1kZczNKKQHnyfHgV0mB5TtgwNyKu0SlIl6QHkR73m74r0efevSVR6fiC2oPrJkjAQAA";
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString();
			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": zlib.gunzipSync(Buffer.from(expectedData, "base64")).toString() as unknown as Uint8Array,
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});

		});

		it('Writes To a Queue Firehose', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";


			let kinesisPutRecords = sandbox.stub();

			let firehosePutRecordBatch = sandbox.stub();

			let firehosePutRecordBatchRespone: PutRecordBatchOutput = {
				FailedPutCount: 0,
				RequestResponses: [{
					RecordId: "mock-record-id",
					ErrorCode: undefined,
					ErrorMessage: undefined,
				}]
			};
			firehosePutRecordBatch
				.callsArgWith(1, null, firehosePutRecordBatchRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);
			sandbox.stub(Firehose.prototype, 'putRecordBatch').callsFake(firehosePutRecordBatch);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			//			{"id":"mock-bot-id","payload":{"hello":"world"},"event_source_timestamp":1647463353000,"timestamp":1647463353000,"event":"mock-out-queue","eid":0}
			//{"id":"mock-bot-id","payload":{"good":"bye"},"event_source_timestamp":1647463353001,"timestamp":1647463353001,"event":"mock-out-queue","eid":1}
			await new Promise((resolve, reject) => {
				ls.pipe(
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
					sdk.load(botId, queue, { firehose: true }),
					(err) => err ? reject(err) : resolve(undefined)
				);
			});
			expect(firehosePutRecordBatch).is.called;
			expect(kinesisPutRecords).is.not.called;

			let expectedData = {
				Records: [
					{
						Data: '{"id":"mock-bot-id","payload":{"hello":"world"},"event_source_timestamp":1647463353000,"timestamp":1647463353000,"event":"mock-out-queue","eid":0}\n' +
							'{"id":"mock-bot-id","payload":{"good":"bye"},"event_source_timestamp":1647463353001,"timestamp":1647463353001,"event":"mock-out-queue","eid":1}\n'
					}
				],
				DeliveryStreamName: 'mock-LeoFirehoseStream'
			};

			let actual = firehosePutRecordBatch.getCall(0).args[0];
			actual.Records[0].Data = actual.Records[0].Data.toString();
			assert.deepEqual(actual, expectedData);

		});

		it('Writes To a Queue S3', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			let firehosePutRecordBatch = sandbox.stub();

			sandbox.stub(Upload.prototype, "done").resolves();
			sandbox.stub(Kinesis.prototype, "putRecords").callsFake(kinesisPutRecords);
			sandbox.stub(Firehose.prototype, "putRecordBatch").callsFake(firehosePutRecordBatch);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			await new Promise((resolve, reject) => {
				ls.pipe(
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
					sdk.load(botId, queue, { useS3: true }),
					(err) => err ? reject(err) : resolve(undefined)
				);
			});
			expect(firehosePutRecordBatch).is.not.called;
			expect(kinesisPutRecords).is.called;
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				r.Data = JSON.parse(gunzipSync(r.Data).toString());

				// Verify s3 field exists.  This has a uuid in it will be random
				assert.exists(r.Data.s3);
				assert.equal(r.Data.s3.bucket, "mock-leos3");
				assert(r.Data.s3.key.match(/^bus\/mock-out-queue\/mock-bot-id\/z.*\.gz$/));
				delete r.Data.s3;

				// TODO: Why are this not predictable or based on the data passed in
				assert.exists(r.Data.timestamp);
				assert.exists(r.Data.event_source_timestamp);
				delete r.Data.event_source_timestamp;
				delete r.Data.timestamp;

			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {

				"StreamName": "mock-LeoKinesisStream",
				"Records": [
					{
						"Data": {
							"correlations": [
								{}
							],
							"end": 1,
							"event": "mock-out-queue",
							"gzipSize": nodeVersion >= 18 ? 146 : 147,
							"offsets": [
								{
									"end": 1,
									"event": "mock-out-queue",
									"gzipOffset": 0,
									"gzipSize": nodeVersion >= 18 ? 146 : 147,
									"offset": 0,
									"records": 2,
									"size": 291,
									"start": 0
								}
							],
							"records": 2,
							"size": 291,
							"start": null,
							"stats": {
								"mock-bot-id": {
									"checkpoint": 1,
									"end": 1647463353001,
									"start": 1647463353001,
									"units": 2,
								}
							}
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0",
					}
				]
			});

		});

		it('Writes To a Queue GZip with large payload', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			let firehosePutRecordBatch = sandbox.stub();


			sandbox.stub(Upload.prototype, "done").resolves();
			sandbox.stub(Kinesis.prototype, "putRecords").callsFake(kinesisPutRecords);
			sandbox.stub(Firehose.prototype, "putRecordBatch").callsFake(firehosePutRecordBatch);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			await ls.pipeAsync(
				ls.eventstream.readArray([{
					id: botId,
					payload: { hello: "world" },
					event_source_timestamp: 1647463353000,
					timestamp: 1647463353000,
				}, {
					id: botId,
					payload: { good: "A".repeat(1024 * 200 * 3) },
					event_source_timestamp: 1647463353001,
					timestamp: 1647463353001,
				}]),
				sdk.load(botId, queue, {})
			);
			expect(firehosePutRecordBatch).is.not.called;
			expect(kinesisPutRecords).is.called;
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				r.Data = JSON.parse(gunzipSync(r.Data).toString());
				// Verify s3 field exists.  This has a uuid in it will be random
				if (r.Data.s3) {
					assert.equal(r.Data.s3.bucket, "mock-leos3");
					assert(r.Data.s3.key.match(/^bus\/mock-out-queue\/mock-bot-id\/z.*\.gz$/));
					delete r.Data.s3;

					// TODO: Why are this not predictable or based on the data passed in
					assert.exists(r.Data.timestamp);
					assert.exists(r.Data.event_source_timestamp);
					delete r.Data.event_source_timestamp;
					delete r.Data.timestamp;
				}
			});

			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": {
							"id": "mock-bot-id",
							"payload": { "hello": "world" },
							"event_source_timestamp": 1647463353000,
							"timestamp": 1647463353000,
							"event": "mock-out-queue",
							"eid": 0
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					},
					{
						"Data": {
							"event": "mock-out-queue",
							"start": null,
							"end": 0,
							"offsets": [{ "event": "mock-out-queue", "start": 0, "end": 0, "records": 1, "gzipSize": nodeVersion >= 18 ? 740 : 741, "size": 614541, "offset": 0, "gzipOffset": 0 }], "gzipSize": nodeVersion >= 18 ? 740 : 741, "size": 614541, "records": 1, "stats": { "mock-bot-id": { "start": 1647463353001, "end": 1647463353001, "units": 1, "checkpoint": 0 } },
							"correlations": [{}]
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});

		});

		it('Writes To a Queue GZip with large payload and back', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			let firehosePutRecordBatch = sandbox.stub();

			sandbox.stub(Upload.prototype, "done").resolves();
			sandbox.stub(Kinesis.prototype, "putRecords").callsFake(kinesisPutRecords);
			sandbox.stub(Firehose.prototype, "putRecordBatch").callsFake(firehosePutRecordBatch);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			await ls.pipeAsync(
				ls.eventstream.readArray([{
					id: botId,
					payload: { hello: "world" },
					event_source_timestamp: 1647463353000,
					timestamp: 1647463353000,
				}, {
					id: botId,
					payload: { good: "A".repeat(1024 * 200 * 3) },
					event_source_timestamp: 1647463353001,
					timestamp: 1647463353001,
				}, {
					id: botId,
					payload: { hello: "world again" },
					event_source_timestamp: 1647463353002,
					timestamp: 1647463353003,
				}]),
				sdk.load(botId, queue, {})
			);
			expect(firehosePutRecordBatch).is.not.called;
			expect(kinesisPutRecords).is.called;
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				r.Data = JSON.parse(gunzipSync(r.Data).toString());
				// Verify s3 field exists.  This has a uuid in it will be random
				if (r.Data.s3) {
					assert.equal(r.Data.s3.bucket, "mock-leos3");
					assert(r.Data.s3.key.match(/^bus\/mock-out-queue\/mock-bot-id\/z.*\.gz$/));
					delete r.Data.s3;

					// TODO: Why are this not predictable or based on the data passed in
					assert.exists(r.Data.timestamp);
					assert.exists(r.Data.event_source_timestamp);
					delete r.Data.event_source_timestamp;
					delete r.Data.timestamp;
				}
			});

			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": {
							"id": "mock-bot-id",
							"payload": { "hello": "world" },
							"event_source_timestamp": 1647463353000,
							"timestamp": 1647463353000,
							"event": "mock-out-queue",
							"eid": 0
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					},
					{
						"Data": {
							"event": "mock-out-queue",
							"start": null,
							"end": 0,
							"offsets": [{ "event": "mock-out-queue", "start": 0, "end": 0, "records": 1, "gzipSize": nodeVersion >= 18 ? 740 : 741, "size": 614541, "offset": 0, "gzipOffset": 0 }], "gzipSize": nodeVersion >= 18 ? 740 : 741, "size": 614541, "records": 1, "stats": { "mock-bot-id": { "start": 1647463353001, "end": 1647463353001, "units": 1, "checkpoint": 0 } },
							"correlations": [{}]
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					},
					{
						"Data": {
							"eid": 0,
							"event": "mock-out-queue",
							"event_source_timestamp": 1647463353002,
							"id": "mock-bot-id",
							"payload": {
								"hello": "world again"
							},
							"timestamp": 1647463353003
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});
		});


		it('Writes To a Queue GZip with large payload - sdk.write', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			let firehosePutRecordBatch = sandbox.stub();

			sandbox.stub(Upload.prototype, "done").resolves();
			sandbox.stub(Kinesis.prototype, "putRecords").callsFake(kinesisPutRecords);
			sandbox.stub(Firehose.prototype, "putRecordBatch").callsFake(firehosePutRecordBatch);

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			await ls.pipeAsync(
				ls.eventstream.readArray([{
					id: botId,
					event: queue,
					payload: { hello: "world" },
					event_source_timestamp: 1647463353000,
					timestamp: 1647463353000,
				}, {
					id: botId,
					event: queue,
					payload: { good: "A".repeat(1024 * 200 * 3) },
					event_source_timestamp: 1647463353001,
					timestamp: 1647463353001,
				}]),
				sdk.write(botId, {}),
				sdk.streams.devnull()
			);
			expect(firehosePutRecordBatch).is.not.called;
			expect(kinesisPutRecords).is.called;
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				r.Data = JSON.parse(gunzipSync(r.Data).toString());
				// Verify s3 field exists.  This has a uuid in it will be random
				if (r.Data.s3) {
					assert.equal(r.Data.s3.bucket, "mock-leos3");
					assert(r.Data.s3.key.match(/^bus\/mock-out-queue\/mock-bot-id\/z.*\.gz$/));
					delete r.Data.s3;

					// TODO: Why are this not predictable or based on the data passed in
					assert.exists(r.Data.timestamp);
					assert.exists(r.Data.event_source_timestamp);
					delete r.Data.event_source_timestamp;
					delete r.Data.timestamp;
				}
			});

			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": {
							"id": "mock-bot-id",
							"payload": { "hello": "world" },
							"event_source_timestamp": 1647463353000,
							"timestamp": 1647463353000,
							"event": "mock-out-queue",
							"eid": 0
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					},
					{
						"Data": {
							"event": "mock-out-queue",
							"start": null,
							"end": 0,
							"offsets": [{ "event": "mock-out-queue", "start": 0, "end": 0, "records": 1, "gzipSize": 739, "size": 614541, "offset": 0, "gzipOffset": 0 }],
							"gzipSize": 739,
							"size": 614541,
							"records": 1,
							"stats": { "mock-bot-id": { "start": 1647463353001, "end": 1647463353001, "units": 1, "checkpoint": 0 } },
							"correlations": [{}]
						},
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});

		});
	});

	describe("sdk load config", function () {
		function AWSRequest(response: any) {
			return {
				promise: async () => {
					if (response instanceof Error) {
						throw response;
					}
					return response;
				}
			};
		}

		it("default - ignore fail", function () {
			RStreamsSdk(false as any);
		});

		it("default - fail", function () {
			try {
				RStreamsSdk();
				assert.fail("Should throw an error");
			} catch (err) {
				console.log(err);
				assert.equal(err.code, "AWSSecretsConfigurationProviderFailure");
			}
		});


		it("default - env", function () {
			process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig);
			let sdk = RStreamsSdk();
			Object.keys(mockSdkConfig).forEach(key => {
				assert.equal(sdk.configuration.resources[key], mockSdkConfig[key]);
			});
		});

		it("default - fail Secret not given", function () {
			try {
				RStreamsSdk();
				assert.fail("Should throw an error");
			} catch (err) {
				assert.equal(err.message, "Secret not specified.  Use ENV var RSTREAMS_CONFIG_SECRET.");
			}
		});

		it("default - fail Secret doesn't exist", function () {
			try {
				let getSecretValue = sandbox.stub().throws(
					//AWSRequest(
					util.error(
						new Error("Secrets Manager can't find the specified secret."),
						{
							code: "ResourceNotFoundException"
						}
					)
					//)
				);
				sandbox.stub(awsSdkSync, 'SecretsManager').returns({ getSecretValue });

				process.env.RSTREAMS_CONFIG_SECRET = "some-random-secret-should-not-exist";
				RStreamsSdk();
				assert.fail("Should throw an error");
			} catch (err) {
				assert.equal(err.message, "Secret 'some-random-secret-should-not-exist' not available. ResourceNotFoundException: Secrets Manager can't find the specified secret.");
			}
		});

		it("default - fail Secret don't have access", async function () {
			try {
				let getSecretValue = sandbox.stub().throws(
					//AWSRequest(
					util.error(
						new Error("User: xyz is not authorized to perform: secretsmanager:GetSecretValue on resource: some-random-secret"),
						{
							code: "AccessDeniedException"
						}
					)
					//)
				);
				sandbox.stub(awsSdkSync, 'SecretsManager').returns({ getSecretValue });

				process.env.RSTREAMS_CONFIG_SECRET = "some-random-secret";
				RStreamsSdk();
				assert.fail("Should throw an error");
			} catch (err) {
				assert.equal(err.message, "Secret 'some-random-secret' not available. AccessDeniedException: User: xyz is not authorized to perform: secretsmanager:GetSecretValue on resource: some-random-secret");
			}
		});
	});


	describe("sdk profile load", function () {

		// it("should read an aws profile w/ STS", async function () {

		// 	require("leo-config").leoaws = {
		// 		profile: "mock-profile"
		// 	};

		// 	sandbox.stub(fs, "existsSync").returns(true);
		// 	sandbox.stub(fs, "readFileSync").onFirstCall().callsFake(() =>
		// 		"[profile mock-profile]\n" +
		// 		"source_profile = mock-profile\n" +
		// 		"mfa_serial = arn:aws:iam::mock-account:mfa/mock-user\n" +
		// 		"role_arn = arn:aws:iam::mock-account:role/mock-role"
		// 	).onSecondCall().callsFake(() => JSON.stringify({
		// 		RoleArn: "arn:aws:iam::mock-account:role/mock-role",
		// 		Credentials: {
		// 			Expiration: Date.now() + 10000
		// 		}
		// 	}));

		// 	let fakeCredentials = {
		// 		accessKeyId: "123456",
		// 		secretAccessKey: "789",
		// 		sessionToken: "456",
		// 		expiration: "123",
		// 	};
		// 	sandbox.stub(STSClient.prototype, "send").callsFake(() => {
		// 		return Promise.resolve({
		// 			Credentials: {
		// 				AccessKeyId: "123456",
		// 				SecretAccessKey: "789",
		// 				SessionToken: "456",
		// 				Expiration: "123",
		// 			}
		// 		});
		// 	});
		// 	let sdk = RStreamsSdk(mockSdkConfig);
		// 	assert.deepEqual(removeEmpty(await (sdk.configuration.credentials as any)()), fakeCredentials as unknown as AwsCredentialIdentity);
		// });

		// Couldn't find an easy way to mock ini file credentials
		// it("should read an aws profile w/ INI", async function () {

		// 	require("leo-config").leoaws = {
		// 		profile: "mock-profile"
		// 	};

		// 	sandbox.stub(fs, "existsSync").returns(true);
		// 	sandbox.stub(fs, "readFileSync").onFirstCall().callsFake(() =>
		// 		"[profile mock-profile]\n" +
		// 		"source_profile = mock-profile"
		// 	).onSecondCall().callsFake(() => JSON.stringify({
		// 		Credentials: {
		// 			Expiration: Date.now() + 100000
		// 		}
		// 	}));

		// 	let fakeCredentials = {
		// 		fake: "values-2"
		// 	};
		// 	let fromIni = stsIni.fromIni;
		// 	try {
		// 		//sandbox.stub(AWS, "SharedIniFileCredentials").returns(fakeCredentials);
		// 		//sandbox.stub(stsIni, "fromIni").returns(fakeCredentials);
		// 		//(stsIni as any).fromIni = (a) => fakeCredentials;
		// 		let sdk = RStreamsSdk(mockSdkConfig);
		// 		assert.deepEqual(await (sdk.configuration.credentials as any)(), fakeCredentials as unknown as AwsCredentialIdentity);
		// 	} finally {
		// 		//(stsIni as any).fromIni = fromIni;
		// 	}
		// });

		// it("should read an aws profile w/ INI no file", async function () {

		// 	require("leo-config").leoaws = {
		// 		profile: "mock-profile"
		// 	};

		// 	sandbox.stub(fs, "existsSync").returns(false);

		// 	let fakeCredentials = {
		// 		fake: "values-3"
		// 	};
		// 	//sandbox.stub(AWS, "SharedIniFileCredentials").returns(fakeCredentials);
		// 	let sdk = RStreamsSdk(mockSdkConfig);
		// 	assert.equal(await (sdk.configuration.credentials as any)(), fakeCredentials as unknown as AwsCredentialIdentity);
		// });
	});

	describe("sdk enrich", function () {
		let sandbox: sinon.SinonSandbox;
		beforeEach(() => {
			sandbox = sinon.createSandbox();
		});
		afterEach(() => {
			sandbox.restore();
		});
		it("enriches", function (done) {
			interface InData {
				a: string;
			}
			interface OutData {
				b: string;
			}

			let inQueue = "mock-in";
			let outQueue = "mock-out";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);

			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.enrich<InData, OutData>({
				id: botId,
				inQueue: inQueue,
				outQueue: outQueue,
				transform: function (payload, _wrapper, callback): void {
					callback(null, { b: payload.a });
				}
			}, (err) => {
				try {
					expect(update).is.called;
					let updateCallArgs = update.getCall(0).args[0];
					delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					assert.deepEqual(updateCallArgs,
						{
							"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
							"ExpressionAttributeNames": {
								"#checkpoint": "checkpoint",
								"#checkpoints": "checkpoints",
								"#event": "queue:mock-in",
								"#type": "read"
							},
							"ExpressionAttributeValues": {
								":expected": "z/2022/03/16/20/02/1647460979244",
								":value": {
									"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
									"records": 2,
									"source_timestamp": 1647460979244,
								}
							},
							"Key": {
								"id": "mock-bot"
							},
							"ReturnConsumedCapacity": "TOTAL",
							"TableName": "mock-LeoCron",
							"UpdateExpression": "set #checkpoints.#type.#event = :value"
						}
					);

					expect(kinesisPutRecords).is.called;
					let expectedData = [
						{ "id": "mock-bot", "event": "mock-out", "payload": { "b": "1" }, "event_source_timestamp": 1647460979244, "eid": 0, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000000", "units": 1 }, "timestamp": 1647460979244 },
						{ "id": "mock-bot", "event": "mock-out", "payload": { "b": "2" }, "event_source_timestamp": 1647460979244, "eid": 1, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000001", "units": 1 }, "timestamp": 1647460979244 }
					].map(d => JSON.stringify(d) + "\n").join("");
					kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
						// convert buffers to strings
						// timestamp is dynamic so replace it to be a known value
						r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString().replace(/"timestamp":\d+/g, '"timestamp":1647460979244');
					});
					assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
						"Records": [
							{
								"Data": expectedData,
								"ExplicitHashKey": "0",
								"PartitionKey": "0"
							}
						],
						"StreamName": "mock-LeoKinesisStream"
					});

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});

		it("enriches Async", async function () {
			interface InData {
				a: string;
			}
			interface OutData {
				b: string;
			}

			let inQueue = "mock-in";
			let outQueue = "mock-out";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);

			let sdk = RStreamsSdk(mockSdkConfig);
			await sdk.enrichEvents<InData, OutData>({
				id: botId,
				inQueue: inQueue,
				outQueue: outQueue,
				transform: async function (payload) {
					return { b: payload.a };
				}
			});
			expect(update).is.called;
			let updateCallArgs = update.getCall(0).args[0];
			delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
			delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
			assert.deepEqual(updateCallArgs,
				{
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:mock-in",
						"#type": "read"
					},
					"ExpressionAttributeValues": {
						":expected": "z/2022/03/16/20/02/1647460979244",
						":value": {
							"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
							"records": 2,
							"source_timestamp": 1647460979244,
						}
					},
					"Key": {
						"id": "mock-bot"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "mock-LeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				}
			);

			expect(kinesisPutRecords).is.called;
			let expectedData = [
				{ "event": "mock-out", "payload": { "b": "1" }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 0, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000000", "units": 1 }, "timestamp": 1647460979244 },
				{ "event": "mock-out", "payload": { "b": "2" }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 1, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000001", "units": 1 }, "timestamp": 1647460979244 }
			].map(d => JSON.stringify(d) + "\n").join("");
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				// timestamp is dynamic so replace it to be a known value
				r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString().replace(/"timestamp":\d+/g, '"timestamp":1647460979244');
			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": expectedData,
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});


			//-      "Data": "{\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"
			//+      "Data": "{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"

		});

		it("enriches Async - Return Array", async function () {
			interface InData {
				a: string;
			}
			interface OutData {
				b: string;
			}

			let inQueue = "mock-in";
			let outQueue = "mock-out";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);

			let sdk = RStreamsSdk(mockSdkConfig);
			await sdk.enrichEvents<InData, OutData>({
				id: botId,
				inQueue: inQueue,
				outQueue: outQueue,
				transform: async function (payload) {
					return [{ b: payload.a }, { b: payload.a * 10 }];
				}
			});
			expect(update).is.called;
			let updateCallArgs = update.getCall(0).args[0];
			delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
			delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
			assert.deepEqual(updateCallArgs,
				{
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:mock-in",
						"#type": "read"
					},
					"ExpressionAttributeValues": {
						":expected": "z/2022/03/16/20/02/1647460979244",
						":value": {
							"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
							"records": 4,
							"source_timestamp": 1647460979244,
						}
					},
					"Key": {
						"id": "mock-bot"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "mock-LeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				}
			);

			expect(kinesisPutRecords).is.called;
			let expectedData = [
				{ "event": "mock-out", "payload": { "b": "1" }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 0, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000000", "units": 1 }, "timestamp": 1647460979244 },
				{ "event": "mock-out", "payload": { "b": 10 }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 1, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000000", "units": 1 }, "timestamp": 1647460979244 },
				{ "event": "mock-out", "payload": { "b": "2" }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 2, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000001", "units": 1 }, "timestamp": 1647460979244 },
				{ "event": "mock-out", "payload": { "b": 20 }, "id": "mock-bot", "event_source_timestamp": 1647460979244, "eid": 3, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000001", "units": 1 }, "timestamp": 1647460979244 }
			];//.map(d => JSON.stringify(d) + "\n").join("");
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				// timestamp is dynamic so replace it to be a known value
				r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString().replace(/"timestamp":\d+/g, '"timestamp":1647460979244').split("\n").map((d) => d && JSON.parse(d)).filter(a => a);
			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": expectedData,
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});


			//-      "Data": "{\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"
			//+      "Data": "{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"

		});

		it("enriches Async w/ Overrides", async function () {
			interface InData {
				a: string;
			}
			interface OutData {
				b: string;
			}

			let inQueue = "mock-in";
			let outQueue = "mock-out";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);

			let sdk = RStreamsSdk(mockSdkConfig);
			await sdk.enrichEvents<InData, OutData>({
				id: botId,
				inQueue: inQueue,
				outQueue: outQueue,
				transform: function (payload, w, done) {
					this.push({ b: payload.a });
					//return { b: payload.a };
					done(null, true, { units: 0 });
				}
			});
			expect(update).is.called;
			let updateCallArgs = update.getCall(0).args[0];
			delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
			delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
			assert.deepEqual(updateCallArgs,
				{
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:mock-in",
						"#type": "read"
					},
					"ExpressionAttributeValues": {
						":expected": "z/2022/03/16/20/02/1647460979244",
						":value": {
							"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
							"records": 4,
							"source_timestamp": 1647460979244,
						}
					},
					"Key": {
						"id": "mock-bot"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "mock-LeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				}
			);

			expect(kinesisPutRecords).is.called;
			let expectedData = [
				{ "id": "mock-bot", "event": "mock-out", "payload": { "b": "1" }, "event_source_timestamp": 1647460979244, "eid": 0, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000000", "units": 1 }, "timestamp": 1647460979244 },
				{ "id": "mock-bot", "event": "mock-out", "payload": { "b": "2" }, "event_source_timestamp": 1647460979244, "eid": 1, "correlation_id": { "source": "mock-in", "start": "z/2022/03/16/20/02/1647460979244-0000001", "units": 1 }, "timestamp": 1647460979244 }
			].map(d => JSON.stringify(d) + "\n").join("");
			kinesisPutRecords.getCall(0).args[0].Records.forEach((r: { Data: any; }) => {
				// convert buffers to strings
				// timestamp is dynamic so replace it to be a known value
				r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString().replace(/"timestamp":\d+/g, '"timestamp":1647460979244');
			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": expectedData,
						"ExplicitHashKey": "0",
						"PartitionKey": "0"
					}
				],
				"StreamName": "mock-LeoKinesisStream"
			});


			//-      "Data": "{\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"id\":\"mock-bot\",\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"
			//+      "Data": "{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"1\"},\"event_source_timestamp\":1647460979244,\"eid\":0,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000000\",\"units\":1},\"timestamp\":1647460979244}\n{\"id\":\"mock-bot\",\"event\":\"mock-out\",\"payload\":{\"b\":\"2\"},\"event_source_timestamp\":1647460979244,\"eid\":1,\"correlation_id\":{\"source\":\"mock-in\",\"start\":\"z/2022/03/16/20/02/1647460979244-0000001\",\"units\":1},\"timestamp\":1647460979244}\n"

		});


		it("enriches Async -Return true", async function () {
			interface InData {
				a: string;
			}
			interface OutData {
				b: string;
			}

			let inQueue = "mock-in";
			let outQueue = "mock-out";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);

			let kinesisPutRecordsRespone: Partial<PutRecordsCommandOutput> = {
				Records: [{
					SequenceNumber: "0",
					ShardId: "shard-0"
				}]
			};
			let kinesisPutRecords = sandbox.stub();
			kinesisPutRecords
				.callsArgWith(1, null, kinesisPutRecordsRespone);

			sandbox.stub(Kinesis.prototype, 'putRecords').callsFake(kinesisPutRecords);

			let sdk = RStreamsSdk(mockSdkConfig);
			async function returnsTrue() {
				return true;
			}
			await sdk.enrichEvents<InData, OutData>({
				id: botId,
				inQueue: inQueue,
				outQueue: outQueue,
				transform: returnsTrue
			});
			expect(update).is.called;
			let updateCallArgs = update.getCall(0).args[0];
			delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
			delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
			assert.deepEqual(updateCallArgs,
				{
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:mock-in",
						"#type": "read"
					},
					"ExpressionAttributeValues": {
						":expected": "z/2022/03/16/20/02/1647460979244",
						":value": {
							"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
							"records": 2,
							"source_timestamp": 1647460979244,
						}
					},
					"Key": {
						"id": "mock-bot"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "mock-LeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				}
			);

			expect(kinesisPutRecords).is.not.called;
		});
	});

	describe("sdk offload", function () {
		let sandbox: sinon.SinonSandbox;
		beforeEach(() => {
			sandbox = sinon.createSandbox();
		});
		afterEach(() => {
			sandbox.restore();
		});
		it("offloads", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.offload<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					callback(null, true);
				}
			}, (err) => {
				try {
					expect(update).is.called;
					let updateCallArgs = update.getCall(0).args[0];
					delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					assert.deepEqual(updateCallArgs,
						{
							"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
							"ExpressionAttributeNames": {
								"#checkpoint": "checkpoint",
								"#checkpoints": "checkpoints",
								"#event": "queue:mock-in",
								"#type": "read"
							},
							"ExpressionAttributeValues": {
								":expected": "z/2022/03/16/20/02/1647460979244",
								":value": {
									"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
									"records": 2,
									"source_timestamp": 1647460979244,
								}
							},
							"Key": {
								"id": "mock-bot"
							},
							"ReturnConsumedCapacity": "TOTAL",
							"TableName": "mock-LeoCron",
							"UpdateExpression": "set #checkpoints.#type.#event = :value"
						}
					);

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});

		it("offloads async", async function () {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let sdk = RStreamsSdk(mockSdkConfig);
			await sdk.offloadEvents<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					callback(null, true);
				}
			});
			expect(update).is.called;
			let updateCallArgs = update.getCall(0).args[0];
			delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
			delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
			assert.deepEqual(updateCallArgs,
				{
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:mock-in",
						"#type": "read"
					},
					"ExpressionAttributeValues": {
						":expected": "z/2022/03/16/20/02/1647460979244",
						":value": {
							"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
							"records": 2,
							"source_timestamp": 1647460979244,
						}
					},
					"Key": {
						"id": "mock-bot"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "mock-LeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				}
			);

		});

		it("offloads - false", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.offload<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					callback();
				}
			}, (err) => {
				try {
					expect(update).is.not.called;
					// let updateCallArgs = update.getCall(0).args[0];
					// delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					// delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					// assert.deepEqual(updateCallArgs,
					// 	{
					// 		"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
					// 		"ExpressionAttributeNames": {
					// 			"#checkpoint": "checkpoint",
					// 			"#checkpoints": "checkpoints",
					// 			"#event": "queue:mock-in",
					// 			"#type": "read"
					// 		},
					// 		"ExpressionAttributeValues": {
					// 			":expected": "z/2022/03/16/20/02/1647460979244",
					// 			":value": {
					// 				"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
					// 				"records": 2,
					// 				"source_timestamp": 1647460979244,
					// 			}
					// 		},
					// 		"Key": {
					// 			"id": "mock-bot"
					// 		},
					// 		"ReturnConsumedCapacity": "TOTAL",
					// 		"TableName": "mock-LeoCron",
					// 		"UpdateExpression": "set #checkpoints.#type.#event = :value"
					// 	}
					// );

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});

		it("offloads - mixed 1", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let i = 0;
			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.offload<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					callback(null, ++i > 1);
				}
			}, (err) => {
				try {
					expect(update).is.called;
					let updateCallArgs = update.getCall(0).args[0];
					delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					assert.deepEqual(updateCallArgs,
						{
							"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
							"ExpressionAttributeNames": {
								"#checkpoint": "checkpoint",
								"#checkpoints": "checkpoints",
								"#event": "queue:mock-in",
								"#type": "read"
							},
							"ExpressionAttributeValues": {
								":expected": "z/2022/03/16/20/02/1647460979244",
								":value": {
									"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
									"records": 1,
									"source_timestamp": 1647460979244,
								}
							},
							"Key": {
								"id": "mock-bot"
							},
							"ReturnConsumedCapacity": "TOTAL",
							"TableName": "mock-LeoCron",
							"UpdateExpression": "set #checkpoints.#type.#event = :value"
						}
					);

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});

		it("offloads - mixed 2", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let i = 0;
			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.offload<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					callback(null, ++i <= 1);
				}
			}, (err) => {
				try {
					expect(update).is.called;
					let updateCallArgs = update.getCall(0).args[0];
					delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					assert.deepEqual(updateCallArgs,
						{
							"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
							"ExpressionAttributeNames": {
								"#checkpoint": "checkpoint",
								"#checkpoints": "checkpoints",
								"#event": "queue:mock-in",
								"#type": "read"
							},
							"ExpressionAttributeValues": {
								":expected": "z/2022/03/16/20/02/1647460979244",
								":value": {
									"checkpoint": "z/2022/03/16/20/02/1647460979244-0000000",
									"records": 1,
									"source_timestamp": 1647460979244,
								}
							},
							"Key": {
								"id": "mock-bot"
							},
							"ReturnConsumedCapacity": "TOTAL",
							"TableName": "mock-LeoCron",
							"UpdateExpression": "set #checkpoints.#type.#event = :value"
						}
					);

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});

		it("offloads- batch", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);


			let batchSizes = [];
			let sdk = RStreamsSdk(mockSdkConfig);

			sdk.offload(
				{
					id: botId,
					inQueue: inQueue,
					batch: {
						count: 10
					},
					transform: function (payload: ReadEvent<InData>[], _wrapper, callback): void {
						batchSizes.push(payload.length);
						callback(null, true);
					}
				},
				(err) => {
					try {
						assert.deepEqual(batchSizes, [2]);
						expect(update).is.called;
						let updateCallArgs = update.getCall(0).args[0];
						delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
						delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
						assert.deepEqual(updateCallArgs,
							{
								"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
								"ExpressionAttributeNames": {
									"#checkpoint": "checkpoint",
									"#checkpoints": "checkpoints",
									"#event": "queue:mock-in",
									"#type": "read"
								},
								"ExpressionAttributeValues": {
									":expected": "z/2022/03/16/20/02/1647460979244",
									":value": {
										"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
										"records": 2,
										"source_timestamp": 1647460979244,
									}
								},
								"Key": {
									"id": "mock-bot"
								},
								"ReturnConsumedCapacity": "TOTAL",
								"TableName": "mock-LeoCron",
								"UpdateExpression": "set #checkpoints.#type.#event = :value"
							}
						);

					} catch (assertError) {
						err = err || assertError;
					}
					done(err);
				});
		});
		it("offloads - onCheckpoint", function (done) {
			interface InData {
				a: string;
			}

			let inQueue = "mock-in";
			let botId = "mock-bot";

			let batchGetResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};

			let batchGet = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, batchGetResponse);

			let builder = new BusStreamMockBuilder();
			builder.addEvents(
				inQueue,
				[
					{
						a: "1"
					}, {
						a: "2"
					}
				].map(a => ({ payload: a, event_source_timestamp: 1647460979244, timestamp: 1647460979244 })), { now: 1647460979244 }, { id: "mock-prev-bot-id" }
			);
			let queryResponse = builder.getAll(inQueue);
			let query = sandbox.stub();
			queryResponse.forEach((data, index) => {
				query.onCall(index).callsArgWith(1, null, data);
			});


			let updateResponse = {
				Responses: {
					"mock-LeoEvent": [
						{
							event: inQueue,
							max_eid: streams.eventIdFromTimestamp(1647460979245),
							v: 2,
							timestamp: 1647460979245
						}
					],
					"mock-LeoCron": [{
						checkpoints: {
							read: {
								[`queue:${inQueue}`]: {
									checkpoint: streams.eventIdFromTimestamp(1647460979244)
								}
							}
						}
					}]
				},
				UnprocessedKeys: {}
			};
			let update = sandbox.stub()
				.onFirstCall().callsArgWith(1, null, updateResponse);

			sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query, update } as unknown as DynamoDBDocument);

			let sideData = [];

			let sdk = RStreamsSdk(mockSdkConfig);
			sdk.offload<InData>({
				id: botId,
				inQueue: inQueue,
				transform: function (payload, _wrapper, callback): void {
					sideData.push(_wrapper);
					callback(null, true);
				},
				onCheckpoint: async (data) => {
					if (!data.error) {
						let cp = data.checkpoints[botId][`queue:${inQueue}`] || "";
						console.log("onCheckpoint", data.checkpoints[botId][`queue:${inQueue}`]);
						let nextSideData = [];
						let removedSideData = [];
						sideData.forEach(d => {
							if (d.eid <= cp) {
								removedSideData.push(d);
							} else {
								nextSideData.push(d);
							}
						});
						sideData = nextSideData;

						console.log("Removed:", removedSideData);
						await new Promise((resolve) => { setTimeout(() => resolve(undefined), 200); });
					}
				}
			}, (err) => {
				try {
					expect(update).is.called;
					let updateCallArgs = update.getCall(0).args[0];
					delete updateCallArgs.ExpressionAttributeValues[":value"].ended_timestamp;
					delete updateCallArgs.ExpressionAttributeValues[":value"].started_timestamp;
					assert.deepEqual(updateCallArgs,
						{
							"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected",
							"ExpressionAttributeNames": {
								"#checkpoint": "checkpoint",
								"#checkpoints": "checkpoints",
								"#event": "queue:mock-in",
								"#type": "read"
							},
							"ExpressionAttributeValues": {
								":expected": "z/2022/03/16/20/02/1647460979244",
								":value": {
									"checkpoint": "z/2022/03/16/20/02/1647460979244-0000001",
									"records": 2,
									"source_timestamp": 1647460979244,
								}
							},
							"Key": {
								"id": "mock-bot"
							},
							"ReturnConsumedCapacity": "TOTAL",
							"TableName": "mock-LeoCron",
							"UpdateExpression": "set #checkpoints.#type.#event = :value"
						}
					);
					assert.equal(sideData.length, 0);

				} catch (assertError) {
					err = err || assertError;
				}
				done(err);
			});
		});
	});

	describe("sdk createSource", function () {

		interface SourceData {
			data1: number;
			data2: string;
		}
		interface MySourceState {
			counter: number
		}

		it("no results", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);

			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData>(async () => {
					return [];
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output, []);
		});

		it("multiple queries", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);

			let output = [];
			let dataSource: SourceData[][] = [
				[1, 2, 3, 4, 5, 6].map(i => ({ data1: i, data2: i.toString() })),
				[10, 20, 30, 40, 50, 60].map(i => ({ data1: i, data2: i.toString() }))
			];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData>(async () => {
					return dataSource.shift();
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 1,
						"data2": "1",
					},
					{
						"data1": 2,
						"data2": "2",
					},
					{
						"data1": 3,
						"data2": "3",
					},
					{
						"data1": 4,
						"data2": "4",
					},
					{
						"data1": 5,
						"data2": "5",
					},
					{
						"data1": 6,
						"data2": "6",
					},
					{
						"data1": 10,
						"data2": "10",
					},
					{
						"data1": 20,
						"data2": "20",
					},
					{
						"data1": 30,
						"data2": "30",
					},
					{
						"data1": 40,
						"data2": "40",
					},
					{
						"data1": 50,
						"data2": "50",
					},
					{
						"data1": 60,
						"data2": "60",
					}
				]
			);
		});


		it("Error query", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);

			interface SourceData {
				data1: number;
				data2: string;
			}

			let output = [];
			let error: Error;
			try {
				await sdk.streams.pipeAsync(
					sdk.createSource<SourceData>(async () => {
						throw new Error("Some Random Error");
					}),
					sdk.streams.write((data: SourceData, done) => {
						output.push(data);
						done();
					})
				);
			} catch (err) {
				error = err;
			}

			assert.isNotNull(error);
			assert.equal(error.message, "Some Random Error");
			assert.deepEqual(output, []);
		});


		it("countdown", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);

			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData, MySourceState>(async (state) => {
					let number = state.counter;
					state.counter--;
					if (number <= 0) {
						return [];
					} else {
						return [{ data1: number, data2: number.toString() }];
					}
				}, {}, {
					counter: 10
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 10,
						"data2": "10",
					},
					{
						"data1": 9,
						"data2": "9",
					},
					{
						"data1": 8,
						"data2": "8",
					},
					{
						"data1": 7,
						"data2": "7",
					},
					{
						"data1": 6,
						"data2": "6",
					},
					{
						"data1": 5,
						"data2": "5",
					},
					{
						"data1": 4,
						"data2": "4",
					},
					{
						"data1": 3,
						"data2": "3",
					},
					{
						"data1": 2,
						"data2": "2",
					},
					{
						"data1": 1,
						"data2": "1",
					}
				],
			);
		});

		it("countdown limited", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);

			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData, MySourceState>(async (state) => {
					let number = state.counter;
					state.counter--;
					if (number <= 0) {
						return [];
					} else {
						return [{ data1: number, data2: number.toString() }];
					}
				}, {
					records: 5
				}, {
					counter: 10
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 10,
						"data2": "10",
					},
					{
						"data1": 9,
						"data2": "9",
					},
					{
						"data1": 8,
						"data2": "8",
					},
					{
						"data1": 7,
						"data2": "7",
					},
					{
						"data1": 6,
						"data2": "6",
					}
				],
			);
		});

		it("countdown time limited", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);



			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData, MySourceState>(async (state) => {
					let number = state.counter;
					state.counter--;
					if (number <= 0) {
						return;
					} else {
						await new Promise(resovle => setTimeout(() => resovle(undefined), 40));
						return [{ data1: number, data2: number.toString() }];
					}
				}, {
					milliseconds: 100
				}, {
					counter: 100
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 100,
						"data2": "100",
					},
					{
						"data1": 99,
						"data2": "99",
					}
				],
			);
		});

		it("countdown time limited but not hit", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);



			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData, MySourceState>(async (state) => {
					let number = state.counter;
					state.counter--;
					if (number <= 0) {
						return;
					} else {
						await new Promise(resovle => setTimeout(() => resovle(undefined), 40));
						return [{ data1: number, data2: number.toString() }];
					}
				}, {
					milliseconds: 10000
				}, {
					counter: 2
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 2,
						"data2": "2",
					},
					{
						"data1": 1,
						"data2": "1",
					}
				],
			);
		});

		it("countdown return undefined", async function () {
			let sdk = RStreamsSdk(mockSdkConfig);



			let output = [];
			await sdk.streams.pipeAsync(
				sdk.createSource<SourceData, MySourceState>(async (state) => {
					let number = state.counter;
					state.counter--;
					if (number <= 0) {
						return;
					} else {
						return [{ data1: number, data2: number.toString() }];
					}
				}, {}, {
					counter: 2
				}),
				sdk.streams.write((data: SourceData, done) => {
					output.push(data);
					done();
				})
			);

			assert.deepEqual(output,
				[
					{
						"data1": 2,
						"data2": "2",
					},
					{
						"data1": 1,
						"data2": "1",
					}
				],
			);
		});
	});


	describe("sdk mock", function () {
		afterEach(function () {
			delete process.env.RSTREAMS_MOCK_DATA;
		});

		// it("mock example", async function () {
		// 	return;
		// 	let sdk = require("../lib/mock")({
		// 		queues: [{ id: "some id", event: "in-queue", eid: "z/1", payload: { data: 1 } }, { id: "some id", event: "in-queue", eid: "z/2", payload: { data: 3 } }]
		// 	}, RStreamsSdk(mockSdkConfig));

		// 	await sdk.streams.pipeAsync(
		// 		sdk.read("bot-id", "in-queue"),
		// 		sdk.streams.process("bot-id", (p, e, cb) => {
		// 			cb(null, p);
		// 		}, "out-queue"),
		// 		sdk.write("bot-id", "out-queue")
		// 	);
		// 	assert.deepEqual(sdk.write.events,
		// 		[
		// 			{
		// 				"correlation_id": {
		// 					"source": "in-queue",
		// 					"start": "z/1",
		// 					"units": 1,
		// 				},
		// 				"eid": "z/1",
		// 				"event": "out-queue",
		// 				"event_source_timestamp": undefined,
		// 				"id": "bot-id",
		// 				"payload": {
		// 					"data": 1,
		// 				},
		// 			},
		// 			{
		// 				"correlation_id": {
		// 					"source": "in-queue",
		// 					"start": "z/2",
		// 					"units": 1,
		// 				},
		// 				"eid": "z/2",
		// 				"event": "out-queue",
		// 				"event_source_timestamp": undefined,
		// 				"id": "bot-id",
		// 				"payload": {
		// 					"data": 3,
		// 				},
		// 			},
		// 		],
		// 	);
		// });

		it("mocks the inner stream", async function () {
			process.env.RSTREAMS_MOCK_DATA = "test-mock-data-location";
			let sdk = RStreamsSdk(mockSdkConfig);

			let data = [];
			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "createWriteStream").callsFake(() => {
				return sdk.streams.write((d, done) => {
					data.push(d);
					done();
				}) as fs.WriteStream;
			});
			assert(sdk.streams["mocked"], "should be mocked");

			(sdk.streams as any).eventIdFromTimestamp = () => `z/2022/04/15/23/08/1650064081366-0000000`;
			await sdk.putEvent("mock-bot", "mock-queue", { event: "MockQueue", id: "MockParentBot", payload: { b: 1, c: true }, "event_source_timestamp": 1650475909406, "timestamp": 1650475909406, });

			assert.isNotNull(process.env["RSTREAMS_MOCK_DATA_Q_MockQueue"]);
			assert.deepEqual(data, [
				"{\"event\":\"MockQueue\",\"id\":\"MockParentBot\",\"payload\":{\"b\":1,\"c\":true},\"event_source_timestamp\":1650475909406,\"timestamp\":1650475909406,\"eid\":\"z/2022/04/15/23/08/1650064081366-0000000\"}\n"
			]);
		});
	});
});

class BusStreamMockBuilder {
	items = {};
	addEvents(queue: string, data: any[], options: any = {}, common: any = null) {

		let now = options.now || Date.now();
		data.forEach((event, index) => {
			Object.assign(event, common, { event: queue, eid: index });
		});
		let count = data.length;
		let eid = streams.eventIdFromTimestamp(now) + "-";
		let asString = data.map(a => JSON.stringify(a)).join("\n") + "\n";
		let gzip = gzipSync(asString);
		if (!(queue in this.items)) {
			this.items[queue] = [];
		}
		this.items[queue].push({
			size: Buffer.byteLength(asString),
			event: queue,
			v: 2,
			gzip: gzip,
			gzipSize: Buffer.byteLength(gzip),
			records: count,
			start: eid + "0000000",
			end: eid + (count - 1).toString().padStart(7, "0")
		});
	}
	getAll(queue: string, chunksSize: number = 50) {
		let items = (this.items[queue] || []);
		let results = [];
		while (items.length > 0) {
			results.push(this.getNext(queue, chunksSize));
		}
		results.push({
			Items: [],
			Count: 0,
			ScannedCount: 0,
			ConsumedCapacity: {
				TableName: "mock-LeoStream",
				CapacityUnits: 1
			}
		});
		return results;
	}
	getNext(queue: string, count: number) {
		let items = (this.items[queue] || []).splice(0, count);
		return {
			Items: items,
			Count: items.length,
			ScannedCount: items.length,
			LastEvaluatedKey: {
				event: queue,
				end: (items[items.length - 1] || {}).end
			},
			ConsumedCapacity: {
				TableName: "mock-LeoStream",
				CapacityUnits: 1
			}
		};
	}
}
