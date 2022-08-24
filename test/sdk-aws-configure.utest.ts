import { RStreamsSdk, ReadEvent } from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import AWS, { Credentials, Kinesis } from "aws-sdk";
import { gzipSync, gunzipSync } from "zlib";
//import { StreamUtil } from "../lib/lib";
import streams from "../lib/streams";
import fs, { WriteStream } from "fs";
import zlib from "zlib";
import util from "../lib/aws-util";
import awsSdkSync from "../lib/aws-sdk-sync";
import { ReadableStream } from "../lib/types";
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

describe('index/aws-configs', function () {
	let sandbox: sinon.SinonSandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
		process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig);
	});
	afterEach(() => {
		sandbox.restore();
	});
	after(() => {
		delete process.env.RSTREAMS_CONFIG;
	});

	describe("sdk AWS config", function () {

		describe("dynamodb", () => {
			it("default", () => {
				let sdk = new RStreamsSdk();

				let config = (sdk.aws.dynamodb.docClient["service"] as AWS.DynamoDB).config;
				assert.exists(config, "should have a config");
				assert.equal(config.maxRetries, 2);
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 5000);
				assert.equal(config.httpOptions.connectTimeout, 2000);

			});

			it("custom", () => {
				let sdk = new RStreamsSdk(undefined, {
					dynamodbConfig: {
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = (sdk.aws.dynamodb.docClient["service"] as AWS.DynamoDB).config;
				assert.exists(config, "should have a config");
				assert.equal(config.maxRetries, 10);
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);

			});
		});

		describe("kinesis", () => {
			it("default", () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.kinesis.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "kinesis.mock-Region.amazonaws.com");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 120000);

			});

			it("custom", () => {
				let sdk = new RStreamsSdk(undefined, {
					kinesisConfig: {
						endpoint: "some-custom-kinesis-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.kinesis.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-kinesis-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);

			});
		});

		describe("firehose", () => {
			it("default", () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.firehose.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "firehose.mock-Region.amazonaws.com");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 120000);

			});

			it("custom", () => {
				let sdk = new RStreamsSdk(undefined, {
					firehoseConfig: {
						endpoint: "some-custom-firehose-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.firehose.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-firehose-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);

			});
		});

		describe("s3", () => {
			it("default", () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "s3.amazonaws.com");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 120000);
				assert.equal(config.httpOptions?.agent["keepAlive"], true);

			});

			it("custom", () => {
				let sdk = new RStreamsSdk({
					s3Config: {
						endpoint: "some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-s3-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);
				assert.equal((config.httpOptions?.agent as any)?.keepAlive, true);

			});
		});

		describe("constructors", () => {

			it("just aws config", () => {
				let sdk = new RStreamsSdk({
					s3Config: {
						endpoint: "some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-s3-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);
				assert.equal((config.httpOptions?.agent as any)?.keepAlive, true);

				assert.deepEqual(sdk.configuration.resources, {
					LeoCron: "mock-LeoCron",
					LeoEvent: "mock-LeoEvent",
					LeoFirehoseStream: "mock-LeoFirehoseStream",
					LeoKinesisStream: "mock-LeoKinesisStream",
					LeoS3: "mock-leos3",
					LeoSettings: "mock-LeoSettings",
					LeoStream: "mock-LeoStream",
					LeoSystem: undefined,
					Region: "mock-Region",
					envPrefix: "RSTREAMS_CONFIG",
					expireTime: 0,
					expired: false,
					expiryWindow: 15
				} as any);

			});

			it("undefined, aws config", () => {
				let sdk = new RStreamsSdk(undefined, {
					s3Config: {
						endpoint: "some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-s3-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);
				assert.equal((config.httpOptions?.agent as any)?.keepAlive, true);

				assert.deepEqual(sdk.configuration.resources, {
					LeoCron: "mock-LeoCron",
					LeoEvent: "mock-LeoEvent",
					LeoFirehoseStream: "mock-LeoFirehoseStream",
					LeoKinesisStream: "mock-LeoKinesisStream",
					LeoS3: "mock-leos3",
					LeoSettings: "mock-LeoSettings",
					LeoStream: "mock-LeoStream",
					LeoSystem: undefined,
					Region: "mock-Region",
					envPrefix: "RSTREAMS_CONFIG",
					expireTime: 0,
					expired: false,
					expiryWindow: 15
				} as any);

			});

			it("sdk config, aws config", () => {
				let sdk = new RStreamsSdk(mockSdkConfig, {
					s3Config: {
						endpoint: "some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(config.endpoint, "some-custom-s3-endpoint");
				assert.exists(config.httpOptions, "should have httpOptions");
				assert.equal(config.httpOptions.timeout, 1000);
				assert.equal(config.httpOptions.connectTimeout, 100);
				assert.equal((config.httpOptions?.agent as any)?.keepAlive, true);

				assert.deepEqual(sdk.configuration.resources, {
					LeoCron: "mock-LeoCron",
					LeoEvent: "mock-LeoEvent",
					LeoFirehoseStream: "mock-LeoFirehoseStream",
					LeoKinesisStream: "mock-LeoKinesisStream",
					LeoS3: "mock-leos3",
					LeoSettings: "mock-LeoSettings",
					LeoStream: "mock-LeoStream",
					Region: "mock-Region",
				});

			});
		});
	});


});
