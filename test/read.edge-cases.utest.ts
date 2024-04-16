import RStreamsSdk, { ReadEvent } from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import AWS, { Credentials, Kinesis } from "aws-sdk";
import { gzipSync, gunzipSync } from "zlib";
import streams from "../lib/streams";
import fs, { WriteStream } from "fs";
import zlib from "zlib";
import util from "../lib/aws-util";
import awsSdkSync from "../lib/aws-sdk-sync";
import { ReadableStream } from "../lib/types";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

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

describe('sdk.read edge cases', function () {
	let sandbox: sinon.SinonSandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
		process.env.LEO_LOGGER = "/.*/tide";
		delete require.cache[require.resolve("leo-logger")];
	});
	afterEach(() => {
		sandbox.restore();

		delete process.env.LEO_LOGGER;
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

	it('Read byte limit - call destroy early', async function () {

		this.timeout(100000);
		let queue = "mock-queue";
		let botId = "mock-bot-id";


		let builder = new BusStreamMockBuilder();
		let eventsPerRecord = 100000 * 10;
		let lastNow = 1647460979244;
		for (let l = 0; l < 1; l++) {
			builder.addEvents(
				queue,
				Array(eventsPerRecord).fill(0).map((i, a) => ({ payload: { data: (eventsPerRecord * l) + a } })), { now: lastNow++, asS3: true }, { id: "mock-prev-bot-id" }
			);
		}
		let queryResponse = builder.getAll(queue);
		let query = sandbox.stub();
		queryResponse.forEach((data, index) => {
			query.onCall(index).callsArgWith(1, null, data);
		});
		let batchGetResponse = {
			Responses: {
				"mock-LeoEvent": [
					{
						event: queue,
						max_eid: streams.eventIdFromTimestamp(lastNow),
						v: 2,
						timestamp: lastNow
					}
				],
				"mock-LeoCron": []
			},
			UnprocessedKeys: {}
		};

		let batchGet = sandbox.stub()
			.onFirstCall().callsArgWith(1, null, batchGetResponse);


		sandbox.stub(DynamoDBDocument, 'from').returns({ batchGet, query } as unknown as DynamoDBDocument);

		let sdk = RStreamsSdk(mockSdkConfig);
		let ls = sdk.streams;

		let events = await new Promise((resolve, reject) => {
			ls.pipe(
				sdk.read(botId, queue, {
					size: 2000,
					start: ls.eventIdFromTimestamp(1647460979244),
					hooks: {
						getS3Stream: (streamRecord, i) => {
							let stream = sdk.streams.eventstream.readArray([(streamRecord as any).s3_content]) as unknown as ReadableStream<any> & { idOffset: number };
							stream.idOffset = 0;
							return stream;
						}
					}
				}),
				ls.eventstream.writeArray((err: any, results: unknown) => {
					err ? reject(err) : resolve(results);
				})
			);
		});
		let expectedEvents = Array(27).fill(0).map((_, i) => ({
			"eid": "z/2022/03/16/20/02/1647460979244-" + i.toString().padStart(7, "0"),
			"event": "mock-queue",
			"id": "mock-prev-bot-id",
			"payload": {
				"data": i
			},
			"size": 73 + (Buffer.byteLength(i.toString()) * 2)

		}));
		// [
		// 	{
		// 		"eid": "z/2022/03/16/20/02/1647460979244-0000000",
		// 		"event": "mock-queue",
		// 		"id": "mock-prev-bot-id",
		// 		"payload": {
		// 			"data": 0
		// 		},
		// 		"size": 75
		// 	},
		// 	{
		// 		"eid": "z/2022/03/16/20/02/1647460979244-0000001",
		// 		"event": "mock-queue",
		// 		"id": "mock-prev-bot-id",
		// 		"payload": {
		// 			"data": 1
		// 		},
		// 		"size": 75
		// 	}
		// ];
		assert.deepEqual(events, expectedEvents);
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
			...(options.asS3 ? {
				s3: {
					bucket: "none",
					key: "index:" + this.items[queue].length,
				},
				offsets: [{
					size: Buffer.byteLength(asString),
					gzipOffset: 0,
					gzipSize: Buffer.byteLength(gzip),
					records: count,
					start: 0,
					event: queue,
					end: count - 1,
					offset: 0,

				}],
				s3_content: gzip,
			} : {
				gzip: gzip
			}),

			gzipSize: Buffer.byteLength(gzip),
			records: count,
			start: eid + "0000000",
			end: eid + (((options.offset || 0) + count) - 1).toString().padStart(7, "0")
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
