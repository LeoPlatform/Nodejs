import { Context } from "aws-lambda";
import { BotInvocationEvent, RStreamsContext, RStreamsSdk } from "../index";
import refUtil from "../lib/reference";
import config from "../leoConfigure";
import leoLogger from "leo-logger";
import { IProcessor, ProcessorParameters, RStreamsBotHooks } from "./lib/types";
import { FanoutProcessor } from "./lib/fanout-processor";
import { CronProcessor } from "./lib/cron-processor";
import { Processor } from "./lib/processor";
import { APIGatewayProxyEvent, ApiProcessor } from "./lib/api-processor";
import "./lib/process";

export * from "./lib/types";
export * from "./lib/fanout-processor";

const logger = leoLogger("smart.wrapper");

const botId = config.name;
const settings = config.cron && config.cron.settings || {};

export class RStreamsBot<InvocationEvent, Settings, Result> {
	sdk: RStreamsSdk;
	currentContext?: Context;
	currentEvent?: InvocationEvent;
	isInitialized: boolean = false;
	isFanout: boolean = false;

	constructor(private hooks: RStreamsBotHooks<InvocationEvent, Settings, Result>) {
		this.sdk = new RStreamsSdk();
		this.setupFanout();
	}
	setupFanout() {
		this.isFanout = this.hooks.eventPartition != null || this.hooks.instances != null;
	}

	initialize(event: InvocationEvent, context: Context): Promise<void> {

		this.currentContext = context;
		this.currentEvent = event;

		this.setupRegistry(context, event);

		if (!this.isInitialized) {
			this.isInitialized = true;
			return this.hooks.initialize(this);
		} else {
			return Promise.resolve();
		}
	}


	/**
	 * 
	 * @returns handler bound to the class
	 */
	public export() {
		return this.handler.bind(this);
	}

	public async handler(inputEvent: InvocationEvent, context: Context) {
		let rstreamsContext: RStreamsContext<Settings> = this.createRStreamsContext(context, inputEvent);

		let processor = this.createProcessor(inputEvent, rstreamsContext);

		logger.debug("Registry", config.registry);

		return await processor.run();
	}

	createProcessor(event: any, context: RStreamsContext): IProcessor<Result> {
		//
		if (this.isFanout) {
			FanoutProcessor.fixInstanceForChildProcess(event);
		}
		let processor: IProcessor<Result>;
		let params: ProcessorParameters<InvocationEvent, Result, Settings> = {
			inputEvent: event,
			context: context,
			init: this.initialize(event, context),
			fn: this.hooks.handler.bind(this.hooks)
		};

		if (CronProcessor.HandlesEvent(event)) {
			// verified that InvocationEvent is the correct type
			processor = new CronProcessor(params as unknown as ProcessorParameters<BotInvocationEvent, Result, Settings>);
		} else if (ApiProcessor.HandlesEvent(event)) {
			// verified that InvocationEvent is the correct type
			processor = new ApiProcessor(params as unknown as ProcessorParameters<APIGatewayProxyEvent<BotInvocationEvent>, Result, Settings>) as unknown as IProcessor<Result>;
		} else {
			processor = new Processor(params);
		}

		if (this.isFanout) {
			processor = new FanoutProcessor(processor, event, context, this.hooks);
		}

		return processor;
	}



	createRStreamsContext<Settings>(context: Context, inputEvent: Record<any, any>): RStreamsContext<Settings> {
		let rstreamsContext = context as RStreamsContext<Settings>;

		rstreamsContext.callbackWaitsForEmptyEventLoop = false;
		rstreamsContext.resources = rstreamsContext.resources as Settings;
		rstreamsContext.botId = typeof inputEvent.botId === "string" ? inputEvent.botId : botId;

		rstreamsContext.sdk = this.sdk;

		// Provided for backwards compatability
		// Maybe add this back in the future
		(rstreamsContext as any).settings = settings;

		rstreamsContext.getCheckpoint = function (queue, defaultIfNull) {
			let queueRef = refUtil.ref(queue);
			let c = inputEvent.start || (
				inputEvent.__cron &&
				inputEvent.__cron.checkpoints &&
				inputEvent.__cron.checkpoints.read &&
				(
					(inputEvent.__cron.checkpoints.read[queueRef] && inputEvent.__cron.checkpoints.read[queueRef].checkpoint) ||
					(inputEvent.__cron.checkpoints.read[queueRef.id] && inputEvent.__cron.checkpoints.read[queueRef.id].checkpoint))
			) || defaultIfNull;
			return c;
		};
		return rstreamsContext;
	}

	setupRegistry(context: Context, _inputEvent: InvocationEvent) {

		empty(config.registry);
		this.sdk.configuration.registry = config.registry;
		config.registry.context = context;

		global.cron_run_again = false;
	}
}

function empty(obj: Record<any, any>) {
	for (let k in obj) {
		delete obj[k];
	}
}
