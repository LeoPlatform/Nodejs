import awsSdkSync from "./aws-sdk-sync";
import leolog from "leo-logger";
import path from "path";
import fs from "fs";

declare var __webpack_require__;
declare var __non_webpack_require__;
const requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
const logger = leolog("configuration-builder");

export interface ConfigOptions {
	stageEnvVar?: string;
	stage?: string;
	regionEnvVar?: string;
	region?: string;
	optional?: boolean
}


export type ResourceReferenceType = "string" | "number" | "float" | "integer" | "int" | "dynamic" | string;

abstract class Resource implements ResourceReference {
	service: string;
	constructor(public key: string, public type: ResourceReferenceType = "dynamic", public options?: ConfigOptions) { }
}

export class CfResource extends Resource {
	service: string = "cf";
}

export class StackResource extends Resource {
	service: string = "stack";
}

export class SecretResource extends Resource {
	service: string = "secret";
}

export interface ResourceReference {
	service: string;
	key: string;
	type: ResourceReferenceType,
	options?: ConfigOptions
}

export declare type ConfigurationData = ResourceReference | number | string | { [key: string]: ConfigurationData };

export class ConfigurationBuilder<T> {
	constructor(private data?: ConfigurationData) { }

	build(options: ConfigOptions = {}): T {
		logger.time("get-config");

		let fileCache = path.resolve(`.rsf/config-${process.env.AWS_REGION}-${process.env.RSF_INVOKE_STAGE}.json`);
		if (process.env.IS_LOCAL === "true" && fs.existsSync(fileCache)) {
			let stat = fs.statSync(fileCache);
			let duration = Math.floor((Date.now() - stat.mtimeMs) / 1000);

			// Default cache duration is 30 min
			let validCacheDuration = (+process.env.RSF_CACHE_SECONDS) || 1800;
			if (duration < validCacheDuration) {
				try {
					return requireFn(fileCache);
				} catch (e) {
					// Error getting cache
				}
			}
		}

		options.stage = options.stage || process.env.STAGE || process.env.ENVIRONMENT || process.env.LEO_ENVIRONMENT;
		options.region = options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
		// ${Stage} resolves to capitalized value (e.g. "Prod"), ${stage} to lowercase (e.g. "prod")
		if (options.stage) {
			(options as any).Stage = (options as any).Stage || options.stage.charAt(0).toUpperCase() + options.stage.slice(1).toLowerCase();
		}
		let g = (global as any);
		if (g.rstreams_project_config_cache == null) {
			g.rstreams_project_config_cache = {};
		}

		if (g.rsf_config_opts) {
			Object.assign(options, g.rsf_config_opts);
		} else if (process.env.RSF_CONFIG_OPTS) {
			Object.assign(options, JSON.parse(process.env.RSF_CONFIG_OPTS));
		}

		if (this.data == null || this.data == "") {
			if (process.env.RSF_CONFIG) {
				this.data = process.env.RSF_CONFIG;
			} else if ((process as any).rsf_config) {
				this.data = (process as any).rsf_config;
			} else if (g.rsf_config) {
				this.data = g.rsf_config;
			} else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
				throw new Error(
					`RSF_CONFIG is not set for Lambda "${process.env.AWS_LAMBDA_FUNCTION_NAME}". ` +
					`Config auto-discovery is only supported for local development. ` +
					`Ensure RSF_CONFIG is set via the deployment configuration.`
				);
			} else {
				// Auto-discover config definition from the project (local dev only)
				this.data = discoverConfigDef();
			}
		}

		if (typeof this.data === "string") {
			if (this.data.startsWith("{") && this.data.endsWith("}")) {
				// config is a json string
				// Secrets that are resolved at deploy time and reference objects
				// get injected without escaping quotes eg.  {"secret":"{"key1":"value1"}"}
				// TODO: there could be a bug where a valid string starts with { or ends with }
				// What is the best way to handle this
				this.data = this.data.replace(/"{/g, '{').replace(/}"/g, "}");
				this.data = JSON.parse(this.data);
			} else {
				// config is the key to a secret
				let secretId = resolveKeywords(this.data as string, options);
				assertKeywordsResolved(secretId);

				logger.time("get-rsf-config");
				this.data = JSON.parse(new awsSdkSync.SecretsManager({
					region: options.region
				}).getSecretValue({
					SecretId: secretId
				}).SecretString.replace(/"{/g, '{').replace(/}"/g, "}"));
				logger.timeEnd("get-rsf-config");
			}
		}

		// Allow extra env vars to be defined as RSF_CONFIG_some.new.field=my_value
		Object.entries(process.env).forEach(([key, value]) => {
			const a = (key.match(/^RSF_CONFIG_(.*)$/) || [])[1];
			if (a && key != "RSF_CONFIG_OPTS") {
				let parts = a.split(".");
				let lastPart = parts.pop();
				let parent = parts.reduce((a, b) => {
					a[b] = a[b] || {};
					return a[b];
				}, this.data);
				parent[lastPart] = inferTypes(value);
			}
		});

