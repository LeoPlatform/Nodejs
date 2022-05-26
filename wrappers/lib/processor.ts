import { RStreamsContext } from "../../lib/types";
import { IProcessor, ProcessorParameters } from "./types";
import { config } from "./process";

import leoLogger from "leo-logger";

const logger = leoLogger("wrapper.base-processor");

export class Processor<E, T, S> implements IProcessor<T> {

	public handlerResponse: {
		error?: Error,
		data?: T
	} = {};
	protected inputEvent: E;
	protected context: RStreamsContext;
	private init: Promise<void>;
	private fn: (event: E, context: RStreamsContext) => Promise<T>;
	constructor(
		params: ProcessorParameters<E, T, S>
	) {
		this.inputEvent = params.inputEvent;
		this.context = params.context;
		this.init = params.init;
		this.fn = params.fn;
	}

	initialize() {
		this.setupRegistory();
	}

	public async run(): Promise<T> {
		const startTime = Date.now();
		try {
			await this.init; // Init requester first to setup any dependencies
			this.initialize(); // Init self
			this.handlerResponse.data = await this.fn(this.inputEvent, this.context); // Run function
			return this.handlerResponse.data;
		} catch (err) {
			this.handlerResponse.error = err;
			throw err;
		} finally {
			let duration = Date.now() - startTime;
			logger.debug(`[PROCESSOR]:duration:${duration}`);
		}
	}

	protected setupRegistory() {
		if (!config.registry.id) {
			config.registry.id = process.env.AWS_LAMBDA_FUNCTION_NAME;
		}
	}
}
