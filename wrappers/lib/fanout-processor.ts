import { InvocationResponse } from "aws-sdk/clients/lambda";
import { Checkpoints, Checkpoint, RStreamsContext, } from "../../index";
import { BotData, InstanceData, ReadFilterGroup } from "../../lib/cron";
import { InstancesFn, IProcessor, ReduceFn, RStreamsBotHooks } from "./types";
import aws from "aws-sdk";
import moment from "moment";
import leoLogger from "leo-logger";
import { config } from "./process";

const logger = leoLogger("wrapper.fanout-processor");


export interface FanoutEvent {
	iid?: number;

	/** The total number of bot instances */
	icount?: number;

	/** Starting positions for a given queue */
	starteid?: {
		[key: string]: Checkpoint | string // not sure which this is yet
	},

	/** */
	read_filter_groups?: ReadFilterGroup[];

	ignoreLock?: boolean;


	/** List of read/write positions of sources and destinations for this bot */
	checkpoints?: Checkpoints;
	instances?: Record<string, InstanceData & { __last_activated?: number }>

	maxeid: string
	cploc: "checkpoints" | "instances"

}

export interface FanoutInvokeResponse<Result> {
	error: any;
	data: Result;
	iid: number;
}

export class FanoutProcessor<InvocationEvent, Settings, Result> implements IProcessor<Result>{

	static eventIdFormat = "[z/]YYYY/MM/DD/HH/mm/";
	static ReadFilterGroupChangeDelayMS: number = 1000 * 60 * 15; // Can only change filter group size every 15 minutes
	static ReadFilterGroupChangeMaxEidDistanceMS: number = 1000 * 60 * 15; // Must be within 15 minutes of the last filter group eid

	public handlerResponse: { error?: Error; data?: Result; } = {};

	reduce: ReduceFn<Result>;
	getNeedNeedInstances: InstancesFn<InvocationEvent>;
	iid: number;
	icount: number;
	container: FanoutEvent;

	constructor(
		private processor: IProcessor<Result>,
		private inputEvent: any,
		private context: RStreamsContext,
		private hooks: RStreamsBotHooks<InvocationEvent, Settings, Result>
	) {
		this.getNeedNeedInstances = typeof this.hooks.instances === "function" ? this.hooks.instances.bind(this.hooks) : (_) => this.hooks.instances as number || 1;

		let { iid, icount, container } = this.getMetadata(inputEvent);

		config.registry.rstreamsLeoReadFilterContainer = container;
		this.iid = iid;
		this.icount = icount;
		this.container = container;

		// Setup Global RStreamsSdk Filtering
		global.rstreamsLeoReadFilterEventPartition = this.hooks.eventPartition ? this.hooks.eventPartition.bind(this.hooks) : (event => event.eid);
		global.rstreamsLeoReadFilterData = this.container;
	}

	getMetadata(inputEvent) {
		let iid = 0;
		let icount = 1;

		let container: FanoutEvent = inputEvent.__cron || inputEvent || {};

		if (container && container.iid) {
			//container.iid = typeof container.iid === "number" ? container.iid : parseInt(container.iid, 10) || 0;
			iid = typeof container.iid === "number" ? container.iid : parseInt(container.iid, 10) || 0;
			icount = container.icount;
		}

		// Correct missing instances from event to __cron 
		if (
			container != inputEvent &&
			container.instances &&
			inputEvent.instances &&
			Object.keys(container.instances).length != Object.keys(inputEvent.instances).length
		) {
			container.instances = inputEvent.instances;
		}

		if (
			container != inputEvent &&
			container.checkpoints &&
			inputEvent.checkpoints &&
			Object.keys(container.checkpoints).length != Object.keys(inputEvent.checkpoints).length
		) {
			container.checkpoints = inputEvent.checkpoints;
		}

		return { iid, icount, container };
	}

	static fixInstanceForChildProcess(event: any) {
		event.__FANOUT__ = true;
		// Get fanout data from process env if running locally
		if (process.env.FANOUT_data) {
			Object.assign(event, JSON.parse(process.env.FANOUT_data));
		}
	}

	isMaster(): boolean {
		return this.iid == 0 || this.icount == null || this.icount == 1;
	}

	isWorker(): boolean {
		return !this.isMaster();
	}

