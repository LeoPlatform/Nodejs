import sinon from "sinon";
import { assert } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import ConfigProviderChain, { AWSSecretsConfiguration, EnvironmentConfiguration, FileTreeConfiguration, ProvidersInputType } from "../lib/rstreams-config-provider-chain";
import awsSdkSync from "../lib/aws-sdk-sync";

const ENV_NAMES = ["RSTREAMS_CONFIG", "leosdk", "leo-sdk", "LEOSDK", "LEO-SDK"];
const SECRET_ENV = ["LEO_CONFIG_SECRET", "RSTREAMS_CONFIG_SECRET", "AWS_REGION"];
const RESOURCE_KEYS = ["Region", "LeoStream", "LeoCron", "LeoEvent", "LeoS3", "LeoKinesisStream", "LeoFirehoseStream", "LeoSettings"];

const CONFIG_ENV_PREFIXES = ["leosdk_", "leo-sdk_", "LEOSDK_", "LEO-SDK_", "RSTREAMS_CONFIG_"];

function isConfigEnvKey(k: string) {
	return CONFIG_ENV_PREFIXES.some((prefix) => k.startsWith(prefix));
}

function cfg(tag: string) {
	const out: any = {};
	RESOURCE_KEYS.forEach((k) => { out[k] = `${tag}-${k}`; });
	return out;
}