		let result = this.resolve(this.data, g.rstreams_project_config_cache, options) as T;

		if (process.env.IS_LOCAL === "true") {
			try {

				fs.mkdirSync(path.dirname(fileCache), { recursive: true });
				fs.writeFileSync(fileCache, JSON.stringify(result, null, 2));
			} catch (e) {
				// Error writing cache
			}
		}
		logger.timeEnd("get-config");
		return result;

	}

	private resolve(root: any, cache: any, options: ConfigOptions): any {
		if (root == null || typeof root != "object") {
			return root;
		}
		let returnValue = {};
		Object.getOwnPropertyNames(root).forEach(key => {
			let value = root[key];
			let origKey = key;

			// convert  string shorthand to full ResourceReference
			if (typeof value === "string" && value.match(/^.+?::/)) {
				let [service, key, type, opts] = value.split(/(?<!AWS)::/);
				type = type || "dynamic";
				value = {
					service,
					key,
					type,
					options: opts && inferTypes((opts).split(';').reduce((all, one) => {
						let [key, value] = one.split('=');
						if (key !== '') {
							all[key] = value == null ? true : value;
						}
						return all;
					}, {}))
				};

				// If it isn't a valid reference, set it back 
				if (!this.isResourceReference(value)) {
					value = root[origKey];
				}
			}

			if (this.isResourceReference(value)) {
				returnValue[key] = this.resolveReference(value as ResourceReference, cache, options);
			} else if (value != null && Array.isArray(value)) {
				returnValue[key] = value.map(v => this.resolve(v, cache, options));
			} else if (value != null && typeof value === "object") {
				returnValue[key] = this.resolve(value, cache, options);
			} else {
				returnValue[key] = value;
			}
		});

		return returnValue;
	}
	private resolveReference(ref: ResourceReference, cache: any, options: ConfigOptions): any {
		let opts = {
			...options,
			...ref.options
		};
		if (opts.stageEnvVar != null && process.env[opts.stageEnvVar] != null) {
			opts.stage = process.env[opts.stageEnvVar];
		}

		if (opts.regionEnvVar != null && process.env[opts.regionEnvVar] != null) {
			opts.region = process.env[opts.regionEnvVar];
		}
		let value = ConfigurationBuilder.Resolvers[ref.service]({
			options: opts,
			key: ref.key,
			service: ref.service,
			type: ref.type
		}, cache);

		if (value == null && !opts.optional) {
			throw new Error(`Missing reference: ${ref.service}::${resolveKeywords(ref.key, ref.options)}`);
		}

		// Parse the the value into the proper type
		switch (ref.type) {
			case "dynamic": return inferTypes(value);
			case "float":
			case "number": return parseFloat(value);
			case "integer":
			case "int": return parseInt(value, 10);
			case "string": return value.toString();
			default: return inferTypes(value);

		}
	}
	private isResourceReference(value: any): boolean {
		return value != null && typeof value === "object" && value.service && value.key && value.type && ConfigurationBuilder.Resolvers[value.service] != null;
	}

	static Resolvers: Record<string, (ref: ResourceReference, cache: any) => any> = {
		ssm: (ref: ResourceReference, cache: any) => {
			let resolvedKey = resolveKeywords(ref.key, ref.options);
			assertKeywordsResolved(resolvedKey);
			let envValue = process.env[`RS_ssm::${resolvedKey}`];
			if (envValue != null) {
				return envValue;
			}
			let cacheKey = `ssm::${resolvedKey}`;
			if (cache[cacheKey] != null) {
				return cache[cacheKey];
			}
			logger.log(`SSM GetParameter Key: ${resolvedKey}, Region: ${ref.options?.region}`);
			logger.time("ssm-get");
			let result = new awsSdkSync.SSM({
				region: ref.options?.region
			}).getParameter({
				Name: resolvedKey,
				WithDecryption: true
			});
			logger.timeEnd("ssm-get");
			let value = result.Parameter?.Value;
			cache[cacheKey] = value;
			return value;
		},
		cf: (ref: ResourceReference, cache: any) => {
			let resolvedKey = resolveKeywords(ref.key, ref.options);
			assertKeywordsResolved(resolvedKey);
			let envValue = process.env[`RS_cf::${resolvedKey}`];
			if (envValue != null) {
				return envValue;
			}
			let cacheKey = `cf::${resolvedKey}`;
			if (cache[cacheKey] != null) {
				return cache[cacheKey];
			}
			logger.log(`CloudFormation ListExports Key: ${resolvedKey}, Region: ${ref.options?.region}`);
			logger.time("cf-get");
			let result = new awsSdkSync.CloudFormation({
				region: ref.options?.region
			}).listExports({});
			logger.timeEnd("cf-get");
			let exports = result.Exports || [];
			for (let exp of exports) {
				cache[`cf::${exp.Name}`] = exp.Value;
			}
			return cache[cacheKey];
		},
		stack: (ref: ResourceReference, cache: any) => {
			let resolvedKey = resolveKeywords(ref.key, ref.options);
			let envValue = process.env[`RS_stack::${resolvedKey}`];
			if (envValue != null) {
				return envValue;
			}
			// Handle pseudo-parameters like ${AWS::AccountId}, ${AWS::Region}
			if (resolvedKey === "AWS::AccountId" || resolvedKey === "${AWS::AccountId}") {
				if (cache["stack::AWS::AccountId"] != null) {
					return cache["stack::AWS::AccountId"];
				}
				logger.time("sts-get");
				let identity = new awsSdkSync.STS({
					region: ref.options?.region
				}).getCallerIdentity();
				logger.timeEnd("sts-get");
				cache["stack::AWS::AccountId"] = identity.Account;
				return identity.Account;
			}
			if (resolvedKey === "AWS::Region" || resolvedKey === "${AWS::Region}") {
				return ref.options?.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
			}
			return undefined;
		},
		secret: (ref: ResourceReference, cache: any) => {
			let resolvedKey = resolveKeywords(ref.key, ref.options);
			assertKeywordsResolved(resolvedKey);
			if (process.env[`RS_secret::${resolvedKey}`] && !process.env[`RS_secret::${resolvedKey}`].match(/^(true|false)$/)) {
				return process.env[`RS_secret::${resolvedKey}`];
			}
			let [, key, path] = resolvedKey.match(/^(.*?)(?:\.(.*))?$/);
			let cacheKey = `secret::${key}`;
			let cachedValue = cache[cacheKey];
			//let envValue = process.env[`RS_${cacheKey}`]
			if (cachedValue == null) {
				//if (envValue === "true") {
				logger.log(`SecretsManager  Key: ${key}, Region:${ref.options?.region}`);

				logger.time("secret-get");
				let raw = new awsSdkSync.SecretsManager({
					region: ref.options?.region
				}).getSecretValue({
					SecretId: resolveKeywords(key, ref.options)
				}).SecretString;
				let value: any;
				try {
					value = JSON.parse(raw);
				} catch (e) {
					// Secret is a plain string, not JSON
					value = raw;
				}
				logger.timeEnd("secret-get");
				cache[cacheKey] = value;
				cachedValue = value;
				// } else if (envValue != null) {
				// 	cachedValue = JSON.parse(envValue);
				// 	cache[cacheKey] = cachedValue;
				// }
			}
			return getDataSafe(cachedValue, path);
		}
	};
}

