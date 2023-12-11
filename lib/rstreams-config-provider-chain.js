"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AWSSecretsConfiguration = exports.ObjectConfiguration = exports.LeoConfiguration = exports.FileTreeConfiguration = exports.EnvironmentConfiguration = exports.ConfigProviderChain = exports.ProvidersInputType = void 0;
const aws_util_1 = __importDefault(require("./aws-util"));
const rstreams_configuration_1 = __importDefault(require("./rstreams-configuration"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const aws_sdk_sync_1 = __importDefault(require("./aws-sdk-sync"));
let requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
var ProvidersInputType;
(function (ProvidersInputType) {
    ProvidersInputType[ProvidersInputType["Replace"] = 0] = "Replace";
    ProvidersInputType[ProvidersInputType["Prepend"] = 1] = "Prepend";
    ProvidersInputType[ProvidersInputType["Append"] = 2] = "Append";
})(ProvidersInputType || (exports.ProvidersInputType = ProvidersInputType = {}));
class ConfigProviderChain extends rstreams_configuration_1.default {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor(providers, addToDefaults = ProvidersInputType.Replace) {
        super();
        if (providers && addToDefaults == ProvidersInputType.Replace) {
            this.providers = [].concat(providers);
        }
        else {
            this.providers = ConfigProviderChain.defaultProviders.slice(0);
            if (providers && addToDefaults == ProvidersInputType.Prepend) {
                this.providers = [].concat(providers, this.providers);
            }
            else if (providers && addToDefaults == ProvidersInputType.Append) {
                this.providers = this.providers.concat(providers);
            }
        }
    }
    /**
     * Resolves the provider chain by searching for the first set of
     * configuration in {providers}.
     *
     * @return [RStreams.Configuration] the provider, for chaining.
     */
    resolveSync() {
        if (this.providers.length === 0) {
            throw new Error('No providers');
        }
        let providers = this.providers.slice(0);
        let value;
        let error;
        for (let provider of providers) {
            if (typeof provider === 'function') {
                value = provider.call();
            }
            else {
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
            }
            catch (err) {
                error = err;
            }
        }
        if (error != null) {
            throw error;
        }
        else if (value == null) {
            throw new Error("Config not found");
        }
        return value;
    }
}
exports.ConfigProviderChain = ConfigProviderChain;
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
    /* leo-config (first for backwards compatibility )*/
    function () { return new LeoConfiguration(); },
    /* Rstreams Env locations */
    function () { return new EnvironmentConfiguration('RSTREAMS_CONFIG'); },
    /* Leo Env locations */
    function () { return new EnvironmentConfiguration('leosdk'); },
    function () { return new EnvironmentConfiguration('leo-sdk'); },
    function () { return new EnvironmentConfiguration('LEOSDK'); },
    function () { return new EnvironmentConfiguration('LEO-SDK'); },
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
exports.default = ConfigProviderChain;
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
// ConfigProviderChain.defaultProviders = [
// 	/* Rstreams Env locations */
// 	function () { return new EnvironmentConfiguration('RSTREAMS_CONFIG'); },
// 	/* Leo Env locations */
// 	function () { return new EnvironmentConfiguration('leosdk'); },
// 	function () { return new EnvironmentConfiguration('leo-sdk'); },
// 	function () { return new EnvironmentConfiguration('LEOSDK'); },
// 	function () { return new EnvironmentConfiguration('LEO-SDK'); },
// 	/* leo-config */
// 	function () { return new LeoConfiguration(); },
// 	/* process Object locations */
// 	function () { return new ObjectConfiguration(process, "leosdk"); },
// 	function () { return new ObjectConfiguration(process, "leo-sdk"); },
// 	function () { return new ObjectConfiguration(process, "rstreams_config"); },
// 	/* global Object locations */
// 	function () { return new ObjectConfiguration(global, "leosdk"); },
// 	function () { return new ObjectConfiguration(global, "leo-sdk"); },
// 	function () { return new ObjectConfiguration(global, "rstreams_config"); },
// 	/* File tree locations */
// 	function () {
// 		return new FileTreeConfiguration(process.cwd(), [
// 			"leo.config.json",
// 			"leo.config.js",
// 			"rstreams.config.json",
// 			"rstreams.config.js",
// 			"leoconfig.json",
// 			"leoconfig.js",
// 			"rstreamsconfig.json",
// 			"rstreamsconfig.js",
// 			"config/leo.config.json",
// 			"config/leo.config.js",
// 			"config/rstreams.config.json",
// 			"config/rstreams.config.js",
// 			"config/leoconfig.json",
// 			"config/leoconfig.js",
// 			"config/rstreamsconfig.json",
// 			"config/rstreamsconfig.js",
// 		]);
// 	},
// 	/* AWS Secrets locations */
// 	function () { return new AWSSecretsConfiguration('LEO_CONFIG_SECRET'); },
// 	function () { return new AWSSecretsConfiguration('RSTREAMS_CONFIG_SECRET'); },
// ];
class EnvironmentConfiguration extends rstreams_configuration_1.default {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor(envPrefix) {
        super();
        this.envPrefix = envPrefix;
    }
    refreshSync() {
        if (!process || !process.env) {
            throw aws_util_1.default.error(new Error(`Unable to parse environment variable: ${this.envPrefix}.`), { code: 'EnvironmentConfigurationProviderFailure' });
        }
        let values = null;
        if (process.env[this.envPrefix] != null) {
            try {
                values = JSON.parse(process.env[this.envPrefix]);
            }
            catch (err) {
                throw aws_util_1.default.error(new Error(`Unable to parse env variable: ${this.envPrefix}`), { code: 'EnvironmentConfigurationProviderFailure' });
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
                    throw aws_util_1.default.error(new Error('Variable ' + prefix + key + ' not set.'), { code: 'EnvironmentConfigurationProviderFailure' });
                }
            }
        }
        this.expired = false;
        this.update(values);
        return this;
    }
}
exports.EnvironmentConfiguration = EnvironmentConfiguration;
class FileTreeConfiguration extends rstreams_configuration_1.default {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor(startingDirectory, filenames) {
        super();
        this.startingDirectory = startingDirectory;
        this.filenames = Array.isArray(filenames) ? filenames : [filenames];
        //this.get(function () { });
    }
    refreshSync() {
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
                        values = requireFn(file);
                        break outer;
                    }
                    catch (err) {
                        errors.push(err);
                    }
                }
            }
        }
        if (values == null) {
            throw aws_util_1.default.error(new Error(`Unable to find file config`), { code: 'FileTreeConfigurationProviderFailure', errors: errors });
        }
        this.expired = false;
        this.update(values);
        return this;
    }
}
exports.FileTreeConfiguration = FileTreeConfiguration;
class LeoConfiguration extends rstreams_configuration_1.default {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor() {
        super();
    }
    refreshSync() {
        let config = require("leo-config");
        let values = config.leosdk || config.leo_sdk || config["leo-sdk"] ||
            config.rstreamssdk || config.rstreams_sdk || config["rstreams-sdk"];
        if (values == null) {
            throw aws_util_1.default.error(new Error(`Unable to get config from leo-config env ${config.env}`), { code: 'LeoConfigurationProviderFailure' });
        }
        this.expired = false;
        this.update(values);
        return this;
    }
}
exports.LeoConfiguration = LeoConfiguration;
class ObjectConfiguration extends rstreams_configuration_1.default {
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor(root, field) {
        super();
        this.field = field;
        this.root = root;
        //this.get(function () { });
    }
    refreshSync() {
        if (this.root == null || this.field == null || this.field == "") {
            throw aws_util_1.default.error(new Error(`Root and Field must be specified.`), { code: 'ObjectConfigurationProviderFailure' });
        }
        let values = this.root[this.field] ? this.root[this.field] : null;
        if (values == null) {
            throw aws_util_1.default.error(new Error(`Unable to get config from ${this.field}`), { code: 'ObjectConfigurationProviderFailure' });
        }
        this.expired = false;
        this.update(values);
        return this;
    }
}
exports.ObjectConfiguration = ObjectConfiguration;
class AWSSecretsConfiguration extends rstreams_configuration_1.default {
    static clearCache() {
        AWSSecretsConfiguration.valueCache = {};
    }
    /**
     * Creates a new ConfigProviderChain with a default set of providers
     * specified by {defaultProviders}.
     */
    constructor(secretEnvKey, cacheDuration) {
        super();
        this.secretEnvKey = secretEnvKey;
        this.cacheDuration = cacheDuration || (1000 * 60 * 60);
    }
    refreshSync() {
        if (!process || !process.env || !process.env[this.secretEnvKey]) {
            throw aws_util_1.default.error(new Error(`Secret not specified.  Use ENV var ${this.secretEnvKey}.`), { code: 'AWSSecretsConfigurationProviderFailure' });
        }
        let values = null;
        let secretKey = process.env[this.secretEnvKey];
        let region = process.env.AWS_REGION || "us-east-1";
        let cacheKey = `${region}:${secretKey}`;
        let cachedValue = AWSSecretsConfiguration.valueCache[cacheKey];
        if (cachedValue != null && cachedValue.expireTime >= Date.now()) {
            values = cachedValue.data;
        }
        else {
            delete AWSSecretsConfiguration.valueCache[cacheKey];
        }
        if (values == null) {
            let error;
            try {
                let value = new aws_sdk_sync_1.default.SecretsManager({
                    region: region
                }).getSecretValue({ SecretId: secretKey });
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
                    error = aws_util_1.default.error(new Error(`Unable to parse secret '${secretKey}'.`), { code: 'AWSSecretsConfigurationProviderFailure' });
                }
            }
            catch (err) {
                error = aws_util_1.default.error(new Error(`Secret '${secretKey}' not available. ${err}`), { code: 'AWSSecretsConfigurationProviderFailure', parent: err });
            }
            if (error != null) {
                throw error;
            }
            AWSSecretsConfiguration.valueCache[cacheKey] = {
                expireTime: Date.now() + this.cacheDuration,
                data: values
            };
        }
        this.expired = false;
        this.update(values);
        return this;
    }
}
exports.AWSSecretsConfiguration = AWSSecretsConfiguration;
AWSSecretsConfiguration.valueCache = {};
//# sourceMappingURL=rstreams-config-provider-chain.js.map