import moment from "moment";
import Pumpify from "pumpify";
import stream from "stream";
import { LeoStream, fromRStreams } from "./lib/lib";
import { LeoCron } from "./lib/cron";
import { LeoDynamodb } from "./lib/dynamodb";
import AWS from "aws-sdk";

interface LeoSdk {
	destroy: (callback: (err: any) => void) => void;
	load: (botId: string, outQueue: string, config?: {
		useS3?: boolean;
		autoDetectPayload?: boolean;
	}) => Pumpify;
	offload: (config: {
		id: string;
		inQueue: string;
		config?: fromRStreams;
		batch?: () => any;
		each?: (payload, event) => any
		},
		callback: () => any
	) => Pumpify;
	enrich: (config: {
		id: string;
		inQueue: string;
		outQueue: string;
		config?: fromRStreams;
		transform: (payload, event) => any;
	}, callback: (err) => any) => Pumpify;

	read: (botId: string, inQueue: string, config?: fromRStreams) => stream.Transform;
	toLeo: (botId: string, config?: {
		useS3?: boolean;
		firehose?: boolean;
	}) => stream.Transform;
	put: (bot_id: string, outQueue: string, payload: any, callback: any) => void;

	checkpoint: (config?: {
		records: number;
		time: moment.DurationInputArg1;
		debug: boolean;
	}) => stream.Transform;
	streams: LeoStream
	bot: LeoCron,
	aws: {
		dynamodb: LeoDynamodb,
		s3: AWS.S3,
		cloudformation: AWS.CloudFormation
	}
}

// export declare function put(bot_id: string, outQueue: string, payload: any, callback: any): void;
// export declare function load(botId: string, outQueue: string, config?: {
// 	useS3?: boolean;
// 	autoDetectPayload?: boolean;
// }): Pumpify;




declare function ExportTypeFn(config: any): LeoSdk;
//declare type ExportTypeFn = (config: any) => LeoSdk;
//declare interface LeoSdkExport extends LeoSdk, ExportTypeFn { }
// /declare type ExportType = ExportTypeFn;
export = ExportTypeFn;
