import util from "./aws-util";
import Configuration from "./rstreams-configuration";
import fs from "fs";
import path from "path";
import AWS, { CredentialProviderChain } from "aws-sdk";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import awsSdkSync from "./aws-sdk-sync";
let RStreams = require('./rstreams');

export enum ProvidersInputType {
	Replace,
	Prepend,
	Append
}

/**
 * Creates a configuration provider chain that searches for RStreams configurations
 * in a list of configuration providers specified by the {providers} property.
 *
 * By default, the chain will use the {defaultProviders} to resolve configurations.
 * These providers will look in the environment using the
 * {RStreams.EnvironmentConfiguration} class with the 'LEO' and 'RSTREAMS' prefixes.
 *
 * ## Setting Providers
 *
 * Each provider in the {providers} list should be a function that returns
 * a {RStreams.Configuration} object, or a hardcoded Configuration object. The function
 * form allows for delayed execution of the credential construction.
 *
 * ## Resolving Configurations from a Chain
 *
 * Call {resolve} to return the first valid credential object that can be
 * loaded by the provider chain.
 *
 * For example, to resolve a chain with a custom provider that checks a file
 * on disk after the set of {defaultProviders}:
 *
 * ```javascript
 * let envProvider = new RStreams.EnvironmentConfiguration('MyEnvVar');
 * let chain = new RStreams.ConfigProviderChain([envProvider], ProvidersInputType.Append);
 * chain.resolve();
 * ```
 *
 * The above code will return the `envProvider` object if the
 * env contains configuration and the `defaultProviders` do not contain
 * any configuration settings.
 *
 * @!attribute providers
 *   @return [Array<RStreams.Configuration, Function>]
 *     a list of configuration objects or functions that return configuration
 *     objects. If the provider is a function, the function will be
 *     executed lazily when the provider needs to be checked for valid
 *     configuration. By default, this object will be set to the
 *     {defaultProviders}.
 *   @see defaultProviders
 */

export const ConfigProviderChain = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function ConfigProviderChain(providers: any[], addToDefaults: ProvidersInputType = ProvidersInputType.Replace) {
		if (providers && !Array.isArray(providers)) {
			providers = [providers];
		}
		if (providers && addToDefaults == ProvidersInputType.Replace) {
			this.providers = providers;
		} else {
			this.providers = RStreams.ConfigProviderChain.defaultProviders.slice(0);
			if (providers && addToDefaults == ProvidersInputType.Prepend) {
				this.providers = providers.concat(this.providers);
			} else if (providers && addToDefaults == ProvidersInputType.Append) {
				this.providers = this.providers.concat(providers);
			}
		}
		this.resolveCallbacks = [];
	},

	/**
	 * @!method  resolvePromise()
	 *   Returns a 'thenable' promise.
	 *   Resolves the provider chain by searching for the first set of
	 *   configuration in {providers}.
	 *
	 *   Two callbacks can be provided to the `then` method on the returned promise.
	 *   The first callback will be called if the promise is fulfilled, and the second
	 *   callback will be called if the promise is rejected.
	 *   @callback fulfilledCallback function(configuration)
	 *     Called if the promise is fulfilled and the provider resolves the chain
	 *     to a configuration object
	 *     @param configuration [RStreams.Configuration] the configuration object resolved
	 *       by the provider chain.
	 *   @callback rejectedCallback function(error)
	 *     Called if the promise is rejected.
	 *     @param err [Error] the error object returned if no configuration are found.
	 *   @return [Promise] A promise that represents the state of the `resolve` method call.
	 *   @example Calling the `resolvePromise` method.
	 *     let promise = chain.resolvePromise();
	 *     promise.then(function(configuration) { ... }, function(err) { ... });
	 */

	/**
	 * Resolves the provider chain by searching for the first set of
	 * configuration in {providers}.
	 *
	 * @callback callback function(err, configuration)
	 *   Called when the provider resolves the chain to a configuration object
	 *   or null if no configuration can be found.
	 *
	 *   @param err [Error] the error object returned if no configuration are
	 *     found.
	 *   @param configuration [RStreams.Configuration] the configuration object resolved
	 *     by the provider chain.
	 * @return [RStreams.ConfigProviderChain] the provider, for chaining.
	 */
	resolve: function resolve(callback) {

		let error;
		let value;
		try {
			value = this.resolveSync();
		} catch (err) {
			error = err;
		}
		callback(error, error ? undefined : value);
		return this;

		// let self = this;
		// if (self.providers.length === 0) {
		// 	callback(new Error('No providers'));
		// 	return self;
		// }

		// if (self.resolveCallbacks.push(callback) === 1) {
		// 	let index = 0;
		// 	let providers = self.providers.slice(0);

		// 	function resolveNext(err?, creds?) {
		// 		if ((!err && creds) || index === providers.length) {
		// 			util.arrayEach(self.resolveCallbacks, function (callback) {
		// 				callback(err, creds);
		// 			});
		// 			self.resolveCallbacks.length = 0;
		// 			return;
		// 		}

		// 		let provider = providers[index++];
		// 		if (typeof provider === 'function') {
		// 			creds = provider.call();
		// 		} else {
		// 			creds = provider;
		// 		}

		// 		if (creds.get) {
		// 			creds.get(function (getErr) {
		// 				resolveNext(getErr, getErr ? null : creds);
		// 			});
		// 		} else {
		// 			resolveNext(null, creds);
		// 		}
		// 	}

		// 	resolveNext();
		// }

		// return self;
	},
	resolveSync: function () {
		let self = this;
		if (self.providers.length === 0) {
			throw new Error('No providers');
		}

		let providers = self.providers.slice(0);

		let value: any;
		let error;
		for (let provider of providers) {
			if (typeof provider === 'function') {
				value = (provider as any).call();
			} else {
				value = provider;
			}

			try {
				if (value.getSync) {
					value.getSync();
					return value;
				}
				else {
					return value;
				}
			} catch (err) {
				error = err;
			}
		}

		if (error != null) {
			throw error;
		} else if (value == null) {
			throw new Error("Config not found");
		}

		return value;
	}

});