	async invokeLambda(iid: number, count: number, newEvent: any): Promise<FanoutInvokeResponse<Result>> {

		let data: InvocationResponse;//FanoutInvokeResponse<Result>;
		let error;
		try {
			let lambdaApi = new aws.Lambda({
				region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
				httpOptions: {
					timeout: this.context.getRemainingTimeInMillis() // Default: 120000 // Two minutes
				}
			});

			// todo: Should we invoke a new function or just run a new local process
			logger.log("[lambda]", process.env.AWS_LAMBDA_FUNCTION_NAME);
			data = await lambdaApi.invoke({
				FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
				InvocationType: 'RequestResponse',
				Payload: JSON.stringify(newEvent),
				Qualifier: process.env.AWS_LAMBDA_FUNCTION_VERSION
			}).promise();

		} catch (err) {
			error = err;
		}


		logger.log(`Done with Lambda instance ${iid + 1}/${count}`);
		logger.log("[lambda err]", error);
		logger.log("[lambda data]", data);

		let response: FanoutInvokeResponse<Result>;
		if (error) {
			throw error;
		} else if (data.FunctionError) {
			throw data.Payload;
		} else if (data.Payload != undefined && data.Payload != 'null') {
			response = JSON.parse(data.Payload as string);
		} else {
			response = data as any;
		}

		logger.debug("[lambda invoked invocation/payload]", data, JSON.stringify(newEvent, null, 2));
		return response;
	}

	async invokeProcess(iid: number, count: number, newEvent: any): Promise<FanoutInvokeResponse<Result>> {
		// Fork process with event
		let worker = require("child_process").fork(process.argv[1], process.argv.slice(2), {
			cwd: process.cwd(),
			env: Object.assign({}, process.env, {
				FANOUT_data: JSON.stringify(newEvent),
				runner_keep_cmd: true
			}),
			execArgv: process.execArgv
		});

		// setup communication between processes
		let responseData: FanoutInvokeResponse<Result>;
		worker.once("message", (response: FanoutInvokeResponse<Result>) => {
			logger.log(`Got Response with instance ${iid + 1}/${count}`);
			responseData = response;
		});

		return new Promise(resolve => {
			worker.once("exit", () => {
				logger.log(`Done with child instance ${iid + 1}/${count}`);
				logger.log("[responseData]", responseData);
				resolve(responseData);
			});
		});
	}

	async invokeSelf(event: any, iid: number, count: number): Promise<FanoutInvokeResponse<Result>> {
		logger.log(`Invoking ${iid + 1}/${count}`);

		// Deep copy the invocation event and set instances variables
		let newEvent = JSON.parse(JSON.stringify(event));
		let { container } = this.getMetadata(newEvent);
		container.iid = iid;
		container.icount = count;
		container.ignoreLock = true;
		// delete (container as any).force;

		// Add starting points for all queues.
		// leo-sdk will look to this before the default checkpoints.read[queue]
		let myInstance = (event.instances || {})[iid] || {};
		container.starteid = Object.keys(myInstance).reduce((all, key) => {
			if (key.match(/^queue:/) && myInstance[key] && myInstance[key].checkpoint) {
				all[key] = myInstance[key].checkpoint;
			}
			return all;
		}, {});

		// If running in lamba
		if (process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.IS_LOCAL && this.hooks.invokeType !== "process") {
			return await this.invokeLambda(iid, count, newEvent);
		}
		// If running local or child process
		else {
			return await this.invokeProcess(iid, count, newEvent);
		}
	}