describe("lib/rstreams-config-provider-chain.ts resolution order", function () {
	const sandbox = sinon.createSandbox();
	const leoConfig = require("leo-config");
	let savedEnv: Record<string, string | undefined>;
	let tmpRoot: string;

	function resolved() {
		return new ConfigProviderChain().resolveSync().Region;
	}

	beforeEach(() => {
		savedEnv = {};
		[...ENV_NAMES, ...SECRET_ENV].forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
		Object.keys(process.env).filter(isConfigEnvKey).forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
		AWSSecretsConfiguration.clearCache();
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rstreams-cfg-"));
		sandbox.stub(process, "cwd").returns(path.join(tmpRoot, "a", "b"));
		fs.mkdirSync(path.join(tmpRoot, "a", "b"), { recursive: true });
	});

	afterEach(() => {
		sandbox.restore();
		Object.keys(process.env).filter(isConfigEnvKey).forEach((k) => { delete process.env[k]; });
		Object.keys(savedEnv).forEach((k) => {
			if (savedEnv[k] === undefined) { delete process.env[k]; } else { process.env[k] = savedEnv[k]; }
		});
		["leosdk", "leo_sdk", "leo-sdk", "rstreamssdk", "rstreams_sdk", "rstreams-sdk"].forEach((k) => { delete leoConfig[k]; });
		["leosdk", "leo-sdk", "rstreams_config"].forEach((k) => { delete process[k]; delete global[k]; });
		fs.rmSync(tmpRoot, { recursive: true, force: true });
		AWSSecretsConfiguration.clearCache();
	});

	describe("environment variable names", function () {
		ENV_NAMES.forEach((name) => {
			it(`${name} holds the whole config as JSON`, function () {
				process.env[name] = JSON.stringify(cfg(name));
				assert.equal(resolved(), `${name}-Region`);
			});
		});

		it("split variables accept upper and lower case key names", function () {
			RESOURCE_KEYS.forEach((k, i) => {
				const value = `split-${k}`;
				if (k === "Region") {
					process.env[`leosdk_${k.toUpperCase()}`] = value;
				} else if (i % 2) {
					process.env[`leosdk_${k.toLowerCase()}`] = value;
				} else {
					process.env[`leosdk_${k}`] = value;
				}
			});
			try {
				const config = new EnvironmentConfiguration("leosdk").resolveSync();
				assert.equal(config.Region, "split-Region");
				assert.equal(config.LeoStream, "split-LeoStream");
				assert.equal(config.LeoCron, "split-LeoCron");
				assert.equal(config.LeoSettings, "split-LeoSettings");
			} finally {
				RESOURCE_KEYS.forEach((k) => {
					delete process.env[`leosdk_${k}`];
					delete process.env[`leosdk_${k.toUpperCase()}`];
					delete process.env[`leosdk_${k.toLowerCase()}`];
				});
			}
		});

		it("LeoSettings is the only optional split variable", function () {
			const keys = RESOURCE_KEYS.filter((k) => k !== "LeoSettings");
			keys.forEach((k) => { process.env[`leosdk_${k}`] = `opt-${k}`; });
			try {
				const config = new EnvironmentConfiguration("leosdk").resolveSync();
				assert.isUndefined(config.LeoSettings);
				assert.equal(config.LeoS3, "opt-LeoS3");
			} finally {
				keys.forEach((k) => { delete process.env[`leosdk_${k}`]; });
			}
		});
	});

	describe("environment variable precedence", function () {
		it("RSTREAMS_CONFIG wins over leosdk, leo-sdk, LEOSDK and LEO-SDK", function () {
			ENV_NAMES.forEach((n) => { process.env[n] = JSON.stringify(cfg(n)); });
			assert.equal(resolved(), "RSTREAMS_CONFIG-Region");
		});

		it("leosdk wins once RSTREAMS_CONFIG is gone", function () {
			ENV_NAMES.slice(1).forEach((n) => { process.env[n] = JSON.stringify(cfg(n)); });
			assert.equal(resolved(), "leosdk-Region");
		});

		it("leo-sdk wins once leosdk is gone", function () {
			ENV_NAMES.slice(2).forEach((n) => { process.env[n] = JSON.stringify(cfg(n)); });
			assert.equal(resolved(), "leo-sdk-Region");
		});

		it("LEOSDK wins once leo-sdk is gone", function () {
			ENV_NAMES.slice(3).forEach((n) => { process.env[n] = JSON.stringify(cfg(n)); });
			assert.equal(resolved(), "LEOSDK-Region");
		});

		it("an unparsable earlier variable falls through to the next name", function () {
			process.env.RSTREAMS_CONFIG = "{not json";
			process.env.leosdk = JSON.stringify(cfg("leosdk"));
			assert.equal(resolved(), "leosdk-Region");
		});
	});

	describe("location order", function () {
		function writeFile(rel: string, region: string) {
			const file = path.join(tmpRoot, rel);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, JSON.stringify(cfg(region)));
		}

		it("leo-config is consulted before every environment variable", function () {
			leoConfig.bootstrap({ _global: { leosdk: cfg("leo-config") } });
			process.env.RSTREAMS_CONFIG = JSON.stringify(cfg("env"));
			assert.equal(resolved(), "leo-config-Region");
		});

		it("leo-config accepts the leo_sdk, leo-sdk, rstreamssdk, rstreams_sdk and rstreams-sdk names", function () {
			["leo_sdk", "leo-sdk", "rstreamssdk", "rstreams_sdk", "rstreams-sdk"].forEach((name) => {
				leoConfig.bootstrap({ _global: { [name]: cfg(name) } });
				assert.equal(resolved(), `${name}-Region`);
				delete leoConfig[name];
			});
		});

		it("environment variables win over process and global objects", function () {
			process.env.LEOSDK = JSON.stringify(cfg("env"));
			process["leosdk"] = cfg("process");
			global["leosdk"] = cfg("global");
			assert.equal(resolved(), "env-Region");
		});

		it("process.leosdk wins over process['leo-sdk'] and process.rstreams_config", function () {
			process["leosdk"] = cfg("process-leosdk");
			process["leo-sdk"] = cfg("process-leo-sdk");
			process["rstreams_config"] = cfg("process-rstreams");
			assert.equal(resolved(), "process-leosdk-Region");
			delete process["leosdk"];
			assert.equal(resolved(), "process-leo-sdk-Region");
			delete process["leo-sdk"];
			assert.equal(resolved(), "process-rstreams-Region");
		});

		it("process objects win over global objects", function () {
			process["rstreams_config"] = cfg("process");
			global["leosdk"] = cfg("global");
			assert.equal(resolved(), "process-Region");
		});

		it("global.leosdk wins over global['leo-sdk'] and global.rstreams_config", function () {
			global["leosdk"] = cfg("global-leosdk");
			global["leo-sdk"] = cfg("global-leo-sdk");
			global["rstreams_config"] = cfg("global-rstreams");
			assert.equal(resolved(), "global-leosdk-Region");
			delete global["leosdk"];
			assert.equal(resolved(), "global-leo-sdk-Region");
			delete global["leo-sdk"];
			assert.equal(resolved(), "global-rstreams-Region");
		});

		it("global objects win over a config file", function () {
			global["rstreams_config"] = cfg("global");
			writeFile("a/b/leo.config.json", "file");
			assert.equal(resolved(), "global-Region");
		});

		it("a config file wins over secrets", function () {
			process.env.LEO_CONFIG_SECRET = "leo-secret";
			sandbox.stub(awsSdkSync, "SecretsManager").returns({ getSecretValue: () => ({ SecretString: JSON.stringify(cfg("secret")) }) } as any);
			writeFile("a/b/leo.config.json", "file");
			assert.equal(resolved(), "file-Region");
		});

		it("later providers are not consulted once an earlier one resolves", function () {
			process.env.LEOSDK = JSON.stringify(cfg("env"));
			const secrets = sandbox.stub(awsSdkSync, "SecretsManager");
			assert.equal(resolved(), "env-Region");
			assert.equal(secrets.callCount, 0);
		});
	});

	describe("file tree", function () {
		function writeFile(rel: string, content: string) {
			const file = path.join(tmpRoot, rel);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content);
		}
		const tree = () => new FileTreeConfiguration(path.join(tmpRoot, "a", "b"), ["leo.config.json", "rstreams.config.json", "leoconfig.js", "config/leo.config.json"]);

		it("file tree reads a JSON file from the starting directory", function () {
			writeFile("a/b/leo.config.json", JSON.stringify(cfg("start")));
			assert.equal(tree().resolveSync().Region, "start-Region");
		});

		it("file tree walks up to parent directories", function () {
			writeFile("a/leo.config.json", JSON.stringify(cfg("parent")));
			assert.equal(tree().resolveSync().Region, "parent-Region");
		});

		it("file tree prefers the nearest directory over an earlier filename", function () {
			writeFile("a/leo.config.json", JSON.stringify(cfg("parent")));
			writeFile("a/b/rstreams.config.json", JSON.stringify(cfg("near")));
			assert.equal(tree().resolveSync().Region, "near-Region");
		});

		it("file tree takes filenames in list order within a directory", function () {
			writeFile("a/b/rstreams.config.json", JSON.stringify(cfg("second")));
			writeFile("a/b/leo.config.json", JSON.stringify(cfg("first")));
			assert.equal(tree().resolveSync().Region, "first-Region");
		});

		it("file tree loads a .js module", function () {
			writeFile("a/b/leoconfig.js", `module.exports = ${JSON.stringify(cfg("js"))};`);
			assert.equal(tree().resolveSync().Region, "js-Region");
		});

		it("file tree reads from a config subfolder", function () {
			writeFile("a/b/config/leo.config.json", JSON.stringify(cfg("sub")));
			assert.equal(tree().resolveSync().Region, "sub-Region");
		});

		it("file tree skips a file that fails to load and tries the next filename", function () {
			writeFile("a/b/leo.config.json", "{broken");
			writeFile("a/b/rstreams.config.json", JSON.stringify(cfg("next")));
			assert.equal(tree().resolveSync().Region, "next-Region");
		});

		it("file tree accepts a single filename string", function () {
			writeFile("a/b/only.json", JSON.stringify(cfg("only")));
			const single = new FileTreeConfiguration(path.join(tmpRoot, "a", "b"), "only.json" as any);
			assert.equal(single.resolveSync().Region, "only-Region");
		});

		it("file tree reports the load errors when nothing loads", function () {
			writeFile("a/b/leo.config.json", "{broken");
			let err: any;
			try { tree().resolveSync(); } catch (e) { err = e; }
			assert.equal(err.message, "Unable to find file config");
			assert.equal(err.code, "FileTreeConfigurationProviderFailure");
			assert.equal(err.errors.length, 1);
		});
	});

	describe("secrets", function () {
		function stubSecrets(byId: Record<string, any>) {
			const getSecretValue = sandbox.stub().callsFake(({ SecretId }) => {
				if (!(SecretId in byId)) { throw new Error(`no secret ${SecretId}`); }
				return { SecretString: JSON.stringify(byId[SecretId]) };
			});
			const ctor = sandbox.stub(awsSdkSync, "SecretsManager").returns({ getSecretValue } as any);
			return { getSecretValue, ctor };
		}

		it("LEO_CONFIG_SECRET is consulted before RSTREAMS_CONFIG_SECRET", function () {
			process.env.LEO_CONFIG_SECRET = "leo-secret";
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			stubSecrets({ "leo-secret": cfg("leo"), "rs-secret": cfg("rs") });
			assert.equal(resolved(), "leo-Region");
		});

		it("RSTREAMS_CONFIG_SECRET is used when LEO_CONFIG_SECRET is unset", function () {
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			stubSecrets({ "rs-secret": cfg("rs") });
			assert.equal(resolved(), "rs-Region");
		});

		it("RSTREAMS_CONFIG_SECRET is used when the LEO_CONFIG_SECRET secret cannot be read", function () {
			process.env.LEO_CONFIG_SECRET = "missing";
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			stubSecrets({ "rs-secret": cfg("rs") });
			assert.equal(resolved(), "rs-Region");
		});

		it("the secret is fetched from AWS_REGION, defaulting to us-east-1", function () {
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			const { ctor, getSecretValue } = stubSecrets({ "rs-secret": cfg("rs") });
			resolved();
			assert.equal(ctor.getCall(0).args[0].region, "us-east-1");
			assert.deepEqual(getSecretValue.getCall(0).args[0], { SecretId: "rs-secret" });
			AWSSecretsConfiguration.clearCache();
			process.env.AWS_REGION = "eu-west-1";
			resolved();
			assert.equal(ctor.getCall(1).args[0].region, "eu-west-1");
		});

		it("a fetched secret is cached per region and secret until it expires", function () {
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			const { getSecretValue } = stubSecrets({ "rs-secret": cfg("rs") });
			resolved();
			resolved();
			assert.equal(getSecretValue.callCount, 1);
			process.env.AWS_REGION = "eu-west-1";
			resolved();
			assert.equal(getSecretValue.callCount, 2);
		});

		it("an expired cache entry is fetched again", function () {
			process.env.RSTREAMS_CONFIG_SECRET = "rs-secret";
			const { getSecretValue } = stubSecrets({ "rs-secret": cfg("rs") });
			const clock = sandbox.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
			new AWSSecretsConfiguration("RSTREAMS_CONFIG_SECRET", 1000).resolveSync();
			clock.tick(500);
			new AWSSecretsConfiguration("RSTREAMS_CONFIG_SECRET", 1000).resolveSync();
			assert.equal(getSecretValue.callCount, 1);
			clock.tick(600);
			new AWSSecretsConfiguration("RSTREAMS_CONFIG_SECRET", 1000).resolveSync();
			assert.equal(getSecretValue.callCount, 2);
		});

		it("the chain throws the last provider error when nothing resolves", function () {
			let err: any;
			try { resolved(); } catch (e) { err = e; }
			assert.equal(err.message, "Secret not specified.  Use ENV var RSTREAMS_CONFIG_SECRET.");
		});
	});

	describe("chain construction", function () {
		it("Replace uses only the given providers", function () {
			const chain = new ConfigProviderChain([() => new EnvironmentConfiguration("custom")], ProvidersInputType.Replace);
			assert.equal(chain.providers.length, 1);
		});

		it("Prepend puts the given providers ahead of the defaults and Append puts them last", function () {
			const custom = { Region: "custom" } as any;
			const defaults = ConfigProviderChain.defaultProviders.length;
			const prepended = new ConfigProviderChain(custom, ProvidersInputType.Prepend);
			assert.equal(prepended.providers.length, defaults + 1);
			assert.equal(prepended.providers[0], custom);
			const appended = new ConfigProviderChain(custom, ProvidersInputType.Append);
			assert.equal(appended.providers[defaults], custom);
		});

		it("the default chain has leo-config, 5 env, 3 process, 3 global, 1 file tree and 2 secret providers", function () {
			assert.equal(ConfigProviderChain.defaultProviders.length, 15);
		});
	});
});