/**
 * The default set of providers used by a vanilla ConfigProviderChain.
 *
 * In Node.js:
 *
 * ```javascript
 * RStreams.ConfigProviderChain.defaultProviders = [
 *	function () { return new EnvironmentConfiguration('RSTREAMS_CONFIG'); },
 *	function () { return new EnvironmentConfiguration('leosdk'); },
 *	function () { return new EnvironmentConfiguration('leo-sdk'); },
 *	function () { return new EnvironmentConfiguration('LEOSDK'); },
 *	function () { return new EnvironmentConfiguration('LEO-SDK'); },
 *	function () { return new LeoConfiguration(); },
 *	function () { return new ObjectConfiguration(process, "leosdk"); },
 *	function () { return new ObjectConfiguration(process, "leo-sdk"); },
 *	function () { return new ObjectConfiguration(process, "rstreams_config"); },
 *	function () { return new ObjectConfiguration(global, "leosdk"); },
 *	function () { return new ObjectConfiguration(global, "leo-sdk"); },
 *	function () { return new ObjectConfiguration(global, "rstreams_config"); },
 *	function () {
 *		return new FileTreeConfiguration(process.cwd(), [
 *			"leo.config.json",
 *			"leo.config.js",
 *			"rstreams.config.json",
 *			"rstreams.config.js",
 *			"leoconfig.json",
 *			"leoconfig.js",
 *			"rstreamsconfig.json",
 *			"rstreamsconfig.js",
 *
 *			"config/leo.config.json",
 *			"config/leo.config.js",
 *			"config/rstreams.config.json",
 *			"config/rstreams.config.js",
 *			"config/leoconfig.json",
 *			"config/leoconfig.js",
 *			"config/rstreamsconfig.json",
 *			"config/rstreamsconfig.js",
 *		]);
 *	},
 *	function () { return new AWSSecretsConfiguration('LEO_CONFIG_SECRET'); },
 *	function () { return new AWSSecretsConfiguration('RSTREAMS_CONFIG_SECRET'); },
 *
 * ]
 * ```
 */

