import { AWSError } from "aws-sdk";
import moment, { Moment } from "moment";

/**
 * Defines a callback function that takes an error object.
 * @typeParam E The Error object.
 */
export declare type Callback<E> = (err: E) => void;

/**
 * Defines a callback function That takes an error on failure and data on success.
 * @typeParam E The Error if the operation failed.
 * @typeParam T The data to return from the operation if it succeeded.
 */
declare type DataCallback<E, T> = (err: E, data: T) => void;

/**
 * @todo question What is this here for?
 */
interface CronData {

}

/**
 * @todo question What is this here for?
 */
interface InstanceData { }

/**
 * @todo question What is this here for?
 */
interface BotData { }

/**
 * Options for reporting a bot is done.
 * @todo review
 */
interface ReportCompleteOptions {
	/** If true, force the bot to be marked completed. */
	forceComplete?: boolean;
}

/**
 * Options for retrieving details about a bot.
 * @todo review
 */
interface GetOptions {
	/** 
	 * @internal Don't use.
	 * The lambda settings value of your object and you can override them when you do a get.
	 */
	overrides?: any;

	/** 
	 * @internal Don't use.
	 * 
	 * Whether to add the checkpoint results into the LeoSdk registry. So, the next time you go to checkpoint
	 * it uses the registry to get checkpoint information instead of having to back to the bot table.
	 * 
	 * @default true 
	 */
	register?: boolean

	/**
	 * @internal Don't use.
	 */
	instances?: { [key: string]: InstanceData }

	/**
	 * Which instance do I want if there is more than one instance of this bot for fanout.
	 */
	instance?: string
}

/**
 * The type used to set the checkpoint on a bot in the RStreams bus bot DynamoDB table.
 */
interface Checkpoint {
	/** Whether updating the read or write checkpoint. */
	type?: "read" | "write";

	/** The event ID to set as the checkpoint. */
	eid: string;

	/** 
	 * The source timestamp.
	 * @todo incomplete Link to rstreams.org doc on what source timestamp means.
	 */
	source_timestamp: number;

	/** 
	 * The started timestamp.
	 * @todo incomplete Link to rstreams.org doc on what source timestamp means.
	 */
	started_timestamp?: number;

	/** 
	 * The ended timestamp.
	 * @todo incomplete Link to rstreams.org doc on what source timestamp means.
	 */
	ended_timestamp?: number;

	/** 
	 * The units.
	 * @todo incomplete Link to rstreams.org doc on what units means.
	 */
	units: number;

	/** If true, force the update even if the timestamp has changed since the last time we read it. */
	force?: boolean

	/** @todo unclear */
	expected?: string;
}

/** 
 * A type used to represent a duration in milliseconds.
 * @todo question Why did we do it this way?
 */
export declare type Milliseconds = number;

/**
 * This is the set of operations that act on the RStreams bus instance's bot DynamoDB table that tracks
 * all bots, the checkpoints for those bots to various queues and other information.  It is
 * rare indeed that a developer would ever need to use these to interact directly with the bot DynamoDB table.
 * 
 * Note!  This is named LeoCron because the DynamoDB table is named LeoCron for legacy reasons.  It will likely
 * get a more current name in the future, like "BotManager".  The term `Cron` was historically associated with
 * the bot concept because initially, bots were only invoked on a cron and did not support invocation on a push
 * or pull model as they do today.
 * 
 * @todo review all the methods below
 */
export interface LeoCron {
	/**
	 * Immediately trigger the bot named `cron.id`, meaning invoke the underlying code (usually a lambda).
	 * @param cron This contains `id` which is the name of the bot to invoke
	 * @param callback A callback that will be called if something goes wrong
	 */
	trigger: (cron: { id: string }, callback: Callback<AWSError>) => void;

	/**
	 * Schedule a one-time invocation of the bot named `id` using `duration` to know when to do so.
	 * @param id The name of the bot to invoke
	 * @param duration When to invoke it
	 */
	schedule: (id: string, duration: Milliseconds | Date | Moment | moment.DurationInputArg1) => Promise<void>;

	/**
	 * Check if a bot is currently locked, meaning running right now.
	 * @param cron ??
	 * @param runid The ID of the bot running right now to check for
	 * @param remainingTime ??
	 * @param callback A callback that will be called if something goes wrong
	 * @todo question cron is the first arg but it's an empty type definition, what is it for?
	 */
	checkLock: (cron: CronData, runid: string, remainingTime: Milliseconds, callback: Callback<AWSError>) => void;

