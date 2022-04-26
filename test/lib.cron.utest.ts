import sinon from "sinon";
import chai, { expect, assert } from "chai";
import AWS from "aws-sdk";
import cronLib, { Checkpoint } from "../lib/cron";
import moment from "moment";
import zlib from "zlib";
import { ref } from "../lib/reference";

describe("lib/cron.js", function () {

	let sandbox = sinon.createSandbox();

	beforeEach(() => {
		delete global.cron_run_again;
		delete global.preventRunAgain;
		delete process["__config"];
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe("trigger", function () {
		it("sets the trigger flag", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });
			sandbox.stub(Date, "now").returns(1650907126722);

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			await new Promise((resolve, reject) => cron.trigger({
				id: "MOCK_CRON_ID"
			}, (err) => { err ? reject(err) : resolve(undefined) }));

			expect(update).called;
			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#trigger": "trigger",
					},
					"ExpressionAttributeValues": {
						":now": 1650907126722,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #trigger=:now",
				}
			);
		});

		it("sets the trigger flag - error", async function () {

			let returnError = new Error("Some Error happened");
			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(returnError);
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let error;
			try {
				await new Promise((resolve, reject) => cron.trigger({
					id: "MOCK_CRON_ID"
				}, (err) => { err ? reject(err) : resolve(undefined) }));
			} catch (err) {
				error = err;
			}

			expect(update).called;
			assert.isNotNull(error);
			assert.equal(error.message, "Some Error happened");
		});
	});

	describe("schedule", function () {
		it("schedule bot to run", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			//sandbox.stub(moment, "now").returns(1650907126722)
			await cron.schedule("MOCK_CRON_ID", 1650907126722);

			expect(update).called;
			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#scheduledTrigger": "scheduledTrigger"
					},
					"ExpressionAttributeValues": {
						":value": 1650907126722
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #scheduledTrigger=:value",
				}
			);
		});

		it("schedule bot to run - dur", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(moment, "now").returns(1650907126722);
			await cron.schedule("MOCK_CRON_ID", { seconds: 2 });

			expect(update).called;
			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#scheduledTrigger": "scheduledTrigger"
					},
					"ExpressionAttributeValues": {
						":value": 1650907128722
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #scheduledTrigger=:value",
				}
			);
		});

		it("schedule bot to run - registry.bot_id", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						id: "MOCK_CRON_ID_1"
					}
				}
			});

			sandbox.stub(moment, "now").returns(1650907126722);
			await (cron.schedule as any)({ seconds: 2 });

			expect(update).called;
			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#scheduledTrigger": "scheduledTrigger"
					},
					"ExpressionAttributeValues": {
						":value": 1650907128722
					},
					"Key": {
						"id": "MOCK_CRON_ID_1"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #scheduledTrigger=:value",
				}
			);
		});

		it("schedule bot to run - error", async function () {

			let returnError = new Error("Some Error happened");
			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(returnError);
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let error;
			try {
				await cron.schedule("MOCK_CRON_ID", 2000);
			} catch (err) {
				error = err;
			}

			expect(update).called;
			assert.isNotNull(error);
			assert.equal(error.message, "Some Error happened");
		});

		it("schedule bot to run - error no id", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let error;
			try {
				await cron.schedule(undefined, 2000);
			} catch (err) {
				error = err;
			}

			expect(update).not.called;
			assert.isNotNull(error);
			assert.equal(error, "id is required");
		});
	});

	describe("checkLock", function () {
		it("skips old", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkLock({
					id: "MOCK_CRON_ID",
					time: 1650907126722 - 3000
				}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).not.called;
			assert.isNotNull(error);
			assert.equal(error, "Old Run: Skipping");

			// assert.deepEqual(update.getCall(0).args[0],
			// 	{
			// 		"ExpressionAttributeNames": {
			// 			"#scheduledTrigger": "scheduledTrigger"
			// 		},
			// 		"ExpressionAttributeValues": {
			// 			":value": 1650907126722
			// 		},
			// 		"Key": {
			// 			"id": "MOCK_CRON_ID"
			// 		},
			// 		"ReturnConsumedCapacity": "TOTAL",
			// 		"TableName": "MockLeoCron",
			// 		"UpdateExpression": "set #scheduledTrigger=:value",
			// 	}
			// );
		});

		it("ignore lock", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			await new Promise((resolve, reject) => cron.checkLock({
				id: "MOCK_CRON_ID",
				ignoreLock: true
			}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).not.called;


			// assert.deepEqual(update.getCall(0).args[0],
			// 	{
			// 		"ExpressionAttributeNames": {
			// 			"#scheduledTrigger": "scheduledTrigger"
			// 		},
			// 		"ExpressionAttributeValues": {
			// 			":value": 1650907126722
			// 		},
			// 		"Key": {
			// 			"id": "MOCK_CRON_ID"
			// 		},
			// 		"ReturnConsumedCapacity": "TOTAL",
			// 		"TableName": "MockLeoCron",
			// 		"UpdateExpression": "set #scheduledTrigger=:value",
			// 	}
			// );
		});

		it("force", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});


			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			await new Promise((resolve, reject) => cron.checkLock({
				id: "MOCK_CRON_ID",
				force: true
			}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;
			expect(put).not.called;

			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#ignorePaused": "ignorePaused",
						"#index": "0",
						"#instances": "instances",
						"#invokeTime": "invokeTime",
					},
					"ExpressionAttributeValues": {
						":invokeTime": 1650907126722,
						":value": {
							"invokeTime": 1650907126722,
							"maxDuration": 2000,
							"requestId": "runid-1234",
							"startTime": 1650907126722,
							"status": null,
							"token": undefined,
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused",
				}
			);
		});

		it("force id not exists", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Update error"));
				});


			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			await new Promise((resolve, reject) => cron.checkLock({
				id: "MOCK_CRON_ID",
				force: true
			}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;
			expect(put).called;

			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#ignorePaused": "ignorePaused",
						"#index": "0",
						"#instances": "instances",
						"#invokeTime": "invokeTime",
					},
					"ExpressionAttributeValues": {
						":invokeTime": 1650907126722,
						":value": {
							"invokeTime": 1650907126722,
							"maxDuration": 2000,
							"requestId": "runid-1234",
							"startTime": 1650907126722,
							"status": null,
							"token": undefined,
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused",
				}
			);
			assert.deepEqual(put.getCall(0).args[0],
				{
					"Item": {
						"checkpoints": {
							"read": {},
							"write": {},
						},
						"description": null,
						"id": "MOCK_CRON_ID",
						"instances": {
							"0": {
								"maxDuration": 2000,
								"requestId": "runid-1234",
								"startTime": 1650907126722,
								"token": undefined,
							},
						},
						"lambda": {},
						"lambdaName": null,
						"name": "MOCK_CRON_ID",
						"paused": false,
						"requested_kinesis": {},
						"time": null,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron"
				}
			);
		});

		it("force id not exists, error put", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Update error"));
				});


			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Put error"));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkLock({
					id: "MOCK_CRON_ID",
					force: true
				}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(put).called;

			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#ignorePaused": "ignorePaused",
						"#index": "0",
						"#instances": "instances",
						"#invokeTime": "invokeTime",
					},
					"ExpressionAttributeValues": {
						":invokeTime": 1650907126722,
						":value": {
							"invokeTime": 1650907126722,
							"maxDuration": 2000,
							"requestId": "runid-1234",
							"startTime": 1650907126722,
							"status": null,
							"token": undefined,
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #invokeTime = :invokeTime remove #checkpoint, #ignorePaused",
				}
			);
			assert.deepEqual(put.getCall(0).args[0],
				{
					"Item": {
						"checkpoints": {
							"read": {},
							"write": {},
						},
						"description": null,
						"id": "MOCK_CRON_ID",
						"instances": {
							"0": {
								"maxDuration": 2000,
								"requestId": "runid-1234",
								"startTime": 1650907126722,
								"token": undefined,
							},
						},
						"lambda": {},
						"lambdaName": null,
						"name": "MOCK_CRON_ID",
						"paused": false,
						"requested_kinesis": {},
						"time": null,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron"
				}
			);

			assert.isNotNull(error);
			assert.equal(error, "Couldn't save bot in cron.");
		});

		it("update error", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("Update Error"), {
						code: "SomeCode"
					}));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let remainingTime = 2000;

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkLock({
					id: "MOCK_CRON_ID",
				}, runid, remainingTime, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;

			assert.deepEqual(update.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#index": "0",
						"#instances": "instances",
						"#maxDuration": "maxDuration",
						"#requestId": "requestId",
						"#startTime": "startTime",
						"#token": "token"
					},
					"ExpressionAttributeValues": {
						":maxDuration": 2000,
						":requestId": "runid-1234",
						":startTime": 1650907126722,
						":token": undefined
					},
					"Key": {
						"id": "MOCK_CRON_ID"
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#startTime = :startTime, #instances.#index.#requestId = :requestId, #instances.#index.#maxDuration = :maxDuration",
					"ConditionExpression": "#instances.#index.#token = :token AND attribute_not_exists(#instances.#index.#startTime) AND attribute_not_exists(#instances.#index.#requestId)"
				}
			);

			assert.isNotNull(error)
			assert.equal(error.message, "Update Error");
		});
	});

	describe("reportComplete", function () {

		it("ignore lock", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID",
				ignoreLock: true
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).not.called;

		});

		it("forceComplete", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {
				forceComplete: true
			};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":value"].log = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":value"].log).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances"
					},
					"ExpressionAttributeValues": {
						":err": 0,
						":value": {
							"completedTime": 1650907126722,
							"log": "log",
							"message": null,
							"result": null,
							"status": "complete",
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #err = :err",
				}
			);
		});
		it("forceComplete with run again prevented", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {
				forceComplete: true
			};
			global.cron_run_again = true;
			global.preventRunAgain = true;

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":value"].log = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":value"].log).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances"
					},
					"ExpressionAttributeValues": {
						":err": 0,
						":value": {
							"completedTime": 1650907126722,
							"log": "log",
							"message": null,
							"result": null,
							"status": "complete",
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #err = :err",
				}
			);
		});
		it("forceComplete with run again", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			sandbox.stub(moment, "now").returns(1650907126722);

			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {
				forceComplete: true
			};
			global.cron_run_again = true;
			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":value"].log = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":value"].log).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances"
					},
					"ExpressionAttributeValues": {
						":err": 0,
						":value": {
							"completedTime": 1650907126722,
							"log": "log",
							"message": null,
							"result": null,
							"status": "complete",
							"trigger": 1650907126722
						}
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index = :value, #err = :err",
				}
			);
		});

		it("success", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});
		it("success with run again prevented", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};
			global.cron_run_again = true;
			global.preventRunAgain = true;

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});
		it("success with run again", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			sandbox.stub(moment, "now").returns(1650907126722);

			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};
			global.cron_run_again = true;
			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result",
						"#trigger": "trigger"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
						":trigger": 1650907126722,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #trigger = :trigger, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});

		it("success no runid", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = undefined;
			let status = "complete";
			let log = "log";
			let opts = {};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND attribute_not_exists(#instances.#index.#requestId)"
				}
			);
		});
		it("success with message on global", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};

			cron.setMessage("This is the message");

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID",

			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": [{ msg: "This is the message" }],
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});

		it("success with message on cron", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};


			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID",
				message: "This is the message 2"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": "This is the message 2",
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});


		it("error", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "error";
			let log = "log";
			let opts = {};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 1,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "error",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg ADD #err :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});

		it("update error - ConditionalCheckFailedException", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("Some Error"), { errorType: "ConditionalCheckFailedException" }));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};

			await new Promise((resolve, reject) => cron.reportComplete({
				id: "MOCK_CRON_ID"
			}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));

			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
		});
		it("update error - Other", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("Some Error"), { errorType: "Other" }));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let status = "complete";
			let log = "log";
			let opts = {};

			let error;
			try {
				await new Promise((resolve, reject) => cron.reportComplete({
					id: "MOCK_CRON_ID"
				}, runid, status, log, opts, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;


			let args = update.getCall(0).args[0];
			args.ExpressionAttributeValues[":log"] = JSON.parse(zlib.gunzipSync(args.ExpressionAttributeValues[":log"]).toString());
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#err": "errorCount",
						"#index": "0",
						"#instances": "instances",
						"#completedTime": "completedTime",
						"#requestId": "requestId",
						"#msg": "message",
						"#token": "token",

						"#status": "status",
						"#log": "log",
						"#result": "result"
					},
					"ExpressionAttributeValues": {
						":completedTime": 1650907126722,
						":err": 0,
						":log": "log",
						":msg": null,
						":requestId": "runid-1234",
						":result": null,
						":status": "complete",
						":token": undefined,
					},
					"Key": {
						"id": "MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #instances.#index.#completedTime = :completedTime, #instances.#index.#status = :status, #instances.#index.#log = :log, #instances.#index.#result = :result, #msg = :msg, #err = :err",
					"ConditionExpression": "#instances.#index.#token = :token AND #instances.#index.#requestId= :requestId"
				}
			);
			assert.isNotNull(error);
			assert.equal(error.message, "Some Error")
		});
	});

	describe("createLock", function () {

		it("success", async function () {

			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ put: put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let maxDuration = 300000;

			await new Promise((resolve, reject) => cron.createLock("MOCK_CRON_ID", runid, maxDuration, (err) => err ? reject(err) : resolve(undefined)));
			expect(put).called;

			assert.deepEqual(put.getCall(0).args[0],
				{
					"ExpressionAttributeValues": {
						":now": 1650907126722
					},
					"Key": {
						"id": "lock_MOCK_CRON_ID",
					},
					"Item": {
						"expires": 1650907426722,
						"id": "lock_MOCK_CRON_ID",
						"ts": 1650907126722,
						"value": "runid-1234",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoSettings",
					"ConditionExpression": "attribute_not_exists(id) OR expires <= :now"
				}
			);

		});
		it("put error", async function () {

			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Put Error"));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ put: put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";
			let maxDuration = 300000;

			let error;
			try {
				await new Promise((resolve, reject) => cron.createLock("MOCK_CRON_ID", runid, maxDuration, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(put).called;
			assert.isNotNull(error);
			assert.equal(error.message, "Put Error");

			assert.deepEqual(put.getCall(0).args[0],
				{
					"ExpressionAttributeValues": {
						":now": 1650907126722
					},
					"Key": {
						"id": "lock_MOCK_CRON_ID",
					},
					"Item": {
						"expires": 1650907426722,
						"id": "lock_MOCK_CRON_ID",
						"ts": 1650907126722,
						"value": "runid-1234",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoSettings",
					"ConditionExpression": "attribute_not_exists(id) OR expires <= :now"
				}
			);

		});
	});

	describe("removeLock", function () {

		it("success", async function () {

			let deleteFn = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ delete: deleteFn });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";

			await new Promise((resolve, reject) => cron.removeLock("MOCK_CRON_ID", runid, (err) => err ? reject(err) : resolve(undefined)));
			expect(deleteFn).called;

			assert.deepEqual(deleteFn.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#value": "value"
					},
					"ExpressionAttributeValues": {
						":runid": runid
					},
					"Key": {
						"id": "lock_MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoSettings",
					"ConditionExpression": "#value = :runid"
				}
			);

		});
		it("delete error", async function () {

			let deleteFn = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Delete Error"));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ delete: deleteFn });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			sandbox.stub(Date, "now").returns(1650907126722);
			let runid = "runid-1234";

			let error;
			try {
				await new Promise((resolve, reject) => cron.removeLock("MOCK_CRON_ID", runid, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(deleteFn).called;
			assert.isNotNull(error);
			assert.equal(error.message, "Delete Error");

			assert.deepEqual(deleteFn.getCall(0).args[0],
				{
					"ExpressionAttributeNames": {
						"#value": "value"
					},
					"ExpressionAttributeValues": {
						":runid": runid
					},
					"Key": {
						"id": "lock_MOCK_CRON_ID",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoSettings",
					"ConditionExpression": "#value = :runid"
				}
			);

		});
	});

	describe("checkpoint", function () {

		function assertInMemoryValue(type: string, queue: string, expected: string | undefined) {
			let value;
			try {
				value = process["__config"].registry?.__cron?.checkpoints[type][ref(queue)]?.checkpoint;
			} catch (e) {
				// nothing
			}
			assert.equal(expected, value);
		}
		it("Read", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/123/456/789",
				source_timestamp: 123,
				units: 100
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
					},
					"ExpressionAttributeValues": {
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
				},
			);
			assertInMemoryValue("read", queue, "z/123/456/789");
		});

		it("Read with expected", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });
			let botid = "MockBotId";
			let queue = "MockQueue";

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						checkpoints: {
							read: {
								[ref(queue)]: {
									checkpoint: "z/9876/5432"
								}
							}
						}
					}
				}
			});


			let params: Checkpoint = {
				eid: "z/123/456/789",
				source_timestamp: 123,
				units: 100
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
					},
					"ExpressionAttributeValues": {
						":expected": "z/9876/5432",
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assertInMemoryValue("read", queue, "z/123/456/789")
		});

		it("Read without expected", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });
			let botid = "MockBotId";
			let queue = "MockQueue";

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						checkpoints: {
							read: {
								[ref(queue)]: {
									checkpoint: undefined
								}
							}
						}
					}
				}
			});


			let params: Checkpoint = {
				eid: "z/123/456/789",
				source_timestamp: 123,
				units: 100
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoint": "checkpoint",
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
					},
					"ExpressionAttributeValues": {
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "attribute_not_exists(#checkpoints.#type.#event.#checkpoint)"
				},
			);
			assertInMemoryValue("read", queue, "z/123/456/789")
		});

		it("different checkpoint location", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						cploc: "instances",
						iid: 1
					}
				}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/123/456/789",
				source_timestamp: 123,
				units: 100
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "instances",
						"#event": "queue:MockQueue",
						"#type": "1",
					},
					"ExpressionAttributeValues": {
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
				},
			);
			assertInMemoryValue("read", queue, "z/123/456/789")
		});

		it("Read undefined value", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: undefined,
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assertInMemoryValue("read", queue, "z/123/456/789")
		});

		it("Stale Checkpoint", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "ConditionalCheckFailedException" }));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			assert.isNotNull(error);
			assert.equal(error, "Stale Checkpoint");

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assertInMemoryValue("read", queue, undefined);
		});

		it("Update bot doesn't exists", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "NotExists" }));
				});
			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {});
				});
			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, get, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(get).called;
			expect(put).called;
			assert.isUndefined(error);

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				}
			);
			assert.deepEqual(put.getCall(0).args[0],
				{
					"Item": {
						"checkpoints": {
							"read": {
								"queue:MockQueue": {
									"checkpoint": "z/987/654/321",
									"ended_timestamp": undefined,
									"records": 100,
									"source_timestamp": 123,
									"started_timestamp": undefined,
								},
							},
							"write": {},
						},
						"description": null,
						"id": "MockBotId",
						"instances": {},
						"lambda": {},
						"lambdaName": null,
						"name": "MockBotId",
						"paused": false,
						"requested_kinesis": {},
						"time": null,
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assertInMemoryValue("read", queue, "z/987/654/321");
		});

		it("Update bot doesn't exists with checkpont location", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "NotExists" }));
				});
			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {});
				});
			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, get, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						cploc: "instances",
						iid: 1
					}
				}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(get).called;
			expect(put).called;
			assert.isUndefined(error);

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "instances",
						"#event": "queue:MockQueue",
						"#type": "1"
					},
					"ExpressionAttributeValues": {
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value"
				},
			);

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				}
			);
			assert.deepEqual(put.getCall(0).args[0],
				{
					"Item": {
						"checkpoints": {
							"read": {},
							"write": {},
						},
						"description": null,
						"id": "MockBotId",
						"instances": {
							"1": {
								"queue:MockQueue": {
									"checkpoint": "z/987/654/321",
									"ended_timestamp": undefined,
									"records": 100,
									"source_timestamp": 123,
									"started_timestamp": undefined,
								}
							}
						},
						"lambda": {},
						"lambdaName": null,
						"name": "MockBotId",
						"paused": false,
						"requested_kinesis": {},
						"time": null,
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assertInMemoryValue("read", queue, "z/987/654/321");
		});

		it("Update Error and exists", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "NotExists" }));
				});
			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, { Item: {} });
				});
			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, get, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(get).called;
			expect(put).not.called;
			assert.isNotNull(error);
			assert.equal(error, "Error Updating Cron table");

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				}
			);

			assertInMemoryValue("read", queue, undefined);
		});

		it("Update Error and Put Error", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "NotExists" }));
				});
			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {});
				});
			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Put Error"));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, get, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(get).called;
			expect(put).called;
			assert.isNotNull(error);
			assert.equal(error, "Couldn't save bot in cron.  Failed to checkpoint!");

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				}
			);

			assertInMemoryValue("read", queue, undefined);
		});

		it("Update Error and Get Error", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb(Object.assign(new Error("message"), { code: "NotExists" }));
				});
			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("get error"));
				});
			let put = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update, get, put });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/987/654/321",
				source_timestamp: 123,
				units: 100,
				expected: "z/123/456/789"
			};

			let error;
			try {
				await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			} catch (err) {
				error = err;
			}
			expect(update).called;
			expect(get).called;
			expect(put).not.called;
			assert.isNotNull(error);
			assert.equal(error.message, "get error");

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "read",
						"#checkpoint": "checkpoint"
					},
					"ExpressionAttributeValues": {
						":expected": "z/123/456/789",
						":value": {
							"checkpoint": "z/987/654/321",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
					"ConditionExpression": "#checkpoints.#type.#event.#checkpoint = :expected"
				},
			);

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				}
			);

			assertInMemoryValue("read", queue, undefined);
		});

		it("write", async function () {

			let update = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ update });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let botid = "MockBotId";
			let queue = "MockQueue";
			let params: Checkpoint = {
				eid: "z/123/456/789",
				source_timestamp: 123,
				units: 100,
				type: "write"
			};

			await new Promise((resolve, reject) => cron.checkpoint(botid, queue, params, (err) => err ? reject(err) : resolve(undefined)));
			expect(update).called;

			let args = update.getCall(0).args[0];
			assert.deepEqual(args,
				{
					"ExpressionAttributeNames": {
						"#checkpoints": "checkpoints",
						"#event": "queue:MockQueue",
						"#type": "write",
					},
					"ExpressionAttributeValues": {
						":value": {
							"checkpoint": "z/123/456/789",
							"ended_timestamp": undefined,
							"records": 100,
							"source_timestamp": 123,
							"started_timestamp": undefined,
						},
					},
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
					"UpdateExpression": "set #checkpoints.#type.#event = :value",
				},
			);

			assertInMemoryValue("write", queue, "z/123/456/789");
		});

	});

	describe("getCheckpoint", function () {
		it("in memory cache", async function () {


			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						checkpoints: {
							read: {
								[ref(queue)]: {
									checkpoint: "z/1234567"
								}
							}
						}
					}
				}
			});

			let cp = await cron.getCheckpoint(botid, queue);
			expect(get).not.called;

			assert.equal(cp, "z/1234567");
		});

		it("from db", async function () {

			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {
						Item: {
							checkpoints: {
								read: {
									[ref(queue)]: {
										checkpoint: "z/123456"
									}
								}
							}
						}
					});
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let cp = await cron.getCheckpoint(botid, queue);
			expect(get).called;

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assert.equal(cp, "z/123456");
		});

		it("from db error", async function () {

			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(new Error("Get Error"));
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let cp;
			let error;
			try {
				cp = await cron.getCheckpoint(botid, queue);
			} catch (err) {
				error = err;
			}
			expect(get).called;
			assert.isNotNull(error);
			assert.equal(error.message, "Get Error");

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assert.isUndefined(cp);
		});

		it("from db no value", async function () {

			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {
						Item: {
							checkpoints: {
								read: {}
							}
						}
					});
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {}
			});

			let cp = await cron.getCheckpoint(botid, queue);
			expect(get).called;

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assert.isUndefined(cp);
		});

		it("just queue", async function () {
			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb();
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						id: botid,
						checkpoints: {
							read: {
								[ref(queue)]: {
									checkpoint: "z/12345678"
								}
							}
						}
					}
				}
			});

			let cp = await (cron.getCheckpoint as any)(queue);
			expect(get).not.called;

			assert.equal(cp, "z/12345678");
		});

		it("from db just queue", async function () {

			let botid = "MockBotId";
			let queue = "MockQueue";

			let get = sandbox.stub()
				.callsFake((params, cb) => {
					cb(null, {
						Item: {
							checkpoints: {
								read: {
									[ref(queue)]: {
										checkpoint: "z/123456789"
									}
								}
							}
						}
					});
				});

			sandbox.stub(AWS.DynamoDB, 'DocumentClient').returns({ get });

			let cron = cronLib({
				onUpdate: () => { }, resources: {
					LeoCron: "MockLeoCron",
					LeoSettings: "MockLeoSettings",
					LeoSystem: "MockLeoSystem"
				}, aws: {},
				registry: {
					__cron: {
						id: botid
					}
				}
			});

			let cp = await (cron.getCheckpoint as any)(queue);
			expect(get).called;

			assert.deepEqual(get.getCall(0).args[0],
				{
					"ConsistentRead": true,
					"Key": {
						"id": "MockBotId",
					},
					"ReturnConsumedCapacity": "TOTAL",
					"TableName": "MockLeoCron",
				},
			);

			assert.equal(cp, "z/123456789");
		});
	});
});
