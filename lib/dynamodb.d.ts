import { AWSError } from "aws-sdk";

declare type Callback<E> = (err: E) => void;
declare type DataCallback<E, T> = (err: E, data: T) => void;

interface GetOptions { }
interface PutOptions { }

export interface LeoDynamodb {
	getSettingPromise: any;
	setSettingPromise: any;
	docClient: AWS.DynamoDB.DocumentClient,
	get: <T>(table: string, id: string, opts: GetOptions, callback: DataCallback<AWSError, T>) => void,
	put: <T>(table: string, id: string, item: T, opts: PutOptions, callback: Callback<AWSError>) => void,
	merge: (table: string, id: string, obj, opts, callback) => void,
	update: (table: string, key, set, opts, callback) => void,
	updateMulti: (items, opts, callback) => void,
	scan: (table: string, filter, callback) => void,
	saveSetting: <T>(setting_id: string, value: T, callback: Callback<AWSError>) => void,
	getSetting: <T>(setting_id: string, callback: DataCallback<AWSError, T>) => void,
	query: (params, configuration?, stats?) => Promise<any>,
	batchGetHashkey: (table: string, hashkey, ids, opts, callback) => void,
	batchGetTable: (table: string, keys, opts, callback) => void,
	createTableWriteStream: (table: string, opts) => void,
	batchTableWrite: (table: string, records, callback) => void,
}
