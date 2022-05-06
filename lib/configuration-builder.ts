import aws from "./aws-sdk-sync";


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
	constructor(private data: ConfigurationData) { }

	build(options: ConfigOptions = {}): T {
		options.stage = options.stage || process.env.STAGE || process.env.ENVIRONMENT || process.env.LEO_ENVIRONMENT;
		options.region = options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
		let g = (global as any);
		if (g.rstreams_project_config_cache == null) {
			g.rstreams_project_config_cache = {};
		}

		if (this.data == null) {
			this.data = process.env.RSF_CONFIG;
		}

		if (typeof this.data === "string") {
			if (this.data.match(/^{.*}$/)) {
				// config is a json string
				this.data = JSON.stringify(this.data);
			} else {
				// config is the key to a secret
				this.data = JSON.parse(new aws.SecretsManager({
					region: options.region
				}).getSecretValue({
					SecretId: this.data
				}).SecretString);
			}
		}

		return this.resolve(this.data, g.rstreams_project_config_cache, options) as T;

	}

	private resolve(root: any, cache: any, options: ConfigOptions): any {
		let returnValue = {};
		Object.getOwnPropertyNames(root).forEach(key => {
			let value = root[key];

			// convert  string shorthand to full ResourceReference
			if (typeof value === "string" && value.match(/^.+?::/)) {
				let [service, key, type, opts] = value.split('::');
				type = type || "dynamic";
				value = {
					service,
					key,
					type,
					options: opts && inferTypes((opts).split(';').reduce((all, one) => {
						let [key, value] = one.split('=')
						if (key !== '') {
							all[key] = value == null ? true : value
						}
						return all
					}, {}))
				}
			}

			if (this.isResourceReference(value)) {
				returnValue[key] = this.resolveReference(value as ResourceReference, cache, options);
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
		return value != null && typeof value === "object" && value.service && value.key && value.type && ConfigurationBuilder.Resolvers[value.service];
	}

	static Resolvers = {
		ssm: (ref: ResourceReference) => {
			return process.env[`RS_ssm::${resolveKeywords(ref.key, ref.options)}`];
		},
		cf: (ref: ResourceReference) => {
			return process.env[`RS_cf::${resolveKeywords(ref.key, ref.options)}`];
		},
		stack: (ref: ResourceReference) => {
			return process.env[`RS_stack::${resolveKeywords(ref.key, ref.options)}`];
		},
		secret: (ref: ResourceReference, cache: any) => {
			let resolvedKey = resolveKeywords(ref.key, ref.options);
			if (process.env[`RS_secret::${resolvedKey}`] && !process.env[`RS_secret::${resolvedKey}`].match(/^(true|false)$/)) {
				return process.env[`RS_secret::${resolvedKey}`];
			}
			let [, key, path] = resolvedKey.match(/^(.*?)(?:\.(.*))?$/);
			let cacheKey = `secret::${key}`;
			let cachedValue = cache[cacheKey];
			let envValue = process.env[`RS_${cacheKey}`]
			if (cachedValue == null) {
				if (envValue === "true") {
					let value = JSON.parse(new aws.SecretsManager({
						region: ref.options?.region
					}).getSecretValue({
						SecretId: resolveKeywords(key, ref.options)
					}).SecretString);
					cache[cacheKey] = value;
					cachedValue = value;
				} else if (envValue != null) {
					cachedValue = JSON.parse(envValue);
					cache[cacheKey] = cachedValue;
				}
			}
			return getDataSafe(cachedValue, path);
		}
	}
}

function resolveKeywords(template: string, data: any) {
	const name = template.replace(/\${(.*?)}/g, function (match, field) {
		let value = getDataSafe(data, field);
		if (value != null && typeof value === "object") {
			value = JSON.stringify(value, null, 2);
		}
		return value != null ? value : match;
	}).replace(/[_-]{2,}/g, "");
	return name;
}
function getDataSafe(data = {}, path = "") {
	const pathArray = path.split(".").filter(a => a !== "");
	if (pathArray.length === 0) {
		return data;
	}
	const lastField = pathArray.pop();
	return pathArray.reduce((parent, field) => parent[field] || {}, data)[lastField];
}

const numberRegex = /^\d+(?:\.\d*)?$/;
const boolRegex = /^(?:false|true)$/i;
const nullRegex = /^null$/;
const undefinedRegex = /^undefined$/;
const jsonRegex = /^{.*}$/;

function inferTypes(node) {
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