ConfigProviderChain.defaultProviders = [

	/* Rstreams Env locations */
	function () { return new EnvironmentConfiguration('RSTREAMS_CONFIG'); },

	/* Leo Env locations */
	function () { return new EnvironmentConfiguration('leosdk'); },
	function () { return new EnvironmentConfiguration('leo-sdk'); },
	function () { return new EnvironmentConfiguration('LEOSDK'); },
	function () { return new EnvironmentConfiguration('LEO-SDK'); },

	/* leo-config */
	function () { return new LeoConfiguration(); },

	/* process Object locations */
	function () { return new ObjectConfiguration(process, "leosdk"); },
	function () { return new ObjectConfiguration(process, "leo-sdk"); },
	function () { return new ObjectConfiguration(process, "rstreams_config"); },

	/* global Object locations */
	function () { return new ObjectConfiguration(global, "leosdk"); },
	function () { return new ObjectConfiguration(global, "leo-sdk"); },
	function () { return new ObjectConfiguration(global, "rstreams_config"); },

	/* File tree locations */
	function () {
		return new FileTreeConfiguration(process.cwd(), [
			"leo.config.json",
			"leo.config.js",
			"rstreams.config.json",
			"rstreams.config.js",
			"leoconfig.json",
			"leoconfig.js",
			"rstreamsconfig.json",
			"rstreamsconfig.js",

			"config/leo.config.json",
			"config/leo.config.js",
			"config/rstreams.config.json",
			"config/rstreams.config.js",
			"config/leoconfig.json",
			"config/leoconfig.js",
			"config/rstreamsconfig.json",
			"config/rstreamsconfig.js",
		]);
	},

	/* AWS Secrets locations */
	function () { return new AWSSecretsConfiguration('LEO_CONFIG_SECRET'); },
	function () { return new AWSSecretsConfiguration('RSTREAMS_CONFIG_SECRET'); },

];

ConfigProviderChain.addPromisesToClass = function addPromisesToClass(PromiseDependency) {
	this.prototype.resolvePromise = util.promisifyMethod('resolve', PromiseDependency);
};

ConfigProviderChain.deletePromisesFromClass = function deletePromisesFromClass() {
	delete this.prototype.resolvePromise;
};

util.addPromises(ConfigProviderChain);

export default ConfigProviderChain;
Configuration



export const EnvironmentConfiguration = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function EnvironmentConfiguration(envPrefix) {
		Configuration.call(this);
		this.envPrefix = envPrefix;
		//this.get(function () { });
	},

	refreshSync: function () {

		if (!process || !process.env) {
			throw util.error(
				new Error(`Unable to parse environment variable: ${this.envPrefix}.`),
				{ code: 'EnvironmentConfigurationProviderFailure' }
			);
		}

		let values = null;
		if (process.env[this.envPrefix] != null) {
			try {
				values = JSON.parse(process.env[this.envPrefix]);
			} catch (err) {
				throw util.error(
					new Error(`Unable to parse env variable: ${this.envPrefix}`),
					{ code: 'EnvironmentConfigurationProviderFailure' }
				);
			}
		} else {

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
			values = {};

			for (let i = 0; i < keys.length; i++) {
				let key = keys[i];
				let prefix = '';
				if (this.envPrefix) { prefix = this.envPrefix + '_'; }
				values[key] = process.env[prefix + key] || process.env[prefix + key.toUpperCase()] || process.env[prefix + key.toLowerCase()];
				if (!values[key] && key !== 'LeoSettings') {
					throw util.error(
						new Error('Variable ' + prefix + key + ' not set.'),
						{ code: 'EnvironmentConfigurationProviderFailure' }
					);
				}
			}
		}

		this.expired = false;
		Configuration.call(this, values);
		return this;
	},

	// refresh: function refresh(callback) {
	// 	if (!callback) callback = util.fn.callback;
	// 	let error;
	// 	try {
	// 		this.refreshSync();
	// 	} catch (err) {
	// 		error = err;
	// 	}
	// 	return callback(error);

	// 	if (!process || !process.env) {
	// 		callback(util.error(
	// 			new Error(`Unable to parse environment variable: ${this.envPrefix}.`),
	// 			{ code: 'EnvironmentConfigurationProviderFailure' }
	// 		));
	// 		return;
	// 	}

	// 	let values = null;
	// 	if (process.env[this.envPrefix] != null) {
	// 		try {
	// 			values = JSON.parse(process.env[this.envPrefix]);
	// 		} catch (err) {
	// 			callback(util.error(
	// 				new Error(`Unable to parse env variable: ${this.envPrefix}`),
	// 				{ code: 'EnvironmentConfigurationProviderFailure' }
	// 			));
	// 			return;
	// 		}
	// 	} else {

	// 		let keys = [
	// 			"Region",
	// 			"LeoStream",
	// 			"LeoCron",
	// 			"LeoEvent",
	// 			"LeoS3",
	// 			"LeoKinesisStream",
	// 			"LeoFirehoseStream",
	// 			"LeoSettings"
	// 		];
	// 		values = {};

	// 		for (let i = 0; i < keys.length; i++) {
	// 			let key = keys[i];
	// 			let prefix = '';
	// 			if (this.envPrefix) { prefix = this.envPrefix + '_'; }
	// 			values[key] = process.env[prefix + key] || process.env[prefix + key.toUpperCase()] || process.env[prefix + key.toLowerCase()];
	// 			if (!values[key] && key !== 'LeoSettings') {
	// 				callback(util.error(
	// 					new Error('Variable ' + prefix + key + ' not set.'),
	// 					{ code: 'EnvironmentConfigurationProviderFailure' }
	// 				));
	// 				return;
	// 			}
	// 		}
	// 	}

	// 	this.expired = false;
	// 	Configuration.call(this, values);
	// 	callback();
	// }
});