export function resolveKeywords(template: string, data: any) {
	const name = template.replace(/\${(.*?)}/g, function (match, field) {
		let value = getDataSafe(data, field);
		if (value != null && typeof value === "object") {
			value = JSON.stringify(value, null, 2);
		}
		return value != null ? value : match;
	}).replace(/[_-]{2,}/g, "");
	return name;
}

export function assertKeywordsResolved(resolved: string) {
	let unresolved = resolved.match(/\${(.*?)}/g);
	if (unresolved) {
		let fields = unresolved.map(m => m.replace(/^\${|}$/g, ""));
		throw new Error(
			`Unresolved template variable(s) in config name "${resolved}": ${fields.join(", ")}. ` +
			`Set one of STAGE, ENVIRONMENT, or LEO_ENVIRONMENT env vars ` +
			`(e.g. STAGE=prod) or pass { stage: "prod" } to .build().`
		);
	}
}
export function getDataSafe(data = {}, path = "") {
	const pathArray = path.split(".").filter(a => a !== "");
	if (pathArray.length === 0) {
		return data;
	}
	const lastField = pathArray.pop();
	return pathArray.reduce((parent, field) => parent[field] || {}, data)[lastField];
}

function discoverConfigDef(): ConfigurationData | undefined {
	// Walk up from cwd looking for project-config.def.json
	let dir = process.cwd();
	let prev = "";
	while (dir !== prev) {
		let defFile = path.resolve(dir, "project-config.def.json");
		if (fs.existsSync(defFile)) {
			logger.log(`Auto-discovered config definition: ${defFile}`);
			return JSON.parse(fs.readFileSync(defFile, "utf-8"));
		}
		prev = dir;
		dir = path.dirname(dir);
	}
	return undefined;
}

const numberRegex = /^\d+(?:\.\d*)?$/;
const boolRegex = /^(?:false|true)$/i;
const nullRegex = /^null$/;
const undefinedRegex = /^undefined$/;
const jsonRegex = /^{(.|\n)*}$/;

export function inferTypes(node) {
	let type = typeof node;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			node[i] = inferTypes(node[i]);
		}
	} else if (type === "object" && node !== null) {
		Object.keys(node).map(key => {
			node[key] = inferTypes(node[key]);
		});
	} else if (type === "string") {
		if (numberRegex.test(node)) {
			return parseFloat(node);
		} else if (boolRegex.test(node)) {
			return node.toLowerCase() === "true";
		} else if (nullRegex.test(node)) {
			return null;
		} else if (undefinedRegex.test(node)) {
			return undefined;
		} else if (jsonRegex.test(node)) {
			return JSON.parse(node);
		}
	}

	return node;
}
