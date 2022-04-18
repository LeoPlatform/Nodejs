import { Context } from "aws-lambda";
import { RStreamsSdk } from "../index";
import stream from "stream";
import { BotInvocationEventTyped, Checkpoint } from "./types";

/**
 * Creates a BotInvocationEvent for testing a bot handler
 * 
 * @param botId Id of the bot being invoked
 * @param settings Settings to pass into the bot handler
 */
export function createBotInvocationEvent<T>(botId: string, settings: T): BotInvocationEventTyped<T>;

/**
 * Creates a Lambda Context for Testing
 * 
 * @param settings Settings to construct an Lambda Context
 */
export function createContext(settings: { Timeout?: number }): Context

export interface MockData {
	toS3: boolean;
	write: boolean;
	read: boolean;
	cron: boolean;
	queues: {
		[key: string]: unknown[] | stream.Readable
	};
	checkpoints: {
		[key: string]: Checkpoint
	};
	toDynamoDB: boolean;
	testId: number;
}

declare function ExportFn(data?: MockData, sdk?: RStreamsSdk): RStreamsSdk;
export default ExportFn;
