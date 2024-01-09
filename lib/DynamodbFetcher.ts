import https from "https";
import AWS from "aws-sdk";
import async from "async";
import { BatchOptions, JoinExternalFetcher } from "./types";
import { promisify } from "util";

export class DynamodbFetcher<T, R> implements JoinExternalFetcher<T, R> {
	tableName: string;
	ddb: AWS.DynamoDB.DocumentClient;
	getDdbKey: (T) => any;
	batch = 0;
	public batchOptions?: BatchOptions;
	constructor(tableName: string, getDdbKey: (T) => any, batchOptions?: BatchOptions) {
		this.tableName = tableName;
		this.getDdbKey = getDdbKey;
		this.batchOptions = batchOptions;
		this.ddb = new AWS.DynamoDB.DocumentClient({
			region: process.env.AWS_REGION ?? "us-east-1",
			maxRetries: 2,
			convertEmptyValues: true,
			httpOptions: {
				connectTimeout: 2000,
				timeout: 5000,
				agent: new https.Agent({
					ciphers: 'ALL',
				}),
			},
		});
	}

	keyToString(key: any): string {
		return Object.keys(key).sort().map(k => {
			return `${k}:${key[k]}`;
		}).join("/");
	}

	async join(events): Promise<(T & { joinData: R })[]> {
		let myBatch = this.batch++;
		let params: AWS.DynamoDB.DocumentClient.BatchGetItemInput = {
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
				let extData = await self.ddb.batchGet(params).promise();
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