	async masterRun(): Promise<Result> {
		// This is the master, start the needed workers
		let timestamp = moment.utc();
		this.container.maxeid = this.container.maxeid || this.inputEvent.maxeid || timestamp.format(FanoutProcessor.eventIdFormat) + timestamp.valueOf();
		this.container.iid = 0;
		logger.log("Fanout Master", this.container.iid);


		let readFilterGroups: ReadFilterGroup[] = this.inputEvent.read_filter_groups || [];
		// Get Bot data if not provided
		if (
			!this.container.instances ||
			!this.container.checkpoints
		) {
			let bot: BotData = await new Promise((resolve, reject) =>
				this.context.sdk.aws.dynamodb.get<BotData>(
					this.context.sdk.configuration.resources.LeoCron,
					this.inputEvent.botId,
					{},
					(err, data) => err ? reject(err) : resolve(data)));

			this.container.instances = (bot || {}).instances || {};
			this.container.checkpoints = (bot || {}).checkpoints || { read: {}, write: {} };
			this.inputEvent.requested_kinesis = (bot || {}).requested_kinesis || {};
			readFilterGroups = (bot || {}).read_filter_groups || [];
			if (bot == null) {
				await this.context.sdk.bot.createBot(this.inputEvent.botId, {});
			}
		}

		// Find number of requested instances
		let instances = Math.ceil(this.getNeedNeedInstances(this.inputEvent, this.container));
		instances = Math.max(1, Math.min(instances, this.hooks.maxInstances || 20));

		// Add any entries that don't exist
		let command = {
			TableName: this.context.sdk.configuration.resources.LeoCron,
			Key: {
				id: this.inputEvent.botId
			},
			UpdateExpression: undefined,
			ExpressionAttributeNames: {},
			ExpressionAttributeValues: {}
		};
		let toAdd = [];

		// Filter out any dead groups
		let minEid: string = null;
		let maxEid: string = "z/";
		let activeInstancesFromFilterGroups = new Set();
		let maxInstancesFromGroupsPreFilter = readFilterGroups.reduce((a, b) => Math.max(a, b.icount), instances);
		for (let i = 0; i < maxInstancesFromGroupsPreFilter; i++) {
			activeInstancesFromFilterGroups.add(i.toString());
		}
		Object.entries(this.container.instances)
			.filter(([key]) => activeInstancesFromFilterGroups.has(key))
			.map(([_key, value]) => value)
			.concat(this.container.checkpoints.read).forEach(inst => {
				Object.entries(inst).forEach(([key, cp]) => {
					if (key.match(/^queue:/) && cp?.checkpoint) {
						minEid = (minEid && minEid.localeCompare(cp.checkpoint) <= 0) ? minEid : cp.checkpoint;
						maxEid = (maxEid && maxEid.localeCompare(cp.checkpoint) >= 0) ? maxEid : cp.checkpoint;
					}
				});
			});

		// Only filter if we have a minEid and there are more than 1 group
		// Otherwise it just removed and adds the group
		if (minEid && readFilterGroups.length > 1) {
			readFilterGroups = readFilterGroups.filter(g => g.eid >= minEid);
		}
		let latest: ReadFilterGroup = readFilterGroups[readFilterGroups.length - 1];
		if (
			latest == null ||
			(
				latest.icount != instances && // Have a different icount
				// latest.eid < maxEid &&
				(Date.now() - latest.ts) >= FanoutProcessor.ReadFilterGroupChangeDelayMS && // outside the change delay window
				true // (Date.now() - this.context.sdk.streams.eventIdToTimestamp(latest.eid)) <= FanoutProcessor.ReadFilterGroupChangeMaxEidDistanceMS // last group eid is close
			)
		) {
			readFilterGroups.push({
				icount: instances,
				eid: maxEid, //this.container.maxeid,
				ts: Date.now()
			});
			toAdd.push(`#rfg = :rfg`);
			command.ExpressionAttributeNames["#rfg"] = "read_filter_groups";
			command.ExpressionAttributeValues[":rfg"] = readFilterGroups;
		} else {
			// Ignore the new count because they aren't allowed to change yet
			// instances = latest.icount;
		}

		this.container.icount = instances;
		this.container.read_filter_groups = readFilterGroups;

		let maxInstancesFromGroups = readFilterGroups.reduce((a, b) => Math.max(a, b.icount), instances);

		// Add the starting point for the instances to be the new max eid
		let startingCheckpoints = Object.keys((this.container.checkpoints || {}).read || {}).reduce((out, queue) => {
			if (queue.match(/^queue:/)) {
				out[queue] = {
					checkpoint: maxEid
				};
			}
			return out;
		}, {});

		for (let i = 0; i < maxInstancesFromGroups; i++) {
			// Instance doesn't exist yet
			if (!this.container.instances[i]) {
				// Add checkpoint location in the DB for this instance id
				this.container.instances[i] = startingCheckpoints;

				toAdd.push(`#instances.#i${i} = :i${i}`);
				command.ExpressionAttributeNames[`#i${i}`] = `${i}`;
				command.ExpressionAttributeValues[`:i${i}`] = this.container.instances[i];
				command.ExpressionAttributeNames["#instances"] = "instances";
				this.container.instances[i].__last_activated = Date.now();
			} else if (i != 0) {
				let changed = false;
				this.container.instances[i] = {
					...startingCheckpoints,
					...this.container.instances[i]
				};

				// Reset the starting point for the instances to be the new max eid
				Object.entries(this.container.instances[i]).forEach(([queue, cp]: [string, Checkpoint]) => {
					if (queue.match(/^queue:/) && cp && cp.checkpoint && cp.checkpoint < minEid) {
						changed = true;
						this.container.instances[i][queue] = {
							checkpoint: maxEid
						};
					}
				});

				// Only update if we needed to update position
				if (changed) {
					toAdd.push(`#instances.#i${i} = :i${i}`);
					command.ExpressionAttributeNames[`#i${i}`] = `${i}`;
					command.ExpressionAttributeValues[`:i${i}`] = this.container.instances[i];
					this.container.instances[i].__last_activated = Date.now();
					command.ExpressionAttributeNames["#instances"] = "instances";
				}
			}
		}

		// Update the cron table with the needed instances
		if (toAdd.length > 0) {
			command.UpdateExpression = `set ${toAdd.join(",")}`;
			logger.log("Updating Worker instances data", JSON.stringify(command, null, 2));
			await this.context.sdk.aws.dynamodb.docClient.update(command).promise();
		}

		let workers: Promise<FanoutInvokeResponse<Result>>[] = [];

		// Start the other workers
		for (let i = 1; i < maxInstancesFromGroups; i++) {
			workers.push(this.invokeSelf(this.inputEvent, i, instances));
		}

		// Setup Master Worker
		workers.unshift(
			(async () => {
				logger.log(`Invoking 1/${instances}`);

				// Handle promise or callback response
				let data: Result;
				let error;
				try {
					data = await this.processor.run();
				} catch (err) {
					error = err;
				}

				let response = {
					error: error || this.processor.handlerResponse.error,
					data: data || this.processor.handlerResponse.data,
					iid: this.iid
				};
				if (response.error && response.error instanceof Error) {
					response.error = {
						name: response.error.name,
						message: response.error.message,
						stack: response.error.stack
					};
				}

				logger.log(`Done with instance 1 / ${instances} `);
				return response;

			})());


		// Wait for all workers to return and figure out what checkpoint to persist
		logger.debug(`Waiting on all Fanout workers: count ${workers.length} `);
		let responses = await Promise.all(workers);
		return this.hooks.reduce ? this.hooks.reduce(responses) : void 0;
	}

