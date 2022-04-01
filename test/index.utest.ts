import RStreamsSdk from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import AWS, { Credentials, Kinesis } from "aws-sdk";
import { gzipSync, gunzipSync } from "zlib";
//import { StreamUtil } from "../lib/lib";
import streams from "../lib/streams";
import fs from "fs";
import zlib from "zlib";
chai.use(sinonchai);
//var assert = require('assert');

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

describe('RStreams', function () {
	describe('sdk.read/write', function () {
		let sandbox;
		beforeEach(() => {
			sandbox = sinon.createSandbox()
		});
		afterEach(() => {
			sandbox.restore();
		});

		it('AWS Mock Test', async function () {
			let response1: AWS.S3.ListBucketsOutput = {
				Buckets: [
					{ Name: 'Some-Bucket', CreationDate: new Date("2021-03-01T23:34:09.000Z") },
					{ Name: 'Some-Other-Bucket', CreationDate: new Date("2012-12-05T23:00:08.000Z") },
				],
				Owner: {
					DisplayName: 'DisplayName1',
					ID: '123'
				}
			};
			let response2: AWS.S3.ListBucketsOutput = {
				Buckets: [
					{ Name: 'Different-Bucket', CreationDate: new Date("2021-03-01T23:34:09.000Z") },
				],
				Owner: {
					DisplayName: 'DisplayName2',
					ID: '4456'
				}
			};

			function AWSRequest(response) {
				return { promise: async () => response };
			}

			let listBuckets = sandbox.stub()
				.onFirstCall().returns(AWSRequest(response1)) // Promise call 1
				.onSecondCall().returns(AWSRequest(response2)) // Promise call 2
				.onThirdCall().callsArgWith(0, null, response2); // Callback call 3

			sandbox.stub(AWS, 'S3').returns({ listBuckets }); // Stub the S3 service


			// Create a service and call it 3 times
			let s3 = new AWS.S3();
			assert.deepEqual(await s3.listBuckets().promise(), response1);
			assert.deepEqual(await s3.listBuckets().promise(), response2);
			assert.deepEqual(await new Promise((resolve, reject) => { s3.listBuckets((err, data) => err ? reject(err) : resolve(data)) }), response2);
			expect(listBuckets).to.be.callCount(3);

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

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ batchGet, query });

			let sdk = RStreamsSdk(mockSdkConfig);
			let ls = sdk.streams;

			let events = await new Promise((resolve, reject) => {
				ls.pipe(
					sdk.read(botId, queue, { start: ls.eventIdFromTimestamp(1647460979244) }),
					ls.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results)
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
					}
				},
				{
					"eid": "z/2022/03/16/20/02/1647460979244-0000001",
					"event": "mock-queue",
					"id": "mock-prev-bot-id",
					"payload": {
						"data": 2
					}
				}
			];
			assert.deepEqual(events, expectedEvents);
		});


		it('Writes To a Queue GZip', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

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

			//sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ batchGet, query });
			sandbox.stub(AWS, 'Kinesis').returns({ putRecords: kinesisPutRecords });
			sandbox.stub(AWS, 'Firehose').returns({ putRecordBatch: firehosePutRecordBatch });

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
			kinesisPutRecords.getCall(0).args[0].Records.forEach(r => {
				// convert buffers to strings
				r.Data = zlib.gunzipSync(Buffer.from(r.Data.toString("base64"), "base64")).toString();
			});
			assert.deepEqual(kinesisPutRecords.getCall(0).args[0], {
				"Records": [
					{
						"Data": zlib.gunzipSync(Buffer.from(expectedData, "base64")).toString(),
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

			let firehosePutRecordBatchRespone: AWS.Firehose.Types.PutRecordBatchOutput = {
				FailedPutCount: 0,
				RequestResponses: [{
					RecordId: "mock-record-id",
					ErrorCode: undefined,
					ErrorMessage: undefined,
				}]
			};
			firehosePutRecordBatch
				.callsArgWith(1, null, firehosePutRecordBatchRespone);

			//sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ batchGet, query });
			sandbox.stub(AWS, 'Kinesis').returns({ putRecords: kinesisPutRecords });
			sandbox.stub(AWS, 'Firehose').returns({ putRecordBatch: firehosePutRecordBatch });

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

			assert.deepEqual(firehosePutRecordBatch.getCall(0).args[0], expectedData);

		});

		it('Writes To a Queue S3', async function () {
			let queue = "mock-out-queue";
			let botId = "mock-bot-id";

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

			let s3Upload = (obj, callback) => {
				ls.pipe(obj.Body, ls.devnull(), (e) => callback(e));
			};


			sandbox.stub(AWS, 'S3').returns({ upload: s3Upload });
			sandbox.stub(AWS, 'Kinesis').returns({ putRecords: kinesisPutRecords });
			sandbox.stub(AWS, 'Firehose').returns({ putRecordBatch: firehosePutRecordBatch });

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
			kinesisPutRecords.getCall(0).args[0].Records.forEach(r => {
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
							"gzipSize": 147,
							"offsets": [
								{
									"end": 1,
									"event": "mock-out-queue",
									"gzipOffset": 0,
									"gzipSize": 147,
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
	});

	describe("sdk profile load", function () {
		let sandbox;
		beforeEach(() => {
			delete require("leo-config").leoaws;
			sandbox = sinon.createSandbox()
		});
		afterEach(() => {
			sandbox.restore();
		});

		it("should read an aws profile w/ STS", async function () {

			require("leo-config").leoaws = {
				profile: "mock-profile"
			};

			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "readFileSync").onFirstCall().callsFake(() =>
				"[profile mock-profile]\n" +
				"source_profile = mock-profile\n" +
				"mfa_serial = arn:aws:iam::mock-account:mfa/mock-user\n" +
				"role_arn = arn:aws:iam::mock-account:role/mock-role"
			).onSecondCall().callsFake(() => JSON.stringify({
				Credentials: {
					Expiration: Date.now() + 100000
				}
			}));

			let fakeCredentials = {
				fake: "values-1"
			};
			sandbox.stub(AWS, "STS").returns({
				credentialsFrom: sandbox.stub().callsFake(() => fakeCredentials)
			})
			let sdk = RStreamsSdk(mockSdkConfig);
			assert.equal(sdk.configuration.credentials, fakeCredentials as unknown as Credentials)
		});

		it("should read an aws profile w/ INI", async function () {

			require("leo-config").leoaws = {
				profile: "mock-profile"
			};

			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "readFileSync").onFirstCall().callsFake(() =>
				"[profile mock-profile]\n" +
				"source_profile = mock-profile"
			).onSecondCall().callsFake(() => JSON.stringify({
				Credentials: {
					Expiration: Date.now() + 100000
				}
			}));

			let fakeCredentials = {
				fake: "values-2"
			};
			sandbox.stub(AWS, "SharedIniFileCredentials").returns(fakeCredentials);
			let sdk = RStreamsSdk(mockSdkConfig);
			assert.equal(sdk.configuration.credentials, fakeCredentials as unknown as Credentials)
		});

		it("should read an aws profile w/ INI no file", async function () {

			require("leo-config").leoaws = {
				profile: "mock-profile"
			};

			sandbox.stub(fs, "existsSync").returns(false);

			let fakeCredentials = {
				fake: "values-3"
			};
			sandbox.stub(AWS, "SharedIniFileCredentials").returns(fakeCredentials);
			let sdk = RStreamsSdk(mockSdkConfig);
			assert.equal(sdk.configuration.credentials, fakeCredentials as unknown as Credentials)
		});
	});
});

class BusStreamMockBuilder {
	items = {};
	addEvents(queue: string, data: any[], options: any = {}, common: any = null) {

		let now = options.now || Date.now()
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
		})
	}
	getAll(queue: string, chunksSize: number = 50) {
		let items = (this.items[queue] || []);
		let results = []
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
		let items = (this.items[queue] || []).splice(0, count)
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
		}
	}
}
