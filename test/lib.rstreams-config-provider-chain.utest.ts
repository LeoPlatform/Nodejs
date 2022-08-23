import util from "util";
import RSTREAMS_CONFIG, { ConfigurationResources } from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import { trace as eventTrace } from "../lib/event-trace";
import moment from "moment";
import ConfigProviderChain, { AWSSecretsConfiguration, EnvironmentConfiguration, FileTreeConfiguration, LeoConfiguration, ObjectConfiguration, ProvidersInputType } from "../lib/rstreams-config-provider-chain";

import AWS from "aws-sdk";
import awsSdkSync from "../lib/aws-sdk-sync";



let envVars = ["RSTREAMS_CONFIG"];
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

describe('lib/rstreams-config-provider-chain.ts', function () {
	let sandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});
	afterEach(() => {
		sandbox.restore();
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
		delete global.leosdk;
	});
	after(() => {
		delete require[require.resolve("leo-config")];
	});
	describe("Chain", function () {
		it('throws and error', async function () {

			let gotError;
			try {
				let chain = new ConfigProviderChain();
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = true;
			}
			assert(gotError, "should have thrown an error");
		});

		it('throws no providers error', async function () {

			let gotError;
			try {
				let chain = new ConfigProviderChain([]);
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "No providers");
		});
		it('read object', async function () {
			let mockSdkConfig: ConfigurationResources = {
				Region: "mock2-Region",
				LeoStream: "mock2-LeoStream",
				LeoCron: "mock2-LeoCron",
				LeoEvent: "mock2-LeoEvent",
				LeoS3: "mock2-leos3",
				LeoKinesisStream: "mock2-LeoKinesisStream",
				LeoFirehoseStream: "mock2-LeoFirehoseStream",
				LeoSettings: "mock2-LeoSettings",
			};
			let gotError;
			let config;
			try {
				let chain = new ConfigProviderChain(mockSdkConfig);
				config = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig);
		});


		it('read object prepend', async function () {
			let mockSdkConfig1: ConfigurationResources = {
				Region: "mock7-Region",
				LeoStream: "mock7-LeoStream",
				LeoCron: "mock7-LeoCron",
				LeoEvent: "mock7-LeoEvent",
				LeoS3: "mock7-leos3",
				LeoKinesisStream: "mock7-LeoKinesisStream",
				LeoFirehoseStream: "mock7-LeoFirehoseStream",
				LeoSettings: "mock7-LeoSettings",
			};
			let mockSdkConfig2: ConfigurationResources = {
				Region: "mock6-Region",
				LeoStream: "mock6-LeoStream",
				LeoCron: "mock6-LeoCron",
				LeoEvent: "mock6-LeoEvent",
				LeoS3: "mock6-leos3",
				LeoKinesisStream: "mock6-LeoKinesisStream",
				LeoFirehoseStream: "mock6-LeoFirehoseStream",
				LeoSettings: "mock6-LeoSettings",
			};
			process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig2);
			let gotError;
			let config;
			try {
				let chain = new ConfigProviderChain(mockSdkConfig1, ProvidersInputType.Prepend);
				config = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig1);
		});

		it('read object append', async function () {
			let mockSdkConfig1: ConfigurationResources = {
				Region: "mock8-Region",
				LeoStream: "mock8-LeoStream",
				LeoCron: "mock8-LeoCron",
				LeoEvent: "mock8-LeoEvent",
				LeoS3: "mock8-leos3",
				LeoKinesisStream: "mock8-LeoKinesisStream",
				LeoFirehoseStream: "mock8-LeoFirehoseStream",
				LeoSettings: "mock8-LeoSettings",
			};
			let mockSdkConfig2: ConfigurationResources = {
				Region: "mock9-Region",
				LeoStream: "mock9-LeoStream",
				LeoCron: "mock9-LeoCron",
				LeoEvent: "mock9-LeoEvent",
				LeoS3: "mock9-leos3",
				LeoKinesisStream: "mock9-LeoKinesisStream",
				LeoFirehoseStream: "mock9-LeoFirehoseStream",
				LeoSettings: "mock9-LeoSettings",
			};
			process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig2);
			let gotError;
			let config;
			try {
				let chain = new ConfigProviderChain(mockSdkConfig1, ProvidersInputType.Append);
				config = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig2);
		});
	});


	describe("Config", function () {
		it('read no refresh', async function () {
			let mockSdkConfig = {
				Region: "mock11-Region",
				LeoStream: "mock11-LeoStream",
				LeoCron: "mock11-LeoCron",
				LeoEvent: "mock11-LeoEvent",
				LeoS3: "mock11-leos3",
				LeoKinesisStream: "mock11-LeoKinesisStream",
				LeoFirehoseStream: "mock11-LeoFirehoseStream",
				LeoSettings: "mock11-LeoSettings",
			};
			let gotError;
			let config1;
			let config2;
			let refresh = true;
			process.env.RSTREAMS_CONFIG = JSON.stringify({ s3: mockSdkConfig.LeoS3, resources: mockSdkConfig });
			try {
				let chain = new EnvironmentConfiguration("RSTREAMS_CONFIG");
				config1 = chain.resolveSync();
				refresh = chain.needsRefresh();
				config2 = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert(!refresh, "Shouldn't need refresh");
			assert.deepEqual(justKeyFields(config1), mockSdkConfig);
			assert.deepEqual(justKeyFields(config2), mockSdkConfig);
		});
	});
	describe("ENV", function () {

		it('throws unparsable env error', async function () {

			let gotError;
			process.env.RSTREAMS_CONFIG = '{"hello":2]';
			try {
				let chain = new EnvironmentConfiguration("RSTREAMS_CONFIG");
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Unable to parse env variable: RSTREAMS_CONFIG");
		});

		it('throws missing field error', async function () {

			let gotError;
			process.env.RSTREAMS_CONFIG_Region = "mock3-Region";
			process.env.RSTREAMS_CONFIG_LeoStream = "mock3-LeoStream";
			process.env.RSTREAMS_CONFIG_LeoCron = "mock3-LeoCron";
			process.env.RSTREAMS_CONFIG_LeoEvent = "mock3-LeoEvent";
			process.env.RSTREAMS_CONFIG_LeoKinesisStream = "mock3-LeoKinesisStream";
			process.env.RSTREAMS_CONFIG_LeoFirehoseStream = "mock3-LeoFirehoseStream";
			process.env.RSTREAMS_CONFIG_LeoSettings = "mock3-LeoSettings";
			try {
				let chain = new EnvironmentConfiguration("RSTREAMS_CONFIG");
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Variable RSTREAMS_CONFIG_LeoS3 not set.");
		});

		it('read env var', async function () {
			let mockSdkConfig = {
				Region: "mock1-Region",
				LeoStream: "mock1-LeoStream",
				LeoCron: "mock1-LeoCron",
				LeoEvent: "mock1-LeoEvent",
				LeoS3: "mock1-leos3",
				LeoKinesisStream: "mock1-LeoKinesisStream",
				LeoFirehoseStream: "mock1-LeoFirehoseStream",
				LeoSettings: "mock1-LeoSettings",
			};
			let gotError;
			let config;
			process.env.RSTREAMS_CONFIG = JSON.stringify(mockSdkConfig);
			try {
				let chain = new ConfigProviderChain();
				config = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig);
		});
	});
	describe("Tree", function () {
		it('throws tree error', async function () {

			let gotError;
			try {
				let chain = new FileTreeConfiguration(".", ["hello.world"]);
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Unable to find file config");
		});
	});
	describe("leo-config", function () {
		it('Get from leo-config', async function () {

			let gotError;
			let mockSdkConfig = {
				Region: "mock4-Region",
				LeoStream: "mock4-LeoStream",
				LeoCron: "mock4-LeoCron",
				LeoEvent: "mock4-LeoEvent",
				LeoS3: "mock4-leos3",
				LeoKinesisStream: "mock4-LeoKinesisStream",
				LeoFirehoseStream: "mock4-LeoFirehoseStream",
				LeoSettings: "mock4-LeoSettings",
			};
			require("leo-config").bootstrap({
				_global: {
					leosdk: mockSdkConfig
				}
			});

			let config;
			try {
				let chain = new LeoConfiguration();
				config = chain.resolveSync();
			} catch (err) {
				gotError = err;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig);
		});

		it('throws leo-config error', async function () {

			let gotError;
			try {
				let chain = new LeoConfiguration();
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert(gotError.message.match(/^Unable to get config from leo-config env/), gotError.message);
		});
	});
	describe("Object", function () {
		it('throws no root error', async function () {

			let gotError;

			let config;
			try {
				let chain = new ObjectConfiguration(null, "");
				config = chain.resolveSync();
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Root and Field must be specified.");

		});
		it('throws no field error', async function () {

			let gotError;

			let config;
			try {
				let chain = new ObjectConfiguration({}, "");
				config = chain.resolveSync();
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Root and Field must be specified.");

		});

		it('throws no config in object', async function () {
			let gotError;
			try {
				let chain = new ObjectConfiguration({}, "RSTREAMS_CONFIG");
				chain.resolveSync();
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should not have thrown an error");
			assert.equal(gotError.message, "Unable to get config from RSTREAMS_CONFIG");
		});

		it('gets config object', async function () {
			let gotError;
			let mockSdkConfig = {
				Region: "mock5-Region",
				LeoStream: "mock5-LeoStream",
				LeoCron: "mock5-LeoCron",
				LeoEvent: "mock5-LeoEvent",
				LeoS3: "mock5-leos3",
				LeoKinesisStream: "mock5-LeoKinesisStream",
				LeoFirehoseStream: "mock5-LeoFirehoseStream",
				LeoSettings: "mock5-LeoSettings",
			};

			let config;
			try {
				let chain = new ObjectConfiguration({ RSTREAMS_CONFIG: mockSdkConfig }, "RSTREAMS_CONFIG");
				config = chain.resolveSync();
			} catch (err) {
				gotError = err;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig);
		});
	});
	describe("Secrets Manager", function () {

		function AWSRequest(response) {
			return {
				promise: async () => {
					if (response instanceof Error) {
						throw response;
					}
					return response;
				}
			};
		}

		beforeEach(() => {
			AWSSecretsConfiguration.clearCache();
		});

		it('throws env not set error', async function () {

			let gotError;
			try {
				delete process.env.rstreams_secret;
				let chain = new AWSSecretsConfiguration("rstreams_secret");
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Secret not specified.  Use ENV var rstreams_secret.");
		});

		it('throws not found error', async function () {

			let gotError;
			process.env.rstreams_secret = 'mock-secret';
			let getSecretValue = sandbox.stub().throws(new Error("Not found"));
			sandbox.stub(awsSdkSync, 'SecretsManager').returns({ getSecretValue });
			try {
				let chain = new AWSSecretsConfiguration("rstreams_secret");
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Secret 'mock-secret' not available. Error: Not found");
		});

		it('throws not parsable error', async function () {

			let gotError;
			process.env.rstreams_secret = 'mock-secret';
			let getSecretValue = sandbox.stub().returns({ SecretString: "{]" });
			sandbox.stub(awsSdkSync, 'SecretsManager').returns({ getSecretValue });
			try {
				let chain = new AWSSecretsConfiguration("rstreams_secret");
				chain.resolveSync();
				assert.fail("Should throw an error");
			} catch (err) {
				gotError = err;
			}
			assert(!!gotError, "should have thrown an error");
			assert.equal(gotError.message, "Unable to parse secret 'mock-secret'.");
		});

		it('read Secret Config', async function () {
			let mockSdkConfig = {
				Region: "mock10-Region",
				LeoStream: "mock10-LeoStream",
				LeoCron: "mock10-LeoCron",
				LeoEvent: "mock10-LeoEvent",
				LeoS3: "mock10-leos3",
				LeoKinesisStream: "mock10-LeoKinesisStream",
				LeoFirehoseStream: "mock10-LeoFirehoseStream",
				LeoSettings: "mock10-LeoSettings",
			};
			let gotError;
			let config;

			process.env.rstreams_secret = 'mock-secret';
			let getSecretValue = sandbox.stub().returns({
				SecretString: JSON.stringify(mockSdkConfig)
			});
			sandbox.stub(awsSdkSync, 'SecretsManager').returns({ getSecretValue });

			try {
				let chain = new AWSSecretsConfiguration("rstreams_secret");
				config = chain.resolveSync();
			} catch (err) {
				gotError = true;
			}
			assert(!gotError, "should not have thrown an error");
			assert.deepEqual(justKeyFields(config), mockSdkConfig);
		});
	});
});

function justKeyFields(data = {}) {
	let result = {};
	keys.forEach(key => {
		result[key] = data[key];
	});
	return result;
}