export const FileTreeConfiguration = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function FileTreeConfiguration(startingDirectory, filenames) {
		Configuration.call(this);
		this.startingDirectory = startingDirectory;
		this.filenames = Array.isArray(filenames) ? filenames : [filenames];
		//this.get(function () { });
	},

	refreshSync: function () {

		let values = null;

		let currentDir = this.startingDirectory

		let lastDir;
		let dirs = [];
		do {
			dirs.push(currentDir);
			lastDir = currentDir;
			currentDir = path.resolve(currentDir, "../");
		} while (currentDir != lastDir);

		let errors = [];
		outer:
		for (let dir of dirs) {
			for (let filename of this.filenames) {
				let file = path.resolve(dir, filename);
				if (fs.existsSync(file)) {
					try {
						values = require(file);
						break outer;
					} catch (err) {
						errors.push(err);
					}
				}
			}
		}

		if (values == null) {
			throw util.error(
				new Error(`Unable to find file config`),
				{ code: 'FileTreeConfigurationProviderFailure', errors: errors }
			);
		}


		this.expired = false;
		Configuration.call(this, values);
		return this;
	},

	// refresh: function refresh(callback) {
	// 	if (!callback) callback = util.fn.callback;
	// 	let error;
	// 	try {
	// 		this.refreshSync();
	// 	} catch (err) {
	// 		error = err;
	// 	}
	// 	return callback(error);

	// 	let values = null;

	// 	let currentDir = this.startingDirectory

	// 	let lastDir;
	// 	let dirs = [];
	// 	do {
	// 		dirs.push(currentDir);
	// 		lastDir = currentDir;
	// 		currentDir = path.resolve(currentDir, "../");
	// 	} while (currentDir != lastDir);

	// 	let errors = [];
	// 	outer:
	// 	for (let dir of dirs) {
	// 		for (let filename of this.filenames) {
	// 			let file = path.resolve(dir, filename);
	// 			if (fs.existsSync(file)) {
	// 				try {
	// 					values = require(file);
	// 					break outer;
	// 				} catch (err) {
	// 					errors.push(err);
	// 				}
	// 			}
	// 		}
	// 	}

	// 	if (values == null) {
	// 		callback(util.error(
	// 			new Error(`Unable to find file config`),
	// 			{ code: 'FileTreeConfigurationProviderFailure', errors: errors }
	// 		));
	// 		return;
	// 	}


	// 	this.expired = false;
	// 	Configuration.call(this, values);
	// 	callback();
	// }
});


