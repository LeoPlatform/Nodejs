
import { DynamoDBClient, DynamoDBClientConfig, PutItemOutput } from "@aws-sdk/client-dynamodb";
import { S3ClientConfig, ListBucketsOutput } from "@aws-sdk/client-s3";
import { GetSecretValueRequest, GetSecretValueResponse, SecretsManagerClientConfig } from "@aws-sdk/client-secrets-manager";
import { SSMClientConfig, GetParameterRequest, GetParameterResult } from "@aws-sdk/client-ssm";
import { STSClientConfig, GetCallerIdentityRequest, GetCallerIdentityResponse } from "@aws-sdk/client-sts";
import { CloudFormationClientConfig, ListExportsInput, ListExportsOutput } from "@aws-sdk/client-cloudformation";
import { spawnSync } from "child_process";

// Build a function to call on a different process
// use `module.require` to keep webpack from overriding the function.
// This isn't run within the bundle
// It is stringified and run in a different process
export function invoke(req: any, service: string, method: string, config: any, params: any, packageName?: string) {
	let hasLogged = false;
	try {
		let pkg = packageName || ("@aws-sdk/client-" + service.replace(/[A-Z]+/g, (a) => "-" + a.toLowerCase()).replace(/^-/, ""));
		let serviceLib = req(pkg);
		new serviceLib[service](config)[method](params, (err: any, data: any) => {
			if (!hasLogged) {
				hasLogged = true;
				console.log(`RESPONSE::${JSON.stringify({ error: err, response: data })}::RESPONSE`);
			}
		});
	} catch (err: any) {
		if (err.message.match(/is not a function/)) {
			err.message = `AWS.${service}.${method} is not a function`;
		} else if (err.message.match(/is not a constructor/) || err.message.match(/Cannot find module/)) {
			err.message = `AWS.${service} is not a constructor`;
		}
		if (!hasLogged) {
			hasLogged = true;
			console.log(`RESPONSE::${JSON.stringify({ error: { message: err.message } })}::RESPONSE`);
		}
	}
}

function run(service: string, method: string, config: any, params: any, packageName?: string) {
	let fn = `(${invoke.toString()})(require,"${service}", "${method}", ${JSON.stringify(config)}, ${JSON.stringify(params)}, ${packageName ? JSON.stringify(packageName) : "undefined"})`;

	// Spawn node with the function to run `node -e (()=>{})`
	// Using `RESPONSE::{}::RESPONSE` to denote the response in the output
	let child = spawnSync(process.execPath, ["-e", fn]);
	if (child.error != null) {
		// If the process had an error, throw it
		throw child.error;
	} else if (child.output.length > 0) {
		// Try to extract the response
		let output = child.output.join("");
		let outputJson = (output.match(/RESPONSE::({.*})::RESPONSE/) || [])[1];
		if (outputJson == null) {
			throw new Error(`Invalid Response: ${output}`);
		} else {
			let parsedData = JSON.parse(outputJson);
			// Return the response or error
			if (parsedData.error != null) {
				throw Object.assign(new Error(parsedData.error.message), parsedData.error);
			} else {
				return parsedData.response;
			}
		}
	}
}

export class Service<T> {
	protected packageName?: string;
	constructor(private options?: T) { }
	protected invoke(method: string, params?: any): any {
		return run(this.constructor.name, method, this.options, params, this.packageName);
	}
}

export class SecretsManager extends Service<SecretsManagerClientConfig> {
	getSecretValue(params: GetSecretValueRequest): GetSecretValueResponse {
		return this.invoke("getSecretValue", params);
	}
}

export class S3 extends Service<S3ClientConfig> {
	listBuckets(): ListBucketsOutput {
		return this.invoke("listBuckets");
	}
}


export class DynamoDB extends Service<DynamoDBClientConfig> {
	putItem(): PutItemOutput {
		return this.invoke("putItem");
	}
}

export class SSM extends Service<SSMClientConfig> {
	getParameter(params: GetParameterRequest): GetParameterResult {
		return this.invoke("getParameter", params);
	}
}

export class STS extends Service<STSClientConfig> {
	getCallerIdentity(params?: GetCallerIdentityRequest): GetCallerIdentityResponse {
		return this.invoke("getCallerIdentity", params || {});
	}
}

export class CloudFormation extends Service<CloudFormationClientConfig> {
	packageName = "@aws-sdk/client-cloudformation";
	listExports(params?: ListExportsInput): ListExportsOutput {
		return this.invoke("listExports", params || {});
	}
}

export default {
	Service,
	SecretsManager,
	S3,
	DynamoDB,
	SSM,
	STS,
	CloudFormation
};