	async workerRun(): Promise<Result> {
		logger.log("Fanout Worker", this.iid);
		this.container.cploc = "instances";


		//let context_getRemainingTimeInMillis = this.context.getRemainingTimeInMillis;
		// // save 3 seconds so the response can get back to the parent with time to process and clean up
		// this.context.getRemainingTimeInMillis = () => {
		// 	return context_getRemainingTimeInMillis.call(context) - (this.hooks.lambdaTimeoutPaddingMillis || (1000 * 3));
		// };

		// wrap callback to send back the response to the parent lambda/process



		let data: Result;
		let error;
		try {
			data = await this.processor.run();
		} catch (err) {
			error = err;
		}
		let response = {
			error: error || this.processor.handlerResponse.error,
			data: data || this.processor.handlerResponse.data,
			iid: this.iid
		};
		if (response.error && response.error instanceof Error) {
			response.error = {
				name: response.error.name,
				message: response.error.message,
				stack: response.error.stack
			};
		}
		this.handlerResponse = this.processor.handlerResponse;
		logger.log("Worker sending data back", this.iid);
		logger.debug("Worker sending back response", this.iid, JSON.stringify(response, null, 2));

		if (process.send) {
			// Send response for child process worker to the master
			process.send(response);
			return;
		} else {
			// Send response for lambda worker to the master
			return response as unknown as Result;
		}
	}

	public async run(): Promise<Result> {
		logger.log("Fanout Start");
		logger.log("Fanout Handler", this.iid);
		logger.debug("Fanout Handler Event", this.iid, JSON.stringify(this.inputEvent, null, 2));

		try {
			if (this.isMaster()) {
				return await this.masterRun();
			} else {
				return await this.workerRun();
			}
		}
		finally {
			logger.log("Fanout End");
		}
	}
}