export const LeoConfiguration = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function LeoConfiguration() {
		Configuration.call(this);
		//this.get(function () { });
	},

	refreshSync: function () {
		let config = require("leo-config");

		let values = config.leosdk || config.leo_sdk || config["leo-sdk"] ||
			config.rstreamssdk || config.rstreams_sdk || config["rstreams-sdk"];
		if (values == null) {
			throw util.error(
				new Error(`Unable to get config from leo-config env ${config.env}`),
				{ code: 'LeoConfigurationProviderFailure' }
			);
		}

		this.expired = false;
		Configuration.call(this, values);
		return this;
	},

	// refresh: function refresh(callback) {
	// 	if (!callback) callback = util.fn.callback;
	// 	let error;
	// 	try {
	// 		this.refreshSync();
	// 	} catch (err) {
	// 		error = err;
	// 	}
	// 	return callback(error);

	// 	let config = require("leo-config");

	// 	let values = config.leosdk || config.leo_sdk || config["leo-sdk"] ||
	// 		config.rstreamssdk || config.rstreams_sdk || config["rstreams-sdk"];
	// 	if (values == null) {
	// 		callback(util.error(
	// 			new Error(`Unable to get config from leo-config env ${config.env}`),
	// 			{ code: 'LeoConfigurationProviderFailure' }
	// 		));
	// 		return;
	// 	}

	// 	this.expired = false;
	// 	Configuration.call(this, values);
	// 	callback();
	// }
});

export const ObjectConfiguration = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function LeoConfiguration(root: any, field: string) {
		Configuration.call(this);
		this.field = field;
		this.root = root;
		//this.get(function () { });
	},

	refreshSync: function refresh() {
		if (this.root == null || this.field == null || this.field == "") {
			throw util.error(
				new Error(`Root and Field must be specified.`),
				{ code: 'ObjectConfigurationProviderFailure' }
			);
		}

		let values = this.root[this.field] ? this.root[this.field] : null;
		if (values == null) {
			throw util.error(
				new Error(`Unable to get config from ${this.field}`),
				{ code: 'ObjectConfigurationProviderFailure' }
			);
		}

		this.expired = false;
		Configuration.call(this, values);
		return this;
	},

	// refresh: function refresh(callback) {
	// 	if (!callback) callback = util.fn.callback;
	// 	let error;
	// 	try {
	// 		this.refreshSync();
	// 	} catch (err) {
	// 		error = err;
	// 	}
	// 	return callback(error);

	// 	if (this.root == null || this.field == null || this.field == "") {
	// 		callback(util.error(
	// 			new Error(`Root and Field must be specified.`),
	// 			{ code: 'ObjectConfigurationProviderFailure' }
	// 		));
	// 		return;
	// 	}

	// 	let values = this.root[this.field] ? this.root[this.field] : null;
	// 	if (values == null) {
	// 		callback(util.error(
	// 			new Error(`Unable to get config from ${this.field}`),
	// 			{ code: 'ObjectConfigurationProviderFailure' }
	// 		));
	// 		return;
	// 	}

	// 	this.expired = false;
	// 	Configuration.call(this, values);
	// 	callback();
	// }
});


