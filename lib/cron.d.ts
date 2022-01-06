import { AWSError } from "aws-sdk";
import { Moment } from "moment";

declare type Callback<E> = (err: E) => void;
declare type DataCallback<E, T> = (err: E, data: T) => void;

interface CronData {

}

interface InstanceData { }
interface BotData { }
interface ReportCompleteOptions {
	forceComplete?: boolean;
}
interface GetOptions {
	overrides?: any;
	register?: boolean
	instances?: { [key: string]: InstanceData }
	instance?: string
}
interface Checkpoint {
	type?: "read" | "write";
	eid: string;
	source_timestamp: number;
	started_timestamp?: number;
	ended_timestamp?: number;
	units: number;
	force?: boolean
	expected?: string;
}

declare type Milliseconds = number;
export interface LeoCron {
	trigger: (cron: { id: string }, callback: Callback<AWSError>) => void;
	schedule: (id: string, duration: Milliseconds | Date | Moment) => Promise<void>;
	checkLock: (cron: CronData, runid: string, remainingTime: Milliseconds, callback: Callback<AWSError>) => void;
	reportComplete: (cron: CronData, runid: string, status: string, log: any, opts: ReportCompleteOptions, callback: Callback<AWSError>) => void;
	createLock: (id: string, runid: string, maxDuration: Milliseconds, callback: Callback<AWSError>) => void;
	removeLock: (id: string, runid: string, callback: Callback<AWSError>) => void;
	checkpoint: (id: string, event: string, params: Checkpoint, callback: Callback<AWSError>) => void;
	getCheckpoint: (botId: string, queue: string) => Promise<any>;
	update: (bot: BotData, callback: Callback<AWSError>) => void;
	subscribe: (id: string, queue: string, data: BotData) => void;
	runAgain: () => void;
	getLastResult: () => void;
	setMessage: (message: string) => void;
	getAttachedSystemByAlias: (alias: string[]) => void;
	getAttachedSystem: (id: string) => void;
	get: <T>(id: string, opts: GetOptions, callback: DataCallback<any, T>) => void;
	buildPayloads: (cron: CronData, prev, opts) => void;
	shouldRun: (oldImage, newImage, cache, callback) => void;
	hasMoreToDo: (oldImage, newImage, key) => void;
	start: (event, opts, callback) => void;
	end: (status, opts, callback) => void;
	run: (event, handler, callback) => void;
	createBot: (id: string, bot, opts) => void;
}