	/**
	 * Mark a bot done running.
	 * 
	 * @param cron ??
	 * @param runid The ID of the bot running right now to mark complete
	 * @param status ??
	 * @param log ??
	 * @param opts Whether to force it to comlete
	 * @param callback A callback that will be called if something goes wrong
	 * 
	 * @todo question what does forcing a bot to complete mean, remove the lock?
	 */
	reportComplete: (cron: CronData, runid: string, status: string, log: any, opts: ReportCompleteOptions, callback: Callback<AWSError>) => void;

	/**
	 * Lock the given bot, marking it as currently running.  Only one instance of a bot is meant to be running
	 * except in the special case of bots that are fanned out, meaning multiple instances of the same bot are
	 * running to scale horizontally.
	 * 
	 * @param id The ID of the bot to mark running and thus "lock"
	 * @param runid The ID that represents this instance of the running bot
	 * @param maxDuration How long to allow the bot to run dor
	 * @param callback A callback that will be called if something goes wrong
	 * 
	 * @todo question maxDuration - is this right? What happens after maxDuration?  Does the bus kill it?
	 */
	createLock: (id: string, runid: string, maxDuration: Milliseconds, callback: Callback<AWSError>) => void;

	/**
	 * Remove the lock on the given bot, marking it as not currently running.
	 * 
	 * @param id The ID of the bot to mark not running and thus remove the lock on
	 * @param runid The ID that represents this instance of the running bot
	 * @param callback A callback that will be called if something goes wrong
	 */
	removeLock: (id: string, runid: string, callback: Callback<AWSError>) => void;

	/**
	 * Set a checkpoint on a bot.  A bot checkpoints a position it has read to in a queue it reads from
	 * and marks the last position it wrote to for queues that it writes to.  The position is an event ID.
	 * 
	 * @param id The ID of the bot to checkpoint
	 * @param event The queue to checkpoint for this bot
	 * @param params The checkpoint details themselves that will be saved
	 * @param callback A callback that will be called if something goes wrong
	 */
	checkpoint: (id: string, event: string, params: Checkpoint, callback: Callback<AWSError>) => void;

	/**
	 * Get checkpoint data for the bot and the given queue.
	 * 
	 * @param botId The ID of the bot to get checkpoint data for
	 * @param queue The queue to get checkpoint data for connected to this bot
	 * @returns A promise so it can play nice with async/await that contains the checkpoint data
	 * 
	 * @todo question why does this return an any, shouldn't it return `Checkpoint`
	 */
	getCheckpoint: (botId: string, queue: string) => Promise<any>;

	/**
	 * Update bot data in the RStreams bus instances's bot DynamoDB table.
	 * 
	 * @param bot The bot data to save on the bot
	 * @param callback A callback that will be called if something goes wrong
	 */
	update: (bot: BotData, callback: Callback<AWSError>) => void;

	/**
	 * @todo unclear
	 */
	subscribe: (id: string, queue: string, data: BotData) => void;

	/**
	 * Tells the SDK that as soon as this bot ends, run it again.  Most of the time
	 * developers don't need to do this as the SDK will just do the right thing.
	 */
	runAgain: () => void;

	/**
	 * @internal Don't use.
	 */
	getLastResult: () => void;

	/**
	 * @internal Don't use.
	 * Sets an in-memory message in the registry.
	 */
	setMessage: (message: string) => void;

	/**
	 * Returns a system.
	 * 
	 * @todo docbug missing return type
	 */
	getAttachedSystemByAlias: (alias: string[]) => void;

	/**
	 * Get system by ID not by alias.
	 */
	getAttachedSystem: (id: string) => void;

	/**
	 * Get all details on a bot from the RStreams bus bot DynamoDB table.
	 * @todo docbug wrong types
	 */
	get: <T>(id: string, opts: GetOptions, callback: DataCallback<any, T>) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug preg/opts missing types
	 */
	buildPayloads: (cron: CronData, prev, opts) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug types missing?
	 */
	shouldRun: (oldImage, newImage, cache, callback) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug types missing?
	 */
	hasMoreToDo: (oldImage, newImage, key) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug types missing?
	 */
	start: (event, opts, callback) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug types missing?
	 */
	end: (status, opts, callback) => void;

	/**
	 * @internal Don't use.
	 * @todo docbug types missing?
	 */
	run: (event, handler, callback) => void;

	/**
	 * Used internally by the SDK to create a new bot.  This should only ever be used
	 * if creating a bot that does not go through cloud formation.
	 * 
	 * @todo docbug types missing?
	 */
	createBot: (id: string, bot, opts) => void;
}

export default function (config: any): LeoCron;
