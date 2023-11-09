import child, { SpawnSyncReturns } from "child_process";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import sinon from "sinon";
import awsSdkSync, { invoke as awsSdkSyncInvoke } from "../lib/aws-sdk-sync";
import { S3 } from "@aws-sdk/client-s3";
chai.use(sinonchai);
describe('lib/aws-sdk-sync', function () {

	let sandbox;
	beforeEach(() => {
		delete (process as any).__config;
		sandbox = sinon.createSandbox();
	});
	afterEach(() => {
		sandbox.restore();
	});

	function makeResponse(data: { error?: Error, response?: any }): SpawnSyncReturns<Buffer> {
		return {
			output: [Buffer.from(`RESPONSE::${JSON.stringify(data)}::RESPONSE`)],
			pid: 0,
			stdout: undefined,
			stderr: undefined,
			status: 0,
			signal: "SIGABRT",
		};
	}

	it("S3 listBuckets - success", function () {
		sandbox.stub(child, "spawnSync").returns(makeResponse({
			error: null,
			response: {
				Buckets: [],
				Owner: {
					DisplayName: "XYZ",
					ID: "123"
				}
			}
		}));

		let data = new awsSdkSync.S3().listBuckets();

		assert.deepEqual(data, {
			Buckets: [],
			Owner: {
				DisplayName: "XYZ",
				ID: "123"
			}
		});
	});

	it("S3 listBuckets - error", function () {
		sandbox.stub(child, "spawnSync").returns(makeResponse({
			error: Object.assign(new Error(), { message: "Bad Request" })
		}));

		try {
			new awsSdkSync.S3().listBuckets();
			assert.fail("Should hvae thrown an error");
		} catch (err) {
			console.log(err);
			assert.deepEqual(err.message, "Bad Request");
		}

	});

	it("S3 listBuckets - output error", function () {
		sandbox.stub(child, "spawnSync").returns({
			output: [Buffer.from(`RESPONSE-::{}::-RESPONSE`)],
			pid: 0,
			stdout: undefined,
			stderr: undefined,
			status: 0,
			signal: "SIGABRT"
		});

		try {
			new awsSdkSync.S3().listBuckets();
			assert.fail("Should hvae thrown an error");
		} catch (err) {
			assert.deepEqual(err.message, "Invalid Response: RESPONSE-::{}::-RESPONSE");
		}

	});

	it("S3 listBuckets - process error", function () {
		sandbox.stub(child, "spawnSync").returns({
			output: [],
			pid: 0,
			stdout: undefined,
			stderr: undefined,
			status: 0,
			signal: "SIGABRT",
			error: new Error("Some Process Error")
		});

		try {
			new awsSdkSync.S3().listBuckets();
			assert.fail("Should hvae thrown an error");
		} catch (err) {
			assert.deepEqual(err.message, "Some Process Error");
		}
	});

	it("SecretsManager getSecretValue - process error", function () {
		sandbox.stub(child, "spawnSync").returns(makeResponse({
			response: {
				ARN: "arn:secretsmanager::mock-region::rstreams-secret",
				Name: "rstrams-secret",
				SecretString: "some really cool secret"
			}
		}));

		let s = new awsSdkSync.SecretsManager().getSecretValue({ SecretId: "1234567" });
		assert.deepEqual(s, {
			ARN: "arn:secretsmanager::mock-region::rstreams-secret",
			Name: "rstrams-secret",
			SecretString: "some really cool secret"
		});
	});

	it("invoke - success", function () {
		try {
			let log = sandbox.spy(console, "log");

			(S3.prototype as any).someMethod = (params: any, cb) => {
				cb(null, { SomeData: 1234 });
			};

			awsSdkSyncInvoke(require, "S3", "someMethod", undefined, undefined);
			assert(log.calledOnce);
			assert.deepEqual(log.getCall(0).args, [`RESPONSE::{"error":null,"response":{"SomeData":1234}}::RESPONSE`]);
		} finally {
			delete (S3.prototype as any).someMethod;
		}
	});

	it("invoke - bad Service", function () {
		let log = sandbox.spy(console, "log");
		awsSdkSyncInvoke(require, "S2", "someMethod", undefined, undefined);
		assert(log.calledOnce);
		assert.deepEqual(log.getCall(0).args, [`RESPONSE::{"error":{"message":"AWS.S2 is not a constructor"}}::RESPONSE`]);
	});


	it("invoke - bad method", function () {
		let log = sandbox.spy(console, "log");
		awsSdkSyncInvoke(require, "S3", "someMethod", undefined, undefined);
		assert(log.calledOnce);
		assert.deepEqual(log.getCall(0).args, [`RESPONSE::{"error":{"message":"AWS.S3.someMethod is not a function"}}::RESPONSE`]);
	});

	it("invoke - service error", function () {
		try {
			let log = sandbox.spy(console, "log");
			(S3.prototype as any).someMethod = (params: any, cb) => {
				cb(Object.assign(new Error(), { message: "Some bad error" }));
			};

			awsSdkSyncInvoke(require, "S3", "someMethod", undefined, undefined);
			assert(log.calledOnce);
			assert.deepEqual(log.getCall(0).args, [`RESPONSE::{"error":{"message":"Some bad error"}}::RESPONSE`]);
		} finally {
			delete (S3.prototype as any).someMethod;
		}
	});
});
