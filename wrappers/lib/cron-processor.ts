import { Milliseconds, ReportCompleteOptions } from "../../lib/cron";
import { BotInvocationEvent, Cron } from "../../index";
import { InstanceStatus, ProcessorParameters } from "./types";
import { promisify } from "util";
import { Processor } from "./processor";
import { config } from "./process";
import leoLogger from "leo-logger";

const logger = leoLogger("wrapper.cron-processor");

export class CronProcessor<E extends BotInvocationEvent, T, S> extends Processor<E, T, S> {
	public static HandlesEvent(event: any): boolean {
		return event && event.__cron != null;
	}

	id: string;
	cron: Cron;
	checkLock: (cron: Cron, runid: string, remainingTime: Milliseconds) => Promise<void>;
	reportComplete: (cron: Cron, runid: string, status: string, log: any, opts: ReportCompleteOptions) => Promise<void>;

	constructor(
		params: ProcessorParameters<E, T, S>
	) {
		super(params);
		this.cron = this.inputEvent.__cron;
		console.log("IID:", this.cron.iid);
		this.id = `${this.cron.id}:${this.cron.iid}:${this.cron.ts}:${this.context.awsRequestId}`;
		this.checkLock = promisify(this.context.sdk.bot.checkLock).bind(this.context.sdk.bot);
		this.reportComplete = promisify(this.context.sdk.bot.reportComplete).bind(this.context.sdk.bot);

		this.setupUncaughtExceptions();
	}

	public setupUncaughtExceptions() {
		for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
			process.removeListener('uncaughtException', x);
		}
		process.on('uncaughtException', async (err) => {
			console.log(`[LEOCRON]:end:${this.id}`);
			logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
			logger.error(err.stack);
			await this.releaseLock(err);
		});
	}

	public async obtainLock() {
		try {
			console.log("[LEOCRON]:check:" + this.id);
			await this.checkLock(this.cron, this.id, this.context.getRemainingTimeInMillis());
			console.log("[LEOCRON]:start:" + this.id);
		} catch (err) {
			if (err.code === "ConditionalCheckFailedException") {
				throw new Error("already running");
			} else {
				throw new Error("failed getting lock");
			}
		}
	}

	public async releaseLock(error: any) {
		console.log("[LEOCRON]:complete:" + this.id);
		await this.reportComplete(this.cron, this.id, error ? InstanceStatus.error : InstanceStatus.complete, error ? error : "", {});
	}

	override setupRegistry() {
		super.setupRegistry();
		config.registry.__cron = this.cron;
		config.registry.id = this.cron.id;
	}

	public override async run(
	): Promise<T> {
		await this.obtainLock();
		let error: Error;
		try {
			return await super.run();
		} catch (err) {
			error = err;
		} finally {
			await this.releaseLock(error);
		}
	}
}
