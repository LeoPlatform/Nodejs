import { RStreamsSdk, ReadEvent } from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler, NodeHttpHandlerOptions } from "@aws-sdk/node-http-handler";
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
	let region;
	before(() => {
		region = process.env.AWS_REGION;
		process.env.AWS_REGION = "us-east-1";
	});
	beforeEach(() => {
		sandbox = sinon.createSandbox();
		process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig);
	});
	afterEach(() => {
		sandbox.restore();
	});
	after(() => {
		delete process.env.RSTREAMS_CONFIG;
		process.env.AWS_REGION = region;
	});

	describe("sdk AWS config", function () {

		describe("dynamodb", () => {
			it("default", async () => {
				let sdk = new RStreamsSdk();

				let config = sdk.aws.dynamodb.docClient.config;
				assert.exists(config, "should have a config");
				assert.equal(await config.maxAttempts(), 3);
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 5000);
				assert.equal(httpOptions.connectionTimeout, 2000);

			});

			it("custom", async () => {
				let sdk = new RStreamsSdk(undefined, {
					dynamodbConfig: {
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.dynamodb.docClient.config;
				assert.exists(config, "should have a config");
				assert.equal(await config.maxAttempts(), 11);
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);

			});
		});

		describe("kinesis", () => {
			it("default", async () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.kinesis.config;
				assert.exists(config, "should have a config");
				assert.equal(await config.region(), "mock-Region");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, undefined);

			});

			it("custom", async () => {
				let sdk = new RStreamsSdk(undefined, {
					kinesisConfig: {
						endpoint: "http://some-custom-kinesis-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.kinesis.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-kinesis-endpoint" as any);

				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);

			});
		});

		describe("firehose", () => {
			it("default", async () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.firehose.config;
				assert.exists(config, "should have a config");
				assert.equal(await config.region(), "mock-Region");

				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, undefined);

			});

			it("custom", async () => {
				let sdk = new RStreamsSdk(undefined, {
					firehoseConfig: {
						endpoint: "http://some-custom-firehose-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.firehose.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-firehose-endpoint");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);

			});
		});

		describe("s3", () => {
			it("default", async () => {
				let sdk = new RStreamsSdk();
				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal(await config.region(), "mock-Region");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, undefined);
				assert.equal(httpOptions?.httpsAgent["keepAlive"], true);

			});

			it("custom", async () => {
				let sdk = new RStreamsSdk({
					s3Config: {
						endpoint: "https://some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-s3-endpoint");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);
				assert.equal((httpOptions?.httpsAgent as any)?.keepAlive, true);

			});
		});

		describe("constructors", () => {

			it("just aws config", async () => {
				let sdk = new RStreamsSdk({
					s3Config: {
						endpoint: "https://some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-s3-endpoint");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);
				assert.equal((httpOptions?.httpsAgent as any)?.keepAlive, true);

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

			it("undefined, aws config", async () => {
				let sdk = new RStreamsSdk(undefined, {
					s3Config: {
						endpoint: "https://some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-s3-endpoint");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);
				assert.equal((httpOptions?.httpsAgent as any)?.keepAlive, true);

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

			it("sdk config, aws config", async () => {
				let sdk = new RStreamsSdk(mockSdkConfig, {
					s3Config: {
						endpoint: "https://some-custom-s3-endpoint",
						maxRetries: 10,
						httpOptions: {
							timeout: 1000,
							connectTimeout: 100
						}
					}
				});

				let config = sdk.aws.s3.config;
				assert.exists(config, "should have a config");
				assert.equal((await config.endpoint()).hostname, "some-custom-s3-endpoint");
				let httpOptions = (await (config.requestHandler as any).configProvider) as NodeHttpHandlerOptions;
				assert.exists(httpOptions, "should have httpOptions");
				assert.equal(httpOptions.requestTimeout, 1000);
				assert.equal(httpOptions.connectionTimeout, 100);
				assert.equal((httpOptions?.httpsAgent as any)?.keepAlive, true);

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
