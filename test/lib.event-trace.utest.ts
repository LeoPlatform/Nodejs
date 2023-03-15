import RStreamsSdk from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import { trace as eventTrace } from "../lib/event-trace";
import moment from "moment";

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

const STATS_TABLE = "MOCK_STATS_TABLE";

describe('lib/event-trace.ts', function () {
	let sandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});
	afterEach(() => {
		sandbox.restore();
	});
	describe("Tracing - Upstream", function () {
		it('Get Parent Events', async function () {

			let sdk = RStreamsSdk(mockSdkConfig);
			sandbox.stub(sdk.streams, "fromLeo")
				.onFirstCall().callsFake(() => sdk.streams.eventstream.readArray([
					{
						"id": "typed-sdk-enrich",
						"event": "typed-sdk-enrich-out",
						"payload": {
							"index": 34,
							"suborder_id": 73986616
						},
						"event_source_timestamp": 1641022663000,
						"eid": "z/2022/03/14/22/38/1647297513618-0000035",
						"correlation_id": {
							"source": "order-entity-old-new",
							"start": "z/2022/01/01/07/38/1641022683019-0000004",
							"units": 1
						},
						"timestamp": 1647297513413
					}
				]))
				.onSecondCall().callsFake(() => sdk.streams.eventstream.readArray([
					{
						"correlation_id": {
							"source": "source_bus_order-entity-old-new",
							"start": "z/2022/01/01/07/37/1641022664118-0000000"
						},
						"event": "order-entity-old-new",
						"event_source_timestamp": 1641022663000,
						"id": "order-entity-old-new-replicator",
						"payload": {
							"old": {},
							"new": {}
						},
						"timestamp": 1641022664017,
						"eid": "z/2022/01/01/07/38/1641022683019-0000004"
					}
				]))
				.callsFake(() => sdk.streams.eventstream.readArray([]));

			sandbox.stub(sdk.aws.dynamodb, "query").callsFake(() => Promise.resolve(require("./data/event-trace-cron-query.json")));

			let r = await eventTrace(
				sdk,
				STATS_TABLE,
				{
					eid: "z/2022/03/14/22/38/1647297513618-0000035",
					queue: "typed-sdk-enrich-out",
					children: undefined
				}
			);


			//console.log("Trace Result:");
			//console.log(JSON.stringify(r, null, 2));
			assert.deepEqual(r, {
				"parents": [
					{
						"id": "bot:order-entity-old-new-replicator",
						"server_id": "bot:order-entity-old-new-replicator",
						"type": "bot",
						"label": "order-entity-old-new-replicator"
					},
					{
						"correlation_id": {
							"source": "source_bus_order-entity-old-new",
							"start": "z/2022/01/01/07/37/1641022664118-0000000"
						},
						"event": "queue:order-entity-old-new",
						"event_source_timestamp": 1641022663000,
						"id": "queue:order-entity-old-new",
						"payload": {
							"old": {},
							"new": {}
						},
						"timestamp": 1641022664017,
						"eid": "z/2022/01/01/07/38/1641022683019-0000004",
						"server_id": "queue:order-entity-old-new",
						"type": "queue",
						"label": "order-entity-old-new",
						"lag": 1017,
						"kinesis_number": "z/2022/01/01/07/38/1641022683019-0000004"
					},
					{
						"id": "bot:typed-sdk-enrich",
						"server_id": "bot:typed-sdk-enrich",
						"type": "bot",
						"label": "typed-sdk-enrich"
					}
				],
				"event": {
					"id": "queue:typed-sdk-enrich-out",
					"event": "queue:typed-sdk-enrich-out",
					"payload": {
						"index": 34,
						"suborder_id": 73986616
					},
					"event_source_timestamp": 1641022663000,
					"eid": "z/2022/03/14/22/38/1647297513618-0000035",
					"correlation_id": {
						"source": "order-entity-old-new",
						"start": "z/2022/01/01/07/38/1641022683019-0000004",
						"units": 1
					},
					"timestamp": 1647297513413,
					"server_id": "queue:typed-sdk-enrich-out",
					"type": "queue",
					"label": "typed-sdk-enrich-out",
					"lag": 6274850413,
					"kinesis_number": "z/2022/03/14/22/38/1647297513618-0000035"
				},
				"children": {}
			});
		});

		it('Get Parent Events w/ Children', async function () {

			let sdk = RStreamsSdk(mockSdkConfig);
			sandbox.stub(sdk.streams, "fromLeo")
				.onFirstCall().callsFake(() => sdk.streams.eventstream.readArray([
					{
						"correlation_id": {
							"source": "source_bus_order-entity-old-new",
							"start": "z/2022/01/01/07/37/1641022664118-0000000"
						},
						"event": "order-entity-old-new",
						"event_source_timestamp": 1641022663000,
						"id": "order-entity-old-new-replicator",
						"payload": {
							"old": {},
							"new": {}
						},
						"timestamp": 1641022664017,
						"eid": "z/2022/01/01/07/38/1641022683019-0000004"
					}
				]))
				.callsFake(() => sdk.streams.eventstream.readArray([]));

			sandbox.stub(sdk.aws.dynamodb, "query").callsFake(() => Promise.resolve(require("./data/event-trace-cron-query.json")));

			let r = await eventTrace(
				sdk,
				STATS_TABLE,
				{
					eid: "z/2022/01/01/07/38/1641022683019-0000004",
					queue: "order-entity-old-new",
					children: undefined
				}
			);

			assert.deepEqual(r, {
				"parents": [
					{
						"id": "bot:order-entity-old-new-replicator",
						"server_id": "bot:order-entity-old-new-replicator",
						"type": "bot",
						"label": "order-entity-old-new-replicator"
					}
				],
				"event": {
					"correlation_id": {
						"source": "source_bus_order-entity-old-new",
						"start": "z/2022/01/01/07/37/1641022664118-0000000"
					},
					"event": "queue:order-entity-old-new",
					"event_source_timestamp": 1641022663000,
					"id": "queue:order-entity-old-new",
					"payload": {
						"old": {},
						"new": {}
					},
					"timestamp": 1641022664017,
					"eid": "z/2022/01/01/07/38/1641022683019-0000004",
					"server_id": "queue:order-entity-old-new",
					"type": "queue",
					"label": "order-entity-old-new",
					"lag": 1017,
					"kinesis_number": "z/2022/01/01/07/38/1641022683019-0000004"
				},
				"children": {
					"bot:clint-fanout2-bot-2": {
						"id": "bot:clint-fanout2-bot-2",
						"server_id": "bot:clint-fanout2-bot-2",
						"type": "bot",
						"has_processed": false,
						"label": "bot:clint-fanout2-bot-2",
						"lag": -2103390466,
						"checkpoint": {
							"checkpoint": "z/2021/12/07/23/20/1638919232301-0000000",
							"started_timestamp": 1638919272534,
							"ended_timestamp": 1638919272534,
							"source_timestamp": 1638919272534,
							"records": 2
						},
						"children": {}
					},
					"bot:clint_write_to_s3_v2": {
						"id": "bot:clint_write_to_s3_v2",
						"server_id": "bot:clint_write_to_s3_v2",
						"type": "bot",
						"label": "clint_write_to_s3_v2",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/01/14/18/08/1642183712767-0000000",
							"started_timestamp": 1642184047780,
							"ended_timestamp": 1642184047780,
							"source_timestamp": 1642118899000,
							"records": 89
						},
						"children": {}
					},
					"bot:dynamic_s3_writer": {
						"id": "bot:dynamic_s3_writer",
						"server_id": "bot:dynamic_s3_writer",
						"type": "bot",
						"label": "dynamic_s3_writer",
						"has_processed": false,
						"lag": -26496031000,
						"checkpoint": {
							"checkpoint": "z/2021/03/01/18/05/1614621931379-0000002",
							"ended_timestamp": 1622242461270,
							"started_timestamp": 1622242461270,
							"source_timestamp": 1614526632000,
							"records": 5900
						},
						"children": {}
					},
					"bot:SimpleSdkBot": {
						"id": "bot:SimpleSdkBot",
						"server_id": "bot:SimpleSdkBot",
						"type": "bot",
						"label": "SimpleSdkBot",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/03/09/01/00/1646787631115-0000006",
							"records": 11
						},
						"children": {}
					},
					"bot:SimpleSdkBotReader": {
						"id": "bot:SimpleSdkBotReader",
						"server_id": "bot:SimpleSdkBotReader",
						"type": "bot",
						"label": "SimpleSdkBotReader",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/03/09/03/24/1646796271752-0000010",
							"records": 11
						},
						"children": {}
					},
					"bot:clint-fanout2-bot": {
						"id": "bot:clint-fanout2-bot",
						"server_id": "bot:clint-fanout2-bot",
						"type": "bot",
						"label": "clint-fanout2-bot",
						"has_processed": false,
						"lag": -2100752714,
						"checkpoint": {
							"checkpoint": "z/2021/12/08/00/01/1638921660856-0000000",
							"started_timestamp": 1638921910286,
							"ended_timestamp": 1638921910286,
							"source_timestamp": 1638921910286,
							"records": 3
						},
						"children": {}
					},
					"bot:offload_order_dlq": {
						"id": "bot:offload_order_dlq",
						"server_id": "bot:offload_order_dlq",
						"type": "bot",
						"label": "offload_order_dlq",
						"has_processed": false,
						"lag": -25110982000,
						"checkpoint": {
							"checkpoint": "z/2021/05/04/16/17/1620145022400-0000202",
							"started_timestamp": 1622568396665,
							"ended_timestamp": 1622568396665,
							"source_timestamp": 1615911681000,
							"records": 100
						},
						"children": {}
					},
					"bot:write_test_bot": {
						"id": "bot:write_test_bot",
						"server_id": "bot:write_test_bot",
						"type": "bot",
						"label": "write_test_bot",
						"has_processed": false,
						"lag": -26906972000,
						"checkpoint": {
							"checkpoint": "z/2021/02/23/21/28/1614115711133-0000001",
							"started_timestamp": 1631632311429,
							"ended_timestamp": 1631632311429,
							"records": 10,
							"source_timestamp": 1614115691000
						},
						"children": {}
					},
					"bot:leo_load_bot": {
						"id": "bot:leo_load_bot",
						"server_id": "bot:leo_load_bot",
						"type": "bot",
						"label": "leo_load_bot",
						"has_processed": false,
						"lag": -27069093000,
						"checkpoint": {
							"checkpoint": "z/2021/02/23/00/42/1614040936662-0000013",
							"started_timestamp": 1623165632615,
							"ended_timestamp": 1623165632615,
							"source_timestamp": 1613953570000,
							"records": 500
						},
						"children": {}
					},
					"bot:typed-sdk-enrich": {
						"id": "bot:typed-sdk-enrich",
						"server_id": "bot:typed-sdk-enrich",
						"type": "bot",
						"label": "typed-sdk-enrich",
						"has_processed": false,
						"lag": -18020000,
						"checkpoint": {
							"checkpoint": "z/2022/01/01/02/37/1641004651290-0000000",
							"started_timestamp": 1647297798689,
							"ended_timestamp": 1647297798689,
							"source_timestamp": 1641004643000,
							"records": 10
						},
						"children": {}
					},
					"bot:order-entity-actions": {
						"id": "bot:order-entity-actions",
						"server_id": "bot:order-entity-actions",
						"type": "bot",
						"label": "order-entity-actions",
						"has_processed": false,
						"lag": -25110989000,
						"checkpoint": {
							"checkpoint": "z/2021/05/04/16/16/1620145000216-0000290",
							"started_timestamp": 1620145003291,
							"ended_timestamp": 1620145003291,
							"source_timestamp": 1615911674000,
							"records": 251
						},
						"children": {}
					},
					"bot:typed-sdk-offload": {
						"id": "bot:typed-sdk-offload",
						"server_id": "bot:typed-sdk-offload",
						"type": "bot",
						"label": "typed-sdk-offload",
						"has_processed": false,
						"lag": -25216000,
						"checkpoint": {
							"checkpoint": "z/2022/01/01/02/37/1641004651290-0000000",
							"started_timestamp": 1647297922646,
							"ended_timestamp": 1647297922646,
							"source_timestamp": 1640997447000,
							"records": 10
						},
						"children": {}
					}
				}
			});
		});


		it('Get Parent w/ Deep Children', async function () {

			let sdk = RStreamsSdk(mockSdkConfig);
			sandbox.stub(sdk.streams, "fromLeo")
				.onFirstCall().callsFake(() => sdk.streams.eventstream.readArray([
					{
						"correlation_id": {
							"source": "source_bus_order-entity-old-new",
							"start": "z/2022/01/01/07/37/1641022664118-0000000"
						},
						"event": "order-entity-old-new",
						"event_source_timestamp": 1641022663000,
						"id": "order-entity-old-new-replicator",
						"payload": {
							"new": {},
							"old": {}
						},
						"timestamp": 1641022664017,
						"eid": "z/2022/01/01/07/38/1641022683019-0000004"
					}
				]))
				.callsFake(() => sdk.streams.eventstream.readArray([]));

			sandbox.stub(sdk.aws.dynamodb, "query").callsFake(() => Promise.resolve(require("./data/event-trace-cron-query-2.json")));

			let r = await eventTrace(
				sdk,
				STATS_TABLE,
				{
					eid: "z/2021/05/04/16/19/1620145150959-0000344",
					queue: "order-entity-old-new",
					children: undefined
				}
			);

			//console.log(JSON.stringify(r, null, 2));
			assert.deepEqual(r, {
				"parents": [
					{
						"id": "bot:order-entity-old-new-replicator",
						"server_id": "bot:order-entity-old-new-replicator",
						"type": "bot",
						"label": "order-entity-old-new-replicator"
					}
				],
				"event": {
					"correlation_id": {
						"source": "source_bus_order-entity-old-new",
						"start": "z/2022/01/01/07/37/1641022664118-0000000"
					},
					"event": "queue:order-entity-old-new",
					"event_source_timestamp": 1641022663000,
					"id": "queue:order-entity-old-new",
					"payload": {
						"new": {},
						"old": {}
					},
					"timestamp": 1641022664017,
					"eid": "z/2022/01/01/07/38/1641022683019-0000004",
					"server_id": "queue:order-entity-old-new",
					"type": "queue",
					"label": "order-entity-old-new",
					"lag": 1017,
					"kinesis_number": "z/2022/01/01/07/38/1641022683019-0000004"
				},
				"children": {
					"bot:clint-fanout2-bot-2": {
						"id": "bot:clint-fanout2-bot-2",
						"server_id": "bot:clint-fanout2-bot-2",
						"type": "bot",
						"has_processed": true,
						"label": "bot:clint-fanout2-bot-2",
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2021/12/07/23/20/1638919232301-0000000",
							"started_timestamp": 1638919272534,
							"ended_timestamp": 1638919272534,
							"source_timestamp": 1638919272534,
							"records": 2
						},
						"children": {}
					},
					"bot:clint_write_to_s3_v2": {
						"id": "bot:clint_write_to_s3_v2",
						"server_id": "bot:clint_write_to_s3_v2",
						"type": "bot",
						"label": "clint_write_to_s3_v2",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/01/14/18/08/1642183712767-0000000",
							"started_timestamp": 1642184047780,
							"ended_timestamp": 1642184047780,
							"source_timestamp": 1642118899000,
							"records": 89
						},
						"children": {}
					},
					"bot:dynamic_s3_writer": {
						"id": "bot:dynamic_s3_writer",
						"server_id": "bot:dynamic_s3_writer",
						"type": "bot",
						"label": "dynamic_s3_writer",
						"has_processed": false,
						"lag": -26496031000,
						"checkpoint": {
							"checkpoint": "z/2021/03/01/18/05/1614621931379-0000002",
							"ended_timestamp": 1622242461270,
							"started_timestamp": 1622242461270,
							"source_timestamp": 1614526632000,
							"records": 5900
						},
						"children": {}
					},
					"bot:SimpleSdkBot": {
						"id": "bot:SimpleSdkBot",
						"server_id": "bot:SimpleSdkBot",
						"type": "bot",
						"label": "SimpleSdkBot",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/03/09/01/00/1646787631115-0000006",
							"records": 11
						},
						"children": {}
					},
					"bot:SimpleSdkBotReader": {
						"id": "bot:SimpleSdkBotReader",
						"server_id": "bot:SimpleSdkBotReader",
						"type": "bot",
						"label": "SimpleSdkBotReader",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/03/09/03/24/1646796271752-0000010",
							"records": 11
						},
						"children": {}
					},
					"bot:clint-fanout2-bot": {
						"id": "bot:clint-fanout2-bot",
						"server_id": "bot:clint-fanout2-bot",
						"type": "bot",
						"label": "clint-fanout2-bot",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2021/12/08/00/01/1638921660856-0000000",
							"started_timestamp": 1638921910286,
							"ended_timestamp": 1638921910286,
							"source_timestamp": 1638921910286,
							"records": 3
						},
						"children": {}
					},
					"bot:offload_order_dlq": {
						"id": "bot:offload_order_dlq",
						"server_id": "bot:offload_order_dlq",
						"type": "bot",
						"label": "offload_order_dlq",
						"has_processed": false,
						"lag": -25110982000,
						"checkpoint": {
							"checkpoint": "z/2021/05/04/16/17/1620145022400-0000202",
							"started_timestamp": 1622568396665,
							"ended_timestamp": 1622568396665,
							"source_timestamp": 1615911681000,
							"records": 100
						},
						"children": {}
					},
					"bot:write_test_bot": {
						"id": "bot:write_test_bot",
						"server_id": "bot:write_test_bot",
						"type": "bot",
						"label": "write_test_bot",
						"has_processed": false,
						"lag": -26906972000,
						"checkpoint": {
							"checkpoint": "z/2021/02/23/21/28/1614115711133-0000001",
							"started_timestamp": 1631632311429,
							"ended_timestamp": 1631632311429,
							"records": 10,
							"source_timestamp": 1614115691000
						},
						"children": {}
					},
					"bot:leo_load_bot": {
						"id": "bot:leo_load_bot",
						"server_id": "bot:leo_load_bot",
						"type": "bot",
						"label": "leo_load_bot",
						"has_processed": false,
						"lag": -27069093000,
						"checkpoint": {
							"checkpoint": "z/2021/02/23/00/42/1614040936662-0000013",
							"started_timestamp": 1623165632615,
							"ended_timestamp": 1623165632615,
							"source_timestamp": 1613953570000,
							"records": 500
						},
						"children": {}
					},
					"bot:typed-sdk-enrich": {
						"id": "bot:typed-sdk-enrich",
						"server_id": "bot:typed-sdk-enrich",
						"type": "bot",
						"label": "typed-sdk-enrich",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/01/01/02/37/1641004651290-0000000",
							"started_timestamp": 1647297798689,
							"ended_timestamp": 1647297798689,
							"source_timestamp": 1641004643000,
							"records": 10
						},
						"children": {
							"queue:typed-sdk-enrich-out": {
								"id": "queue:typed-sdk-enrich-out",
								"label": "queue:typed-sdk-enrich-out",
								"server_id": "queue:typed-sdk-enrich-out",
								"lag": null,
								"type": "queue",
								"event": null,
								"children": {}
							}
						}
					},
					"bot:order-entity-actions": {
						"id": "bot:order-entity-actions",
						"server_id": "bot:order-entity-actions",
						"type": "bot",
						"label": "order-entity-actions",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2021/05/04/16/21/1620145282702-0000326",
							"started_timestamp": 1648135563379,
							"ended_timestamp": 1648135563379,
							"source_timestamp": 1615911789000,
							"records": 46
						},
						"children": {
							"queue:order-entity-actions": {
								"id": "queue:order-entity-actions",
								"label": "queue:order-entity-actions",
								"server_id": "queue:order-entity-actions",
								"lag": null,
								"type": "queue",
								"event": null,
								"children": {
									"bot:rstreams_deep_dive_order_weather": {
										"id": "bot:rstreams_deep_dive_order_weather",
										"server_id": "bot:rstreams_deep_dive_order_weather",
										"type": "bot",
										"label": "rstreams_deep_dive_order_weather",
										"has_processed": false,
										"lag": -25116968000,
										"checkpoint": {
											"checkpoint": "z/2021/05/04/16/16/1620144969226-0000238",
											"started_timestamp": 1620144974312,
											"ended_timestamp": 1620144974312,
											"source_timestamp": 1615905695000,
											"records": 3
										},
										"children": {
											"queue:order-weather": {
												"id": "queue:order-weather",
												"label": "queue:order-weather",
												"server_id": "queue:order-weather",
												"lag": null,
												"type": "queue",
												"event": null,
												"children": {
													"bot:rstreams_deep_dive_order_weather_es_loader": {
														"id": "bot:rstreams_deep_dive_order_weather_es_loader",
														"server_id": "bot:rstreams_deep_dive_order_weather_es_loader",
														"type": "bot",
														"label": "rstreams_deep_dive_order_weather_es_loader",
														"has_processed": false,
														"lag": -25118504000,
														"checkpoint": {
															"checkpoint": "z/2021/05/04/16/16/1620144974251-0000273",
															"started_timestamp": 1620144977899,
															"ended_timestamp": 1620144977899,
															"source_timestamp": 1615904159000,
															"records": 2
														},
														"children": {
															"queue:system.es-order": {
																"id": "queue:system.es-order",
																"label": "queue:system.es-order",
																"server_id": "queue:system.es-order",
																"lag": null,
																"type": "queue",
																"event": null,
																"children": {}
															}
														}
													},
													"bot:rstreams_deep_dive_order_weather_dw_loader": {
														"id": "bot:rstreams_deep_dive_order_weather_dw_loader",
														"server_id": "bot:rstreams_deep_dive_order_weather_dw_loader",
														"type": "bot",
														"label": "rstreams_deep_dive_order_weather_dw_loader",
														"has_processed": false,
														"lag": -20877686383,
														"checkpoint": {
															"checkpoint": "z/2021/05/04/16/16/1620144974251-0000273",
															"started_timestamp": 1620144976617,
															"ended_timestamp": 1620144976617,
															"source_timestamp": 1620144976617,
															"records": 2
														},
														"children": {
															"queue:dim": {
																"id": "queue:dim",
																"label": "queue:dim",
																"server_id": "queue:dim",
																"lag": null,
																"type": "queue",
																"event": null,
																"children": {}
															}
														}
													}
												}
											}
										}
									}
								}
							}
						}
					},
					"bot:typed-sdk-offload": {
						"id": "bot:typed-sdk-offload",
						"server_id": "bot:typed-sdk-offload",
						"type": "bot",
						"label": "typed-sdk-offload",
						"has_processed": true,
						"lag": 0,
						"checkpoint": {
							"checkpoint": "z/2022/01/01/02/37/1641004651290-0000000",
							"started_timestamp": 1647297922646,
							"ended_timestamp": 1647297922646,
							"source_timestamp": 1640997447000,
							"records": 10
						},
						"children": {}
					}
				}
			});
		});
	});
});
