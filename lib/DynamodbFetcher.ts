import https from "https";
import async from "async";
import { BatchOptions, JoinExternalFetcher } from "./types";
import { promisify } from "util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommandInput, DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
export class DynamodbFetcher<T, R> implements JoinExternalFetcher<T, R> {
	tableName: string;
	ddb: DynamoDBDocument;
	getDdbKey: (T) => any;
	batch = 0;
	public batchOptions?: BatchOptions;
	constructor(tableName: string, getDdbKey: (T) => any, batchOptions?: BatchOptions) {
		this.tableName = tableName;
		this.getDdbKey = getDdbKey;
		this.batchOptions = batchOptions;
		this.ddb = DynamoDBDocument.from(new DynamoDBClient({
			region: process.env.AWS_REGION ?? "us-east-1",
			maxAttempts: 3,
			requestHandler: new NodeHttpHandler({
				connectionTimeout: 2000,
				requestTimeout: 5000,
				httpsAgent: new https.Agent({
					ciphers: 'ALL',
				}),
			}),
		}), {
			marshallOptions: {
				convertEmptyValues: true
			}
		});
	}

	keyToString(key: any): string {
		return Object.keys(key).sort().map(k => {
			return `${k}:${key[k]}`;
		}).join("/");
	}

	async join(events): Promise<(T & { joinData: R })[]> {
		let myBatch = this.batch++;
		let params: BatchGetCommandInput = {
			RequestItems: {
				[this.tableName]: {
					Keys: []
				}
			},
			"ReturnConsumedCapacity": 'TOTAL'
		};
		let keys = {};

		let work = [];

		// TODO: Break up requests into 100
		events.map(e => {
			let key = this.getDdbKey(e);
			if (key != null) {
				let k = this.keyToString(key);
				e.ddbKey = k;
				if (!(k in keys)) {
					keys[k] = true;
					params.RequestItems[this.tableName].Keys.push(key);
					if (params.RequestItems[this.tableName].Keys.length === 100) {
						work.push(params);
						params = {
							RequestItems: {
								[this.tableName]: {
									Keys: []
								}
							},
							"ReturnConsumedCapacity": 'TOTAL'
						};
					}
				}
			}
		});

		if (params.RequestItems[this.tableName].Keys.length > 0) {
			work.push(params);
		}

		let lookup = {};
		if (work.length > 0) {
			let keyFields = Object.keys(work[0].RequestItems[this.tableName].Keys[0]);

			console.log("query", myBatch, work.length);
			let c = 0;
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let self = this;
			await promisify(async.eachLimit).call(async, work, 10, async function (params) {
				let myC = c++;
				let extData = await self.ddb.batchGet(params);
				extData.Responses?.[self.tableName]?.forEach(entry => {
					let keyObject = keyFields.reduce((a, field) => { a[field] = entry[field]; return a; }, {});
					let key = self.keyToString(keyObject);
					lookup[key] = entry;
				});
				console.log("query", myC, "done");
			});

			console.log("joined", myBatch, Object.values(lookup).length);
		} else {
			console.log("joined", myBatch, "no work");
		}
		return events.map(e => {
			e.joinedData = lookup[e.ddbKey];
			//delete e.ddbKey;
			return e;
		});
	}
}
