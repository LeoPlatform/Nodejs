"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AWSSecretsConfiguration = exports.ObjectConfiguration = exports.LeoConfiguration = exports.FileTreeConfiguration = exports.EnvironmentConfiguration = exports.ConfigProviderChain = exports.ProvidersInputType = void 0;
const util_1 = __importDefault(require("aws-sdk/lib/util"));
const rstreams_configuration_1 = __importDefault(require("./rstreams-configuration"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
let RStreams = require('./rstreams');
var ProvidersInputType;
(function (ProvidersInputType) {
    ProvidersInputType[ProvidersInputType["Replace"] = 0] = "Replace";
    ProvidersInputType[ProvidersInputType["Prepend"] = 1] = "Prepend";
    ProvidersInputType[ProvidersInputType["Append"] = 2] = "Append";
})(ProvidersInputType = exports.ProvidersInputType || (exports.ProvidersInputType = {}));
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
exports.ConfigProviderChain = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function ConfigProviderChain(providers, addToDefaults = ProvidersInputType.Replace) {
        if (providers && !Array.isArray(providers)) {
            providers = [providers];
        }
        if (providers && addToDefaults == ProvidersInputType.Replace) {
            this.providers = providers;
        }
        else {
            this.providers = RStreams.ConfigProviderChain.defaultProviders.slice(0);
            if (providers && addToDefaults == ProvidersInputType.Prepend) {
                this.providers = providers.concat(this.providers);
            }
            else if (providers && addToDefaults == ProvidersInputType.Append) {
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
        let self = this;
        if (self.providers.length === 0) {
            callback(new Error('No providers'));
            return self;
        }
        if (self.resolveCallbacks.push(callback) === 1) {
            let index = 0;
            let providers = self.providers.slice(0);
            function resolveNext(err, creds) {
                if ((!err && creds) || index === providers.length) {
                    util_1.default.arrayEach(self.resolveCallbacks, function (callback) {
                        callback(err, creds);
                    });
                    self.resolveCallbacks.length = 0;
                    return;
                }
                let provider = providers[index++];
                if (typeof provider === 'function') {
                    creds = provider.call();
                }
                else {
                    creds = provider;
                }
                if (creds.get) {
                    creds.get(function (getErr) {
                        resolveNext(getErr, getErr ? null : creds);
                    });
                }
                else {
                    resolveNext(null, creds);
                }
            }
            resolveNext();
        }
        return self;
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
exports.ConfigProviderChain.defaultProviders = [
    /* Rstreams Env locations */
    function () { return new exports.EnvironmentConfiguration('RSTREAMS_CONFIG'); },
    /* Leo Env locations */
    function () { return new exports.EnvironmentConfiguration('leosdk'); },
    function () { return new exports.EnvironmentConfiguration('leo-sdk'); },
    function () { return new exports.EnvironmentConfiguration('LEOSDK'); },
    function () { return new exports.EnvironmentConfiguration('LEO-SDK'); },
    /* leo-config */
    function () { return new exports.LeoConfiguration(); },
    /* process Object locations */
    function () { return new exports.ObjectConfiguration(process, "leosdk"); },
    function () { return new exports.ObjectConfiguration(process, "leo-sdk"); },
    function () { return new exports.ObjectConfiguration(process, "rstreams_config"); },
    /* global Object locations */
    function () { return new exports.ObjectConfiguration(global, "leosdk"); },
    function () { return new exports.ObjectConfiguration(global, "leo-sdk"); },
    function () { return new exports.ObjectConfiguration(global, "rstreams_config"); },
    /* File tree locations */
    function () {
        return new exports.FileTreeConfiguration(process.cwd(), [
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
    function () { return new exports.AWSSecretsConfiguration('LEO_CONFIG_SECRET'); },
    function () { return new exports.AWSSecretsConfiguration('RSTREAMS_CONFIG_SECRET'); },
];
exports.ConfigProviderChain.addPromisesToClass = function addPromisesToClass(PromiseDependency) {
    this.prototype.resolvePromise = util_1.default.promisifyMethod('resolve', PromiseDependency);
};
exports.ConfigProviderChain.deletePromisesFromClass = function deletePromisesFromClass() {
    delete this.prototype.resolvePromise;
};
util_1.default.addPromises(exports.ConfigProviderChain);
exports.default = exports.ConfigProviderChain;
rstreams_configuration_1.default;
exports.EnvironmentConfiguration = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function EnvironmentConfiguration(envPrefix) {
        rstreams_configuration_1.default.call(this);
        this.envPrefix = envPrefix;
        //this.get(function () { });
    },
    refresh: function refresh(callback) {
        if (!callback)
            callback = util_1.default.fn.callback;
        if (!process || !process.env) {
            callback(util_1.default.error(new Error(`Unable to parse environment variable: ${this.envPrefix}.`), { code: 'EnvironmentConfigurationProviderFailure' }));
            return;
        }
        let values = null;
        if (process.env[this.envPrefix] != null) {
            try {
                values = JSON.parse(process.env[this.envPrefix]);
            }
            catch (err) {
                callback(util_1.default.error(new Error(`Unable to parse env variable: ${this.envPrefix}`), { code: 'EnvironmentConfigurationProviderFailure' }));
                return;
            }
        }
        else {
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
                if (this.envPrefix) {
                    prefix = this.envPrefix + '_';
                }
                values[key] = process.env[prefix + key] || process.env[prefix + key.toUpperCase()] || process.env[prefix + key.toLowerCase()];
                if (!values[key] && key !== 'LeoSettings') {
                    callback(util_1.default.error(new Error('Variable ' + prefix + key + ' not set.'), { code: 'EnvironmentConfigurationProviderFailure' }));
                    return;
                }
            }
        }
        this.expired = false;
        rstreams_configuration_1.default.call(this, values);
        callback();
    }
});
exports.FileTreeConfiguration = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function FileTreeConfiguration(startingDirectory, filenames) {
        rstreams_configuration_1.default.call(this);
        this.startingDirectory = startingDirectory;
        this.filenames = Array.isArray(filenames) ? filenames : [filenames];
        //this.get(function () { });
    },
    refresh: function refresh(callback) {
        if (!callback)
            callback = util_1.default.fn.callback;
        let values = null;
        let currentDir = this.startingDirectory;
        let lastDir;
        let dirs = [];
        do {
            dirs.push(currentDir);
            lastDir = currentDir;
            currentDir = path_1.default.resolve(currentDir, "../");
        } while (currentDir != lastDir);
        let errors = [];
        outer: for (let dir of dirs) {
            for (let filename of this.filenames) {
                let file = path_1.default.resolve(dir, filename);
                if (fs_1.default.existsSync(file)) {
                    try {
                        values = require(file);
                        break outer;
                    }
                    catch (err) {
                        errors.push(err);
                    }
                }
            }
        }
        if (values == null) {
            callback(util_1.default.error(new Error(`Unable to find file config`), { code: 'FileTreeConfigurationProviderFailure', errors: errors }));
            return;
        }
        this.expired = false;
        rstreams_configuration_1.default.call(this, values);
        callback();
    }
});
exports.LeoConfiguration = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function LeoConfiguration() {
        rstreams_configuration_1.default.call(this);
        //this.get(function () { });
    },
    refresh: function refresh(callback) {
        if (!callback)
            callback = util_1.default.fn.callback;
        let config = require("leo-config");
        let values = config.leosdk || config.leo_sdk || config["leo-sdk"] ||
            config.rstreamssdk || config.rstreams_sdk || config["rstreams-sdk"];
        if (values == null) {
            callback(util_1.default.error(new Error(`Unable to get config from leo-config env ${config.env}`), { code: 'LeoConfigurationProviderFailure' }));
            return;
        }
        this.expired = false;
        rstreams_configuration_1.default.call(this, values);
        callback();
    }
});
exports.ObjectConfiguration = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function LeoConfiguration(root, field) {
        rstreams_configuration_1.default.call(this);
        this.field = field;
        this.root = root;
        //this.get(function () { });
    },
    refresh: function refresh(callback) {
        if (!callback)
            callback = util_1.default.fn.callback;
        if (this.root == null || this.field == null || this.field == "") {
            callback(util_1.default.error(new Error(`Root and Field must be specified.`), { code: 'ObjectConfigurationProviderFailure' }));
            return;
        }
        let values = this.root[this.field] ? this.root[this.field] : null;
        if (values == null) {
            callback(util_1.default.error(new Error(`Unable to get config from ${this.field}`), { code: 'ObjectConfigurationProviderFailure' }));
            return;
        }
        this.expired = false;
        rstreams_configuration_1.default.call(this, values);
        callback();
    }
});
exports.AWSSecretsConfiguration = util_1.default.inherit(rstreams_configuration_1.default, {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor: function AWSSecretsConfiguration(secretEnvKey) {
        rstreams_configuration_1.default.call(this);
        this.secretEnvKey = secretEnvKey;
    },
    refresh: async function refresh(callback) {
        if (!callback)
            callback = util_1.default.fn.callback;
        if (!process || !process.env || !process.env[this.secretEnvKey]) {
            callback(util_1.default.error(new Error(`Secret not specified.  Use ENV var ${this.secretEnvKey}.`), { code: 'AWSSecretsConfigurationProviderFailure' }));
            return;
        }
        let values = null;
        let sm = new aws_sdk_1.default.SecretsManager({
            region: process.env.AWS_REGION || "us-east-1"
        });
        let secretKey = process.env[this.secretEnvKey];
        try {
            let value = await sm.getSecretValue({ SecretId: secretKey }).promise();
            try {
                if ('SecretString' in value) {
                    values = JSON.parse(value.SecretString);
                }
                else {
                    //let buff = Buffer.from(value.SecretBinary, 'base64');
                    //values = JSON.parse(buff.toString('ascii'));
                }
            }
            catch (err) {
                callback(util_1.default.error(new Error(`Unable to parse secret '${secretKey}'.`), { code: 'AWSSecretsConfigurationProviderFailure' }));
                return;
            }
        }
        catch (err) {
            callback(util_1.default.error(new Error(`Secret '${secretKey}' not found.`), { code: 'AWSSecretsConfigurationProviderFailure' }));
            return;
        }
        this.expired = false;
        rstreams_configuration_1.default.call(this, values);
        callback();
    }
});
//# sourceMappingURL=rstreams-config-provider-chain.js.map