export const AWSSecretsConfiguration = util.inherit(Configuration, {

	/**
	 * Creates a new ConfigProviderChain with a default set of providers
	 * specified by {defaultProviders}.
	 */
	constructor: function AWSSecretsConfiguration(secretEnvKey) {
		Configuration.call(this);
		this.secretEnvKey = secretEnvKey;
	},

	refreshSync: function () {

		if (!process || !process.env || !process.env[this.secretEnvKey]) {
			throw util.error(
				new Error(`Secret not specified.  Use ENV var ${this.secretEnvKey}.`),
				{ code: 'AWSSecretsConfigurationProviderFailure' }
			);
		}

		let values = null;

		let secretKey = process.env[this.secretEnvKey];
		let error;
		try {
			let value = new awsSdkSync.SecretsManager({
				region: process.env.AWS_REGION || "us-east-1"
			}).getSecretValue({ SecretId: secretKey });

			try {

				if ('SecretString' in value) {
					values = JSON.parse(value.SecretString);
				} else {
					//let buff = Buffer.from(value.SecretBinary, 'base64');
					//values = JSON.parse(buff.toString('ascii'));
				}
			} catch (err) {
				error = util.error(
					new Error(`Unable to parse secret '${secretKey}'.`),
					{ code: 'AWSSecretsConfigurationProviderFailure' }
				);
			}
		} catch (err) {
			error = util.error(
				new Error(`Secret '${secretKey}' not available. ${err}`),
				{ code: 'AWSSecretsConfigurationProviderFailure', parent: err }
			);
		}
		if (error != null) {
			throw error;
		}


		this.expired = false;
		Configuration.call(this, values);
		return this;
	},

	// refresh: async function refresh(callback) {
	// 	if (!callback) callback = util.fn.callback;
	// 	let error;
	// 	try {
	// 		this.refreshSync();
	// 	} catch (err) {
	// 		error = err;
	// 	}
	// 	return callback(error);

	// 	if (!process || !process.env || !process.env[this.secretEnvKey]) {
	// 		callback(util.error(
	// 			new Error(`Secret not specified.  Use ENV var ${this.secretEnvKey}.`),
	// 			{ code: 'AWSSecretsConfigurationProviderFailure' }
	// 		));
	// 		return;
	// 	}

	// 	let values = null;

	// 	let secretKey = process.env[this.secretEnvKey];
	// 	try {
	// 		let value: AWS.SecretsManager.GetSecretValueResponse;

	// 		// // Serverless with webpack doesn't like the promise await here
	// 		// // so this is a workaround to use the aws cli instead 
	// 		// if (process.env.IS_LOCAL === "true") {
	// 		try {
	// 			value = new awsSdkSync.SecretsManager({
	// 				region: process.env.AWS_REGION || "us-east-1"
	// 			}).getSecretValue({ SecretId: secretKey });
	// 			// let fn = `
	// 			// async function fn(service, method, config, params) {
	// 			// 	let AWS = require("aws-sdk");
	// 			// 	let sm = new AWS[service](config);
	// 			// 	return await sm[method](params).promise();
	// 			// }`;
	// 			// let service = "SecretsManager";
	// 			// let method = "getSecretValue";
	// 			// let cmd = `(${fn})("${service}","${method}",${JSON.stringify({
	// 			// 	region: process.env.AWS_REGION || "us-east-1"
	// 			// })}, ${JSON.stringify({ SecretId: secretKey })}).then(a=>console.log(JSON.stringify(a))).catch(e=>console.log(JSON.stringify({error:e.message})))`;
	// 			// console.log(cmd);
	// 			// let stuff = spawnSync(process.argv0, ["-e", cmd]);
	// 			// value = JSON.parse((stuff.output.join("").toString().match(/({.*})/) || [])[1]) as AWS.SecretsManager.GetSecretValueResponse;
	// 			// console.log(value)
	// 			// if (value && (value as any).error) {
	// 			// 	throw new Error((value as any).error);
	// 			// }
	// 			// //					let a = spawnSync(`aws`, ["secretsmanager", "get-secret-value", "--secret-id", secretKey]);
	// 			// //					value = JSON.parse(a.output.join("").toString()) as AWS.SecretsManager.GetSecretValueResponse;
	// 		} catch (err) {
	// 			console.error("Couldn't load secret sync", err);
	// 		}
	// 		//}
	// 		if (value == null) {
	// 			let sm = new AWS.SecretsManager({
	// 				region: process.env.AWS_REGION || "us-east-1"
	// 			});

	// 			value = await sm.getSecretValue({ SecretId: secretKey }).promise();
	// 		}
	// 		try {
	// 			if ('SecretString' in value) {
	// 				values = JSON.parse(value.SecretString);
	// 			} else {
	// 				//let buff = Buffer.from(value.SecretBinary, 'base64');
	// 				//values = JSON.parse(buff.toString('ascii'));
	// 			}
	// 		} catch (err) {
	// 			callback(util.error(
	// 				new Error(`Unable to parse secret '${secretKey}'.`),
	// 				{ code: 'AWSSecretsConfigurationProviderFailure' }
	// 			));
	// 			return;
	// 		}
	// 	} catch (err) {

	// 		callback(util.error(
	// 			new Error(`Secret '${secretKey}' not available. ${err}`),
	// 			{ code: 'AWSSecretsConfigurationProviderFailure', parent: err }
	// 		));
	// 		return;
	// 	}


	// 	this.expired = false;
	// 	Configuration.call(this, values);
	// 	callback();
	// }
});
