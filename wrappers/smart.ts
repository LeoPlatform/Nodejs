import { APIGatewayEventDefaultAuthorizerContext, APIGatewayEventIdentity, APIGatewayEventRequestContext, APIGatewayEventRequestContextWithAuthorizer, APIGatewayProxyEventHeaders, APIGatewayProxyEventMultiValueHeaders, APIGatewayProxyEventMultiValueQueryStringParameters, APIGatewayProxyEventPathParameters, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyEventStageVariables, Context } from "aws-lambda";
//import { BotData, InstanceData, LeoCron, Milliseconds, ReadFilterGroup, ReportCompleteOptions } from "../lib/cron";
import { BotInvocationEvent, Checkpoint, Checkpoints, Cron, RStreamsContext, RStreamsSdk, throughAsync } from "../index";
import refUtil from "../lib/reference";
//import { promisify } from "util";
import config from "../leoConfigure";
import leoLogger from "leo-logger";
//import moment from "moment";
//import aws, { AWSError } from "aws-sdk";
//import { InvocationResponse } from "aws-sdk/clients/lambda";
import { IProcessor, ProcessorParameters, RStreamsBotHooks } from "./lib/types";
import { FanoutProcessor } from "./lib/fanout-processor";
import { CronProcessor } from "./lib/cron-processor";
import { Processor } from "./lib/processor";
import { APIGatewayProxyEvent, ApiProcessor } from "./lib/api-processor";
import "./lib/process";

export * from "./lib/types";
export * from "./lib/fanout-processor";

const logger = leoLogger("smart.wrapper");

// interface RStreamsProcess extends NodeJS.Process {
// 	__config: unknown;
// 	resources: Record<any, unknown>;
// }

// const rstreamsProcess = process as unknown as RStreamsProcess;

// rstreamsProcess.__config = config;
// rstreamsProcess.env.TZ = config.timezone;
// rstreamsProcess.resources = process.env.Resources && JSON.parse(process.env.Resources) || {};

const botId = config.name;
const settings = config.cron && config.cron.settings || {};

// enum InstanceStatus {
// 	error = "error",
// 	complete = "complete"
// }

// type EventPartitionFn = (event: any) => string | number | string[] | number[];
// type InstancesFn<InvocationEvent> = ((invocationEvent: InvocationEvent, cronData: FanoutEvent) => number);
// type InitializeFn<InvocationEvent> = (invoker: RStreamsBot<InvocationEvent, unknown, unknown>) => Promise<void>;
// type HandlerFn<InvocationEvent, Settings, Result> = (inputEvent: InvocationEvent, context: RStreamsContext<Settings>) => Promise<Result>;
// type ReduceFn<Result> = (responses: FanoutInvokeResponse<Result>[]) => Result;

// export interface RStreamsBotHooks<InvocationEvent, Settings, Result> {
// 	initialize?: InitializeFn<InvocationEvent>;
// 	handler: HandlerFn<InvocationEvent, Settings, Result>;
// 	eventPartition?: EventPartitionFn;
// 	instances?: number | InstancesFn<InvocationEvent>;
// 	maxInstances?: number; // Defaults to 20  todo: should there be a default
// 	invokeType?: "process" | "lambda"; // run as child process or invoke new lamba
// 	reduce?: ReduceFn<Result>
// }


// interface ProcessorParameters<E, T, S> {
// 	inputEvent: E;
// 	context: RStreamsContext<S>;
// 	init: Promise<void>;
// 	fn: (event: E, context: RStreamsContext<S>) => Promise<T>;
// }

// interface IProcessor<T> {
// 	handlerResponse: {
// 		error?: Error,
// 		data?: T
// 	};
// 	run(): Promise<T>;
// }


// class Processor<E, T, S> implements IProcessor<T> {

// 	public handlerResponse: {
// 		error?: Error,
// 		data?: T
// 	} = {};
// 	protected inputEvent: E;
// 	protected context: RStreamsContext;
// 	private init: Promise<void>;
// 	private fn: (event: E, context: RStreamsContext) => Promise<T>;
// 	constructor(
// 		params: ProcessorParameters<E, T, S>
// 	) {
// 		this.inputEvent = params.inputEvent;
// 		this.context = params.context;
// 		this.init = params.init;
// 		this.fn = params.fn;
// 	}

// 	initialize() {
// 		this.setupRegistory();
// 	}

// 	public async run(): Promise<T> {
// 		const startTime = Date.now();
// 		try {
// 			await this.init; // Init requester first to setup any dependencies
// 			this.initialize(); // Init self
// 			this.handlerResponse.data = await this.fn(this.inputEvent, this.context); // Run function
// 			return this.handlerResponse.data;
// 		} catch (err) {
// 			this.handlerResponse.error = err;
// 			throw err;
// 		} finally {
// 			let duration = Date.now() - startTime;
// 			logger.debug(`[PROCESSOR]:duration:${duration}`);
// 		}
// 	}

// 	protected setupRegistory() {
// 		if (!config.registry.id) {
// 			config.registry.id = process.env.AWS_LAMBDA_FUNCTION_NAME;
// 		}
// 	}
// }

// class CronProcessor<E extends BotInvocationEvent, T, S> extends Processor<E, T, S> {
// 	public static HandlesEvent(event: any): boolean {
// 		return event && event.__cron != null;
// 	}

// 	id: string;
// 	cron: Cron;
// 	checkLock: (cron: Cron, runid: string, remainingTime: Milliseconds) => Promise<void>;
// 	reportComplete: (cron: Cron, runid: string, status: string, log: any, opts: ReportCompleteOptions) => Promise<void>;

// 	constructor(
// 		params: ProcessorParameters<E, T, S>
// 	) {
// 		super(params);
// 		this.cron = this.inputEvent.__cron;
// 		console.log("IID:", this.cron.iid);
// 		this.id = `${this.cron.id}:${this.cron.iid}:${this.cron.ts}:${this.context.awsRequestId}`;
// 		this.checkLock = promisify(this.context.sdk.bot.checkLock).bind(this.context.sdk.bot);
// 		this.reportComplete = promisify(this.context.sdk.bot.reportComplete).bind(this.context.sdk.bot);

// 		this.setupUncaughtExceptions();
// 	}

// 	public setupUncaughtExceptions() {
// 		for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
// 			process.removeListener('uncaughtException', x);
// 		}
// 		process.on('uncaughtException', async (err) => {
// 			console.log(`[LEOCRON]:end:${this.id}`);
// 			logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
// 			logger.error(err.stack);
// 			await this.releaseLock(err);
// 		});
// 	}

// 	public async obtainLock() {
// 		try {
// 			console.log("[LEOCRON]:check:" + this.id);
// 			await this.checkLock(this.cron, this.id, this.context.getRemainingTimeInMillis());
// 			console.log("[LEOCRON]:start:" + this.id);
// 		} catch (err) {
// 			if (err.code === "ConditionalCheckFailedException") {
// 				throw new Error("already running");
// 			} else {
// 				throw new Error("failed getting lock");
// 			}
// 		}
// 	}

// 	public async releaseLock(error: any) {
// 		console.log("[LEOCRON]:complete:" + this.id);
// 		await this.reportComplete(this.cron, this.id, error ? InstanceStatus.error : InstanceStatus.complete, error ? error : "", {});
// 	}

// 	override setupRegistory() {

// 		config.registry.__cron = this.cron;
// 		config.registry.id = this.cron.id;
// 	}

// 	public override async run(
// 	): Promise<T> {
// 		await this.obtainLock();
// 		let error: Error;
// 		try {
// 			return await super.run();
// 		} catch (err) {
// 			error = err;
// 		} finally {
// 			await this.releaseLock(error);
// 		}
// 	}
// }

// interface APIGatewayProxyEvent<T, TAuthorizerContext = APIGatewayEventDefaultAuthorizerContext> {
// 	body: T | null;
// 	headers: APIGatewayProxyEventHeaders;
// 	multiValueHeaders: APIGatewayProxyEventMultiValueHeaders;
// 	httpMethod: string;
// 	isBase64Encoded: boolean;
// 	path: string;
// 	pathParameters: APIGatewayProxyEventPathParameters | null;
// 	queryStringParameters: APIGatewayProxyEventQueryStringParameters | null;
// 	multiValueQueryStringParameters: APIGatewayProxyEventMultiValueQueryStringParameters | null;
// 	stageVariables: APIGatewayProxyEventStageVariables | null;
// 	requestContext: APIGatewayEventRequestContextWithAuthorizer<TAuthorizerContext>;
// 	resource: string;
// }

// interface APIGatewayProxyResult<T> {
// 	statusCode: number;
// 	headers?: {
// 		[header: string]: boolean | number | string;
// 	} | undefined;
// 	multiValueHeaders?: {
// 		[header: string]: Array<boolean | number | string>;
// 	} | undefined;
// 	body: string | T;
// 	isBase64Encoded?: boolean | undefined;
// }

// type APIGatewayProxyResultOrData<T> = APIGatewayProxyResult<T> | T;

// class ApiProcessor<E extends Record<any, any>, T, S> extends Processor<APIGatewayProxyEvent<E>, APIGatewayProxyResultOrData<T>, S>{

// 	public static HandlesEvent(event: any): boolean {
// 		return event && event.httpMethod || event.headers;
// 	}

// 	constructor(
// 		params: ProcessorParameters<APIGatewayProxyEvent<E>, T, S>
// 	) {
// 		super(params);
// 		this.setupUncaughtExceptions();
// 	}

// 	public setupUncaughtExceptions() {
// 		for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
// 			process.removeListener('uncaughtException', x);
// 		}
// 		process.on('uncaughtException', (err) => {
// 			console.error((new Date).toUTCString() + ' uncaughtException:', err.message);
// 			console.error(err.stack);
// 			this.context.done(null, {
// 				statusCode: 500,
// 				'Content-Type': 'application/json',
// 				body: JSON.stringify("Application Error")
// 			});
// 		});
// 	}

// 	public override async run(): Promise<APIGatewayProxyResultOrData<T>> {
// 		try {
// 			this.inputEvent = this.transformEvent(this.inputEvent);
// 			let response = await super.run();


// 			if (response && typeof response === "object" && "statusCode" in response) {
// 				let data = response as unknown as APIGatewayProxyResult<T>;
// 				if (config.cors && !("Access-Control-Allow-Origin" in data.headers)) {
// 					data.headers["Access-Control-Allow-Origin"] = config.cors;
// 				}
// 				return data;
// 			} else {
// 				let data = response as T;
// 				return {
// 					statusCode: 200,
// 					headers: {
// 						'Content-Type': config.ContentType || 'application/json',
// 						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
// 					},
// 					body: JSON.stringify(data)
// 				};
// 			}

// 		} catch (err) {
// 			if (err === "Access Denied" || err === "Error: Access Denied") {
// 				return {
// 					statusCode: 403,
// 					headers: {
// 						'Content-Type': config.ErrorContentType || 'text/html',
// 						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
// 					},
// 					body: err.toString()
// 				};
// 			} else {
// 				if (typeof err === "object" && "statusCode" in err) {
// 					if (config.cors && err.headers && !("Access-Control-Allow-Origin" in err.headers)) {
// 						err.headers["Access-Control-Allow-Origin"] = config.cors;
// 					}
// 					return err;
// 				} else {
// 					return {
// 						statusCode: 500,
// 						headers: {
// 							'Content-Type': config.ErrorContentType || 'text/html',
// 							"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
// 						},
// 						body: err.toString()
// 					};
// 				}
// 			}
// 		}
// 	}

// 	transformEvent(inputEvent: unknown): APIGatewayProxyEvent<E> {

// 		let outEvent: APIGatewayProxyEvent<E | string>;

// 		if (this.context.identity) {
// 			// Called Directly not via Api Gateway
// 			let event = inputEvent as APIGatewayProxyEvent<E>;
// 			outEvent = {
// 				body: event.body,
// 				httpMethod: event.httpMethod,
// 				queryStringParameters: event.queryStringParameters,
// 				pathParameters: null,
// 				multiValueHeaders: null,
// 				multiValueQueryStringParameters: null,
// 				isBase64Encoded: false,
// 				path: "",
// 				resource: "",
// 				stageVariables: null,
// 				headers: {
// 					Cookie: event.headers && event.headers.Cookie,
// 				},
// 				requestContext: {
// 					requestId: this.context.awsRequestId,
// 					identity: this.context.identity as APIGatewayEventIdentity
// 				} as APIGatewayEventRequestContext
// 			};

// 		} else {
// 			outEvent = inputEvent as APIGatewayProxyEvent<E>;
// 		}


// 		if (outEvent.isBase64Encoded) {
// 			outEvent.body = Buffer.from(outEvent.body as string, 'base64').toString();
// 		}
// 		if (outEvent.body && typeof outEvent.body !== "object") {
// 			outEvent.body = JSON.parse(outEvent.body);
// 		}
// 		Object.keys(outEvent.pathParameters).map((key) => {
// 			outEvent.pathParameters[key] = decodeURIComponent(outEvent.pathParameters[key]);
// 		});
// 		outEvent.pathParameters = outEvent.pathParameters || {};
// 		outEvent.queryStringParameters = outEvent.queryStringParameters || {};

// 		return outEvent as APIGatewayProxyEvent<E>;
// 	}
// }


// export interface FanoutEvent {
// 	iid?: number;

// 	/** The total number of bot instances */
// 	icount?: number;

// 	/** Starting positions for a given queue */
// 	starteid?: {
// 		[key: string]: Checkpoint | string // not sure which this is yet
// 	},

// 	/** */
// 	read_filter_groups?: ReadFilterGroup[];

// 	ignoreLock?: boolean;


// 	/** List of read/write positions of sources and destinations for this bot */
// 	checkpoints?: Checkpoints;
// 	instances?: Record<string, InstanceData & { __last_activated?: number }>

// 	maxeid: string
// 	cploc: "checkpoints" | "instances"

// }

// interface FanoutInvokeResponse<Result> {
// 	error: any;
// 	data: Result;
// 	iid: number;
// }

// class FanoutProcessor<InvocationEvent, Settings, Result> implements IProcessor<Result>{

// 	static eventIdFormat = "[z/]YYYY/MM/DD/HH/mm/";
// 	static ReadFilterGroupChangeDelayMS: number = 1000 * 60 * 15; // Can only change filter group size every 15 minutes
// 	static ReadFilterGroupChangeMaxEidDistanceMS: number = 1000 * 60 * 15; // Must be within 15 minutes of the last filter group eid

// 	public handlerResponse: { error?: Error; data?: Result; } = {};

// 	reduce: ReduceFn<Result>;
// 	getNeedNeedInstances: InstancesFn<InvocationEvent>;
// 	iid: number;
// 	icount: number;
// 	container: FanoutEvent;

// 	constructor(
// 		private processor: IProcessor<Result>,
// 		private inputEvent: any,
// 		private context: RStreamsContext,
// 		private hooks: RStreamsBotHooks<InvocationEvent, Settings, Result>
// 	) {
// 		this.getNeedNeedInstances = typeof this.hooks.instances === "function" ? this.hooks.instances.bind(this.hooks) : (_) => this.hooks.instances as number || 1;

// 		let { iid, icount, container } = this.getMetadata(inputEvent);

// 		config.registry.rstreamsLeoReadFilterContainer = container;
// 		this.iid = iid;
// 		this.icount = icount;
// 		this.container = container;

// 		// Setup Global RStreamsSdk Filtering
// 		global.rstreamsLeoReadFilterEventPartition = this.hooks.eventPartition ? this.hooks.eventPartition.bind(this.hooks) : (event => event.eid);
// 		global.rstreamsLeoReadFilterData = this.container;
// 	}

// 	getMetadata(inputEvent) {
// 		let iid = 0;
// 		let icount = 1;

// 		let container: FanoutEvent = inputEvent.__cron || inputEvent || {};

// 		if (container && container.iid) {
// 			//container.iid = typeof container.iid === "number" ? container.iid : parseInt(container.iid, 10) || 0;
// 			iid = typeof container.iid === "number" ? container.iid : parseInt(container.iid, 10) || 0;
// 			icount = container.icount;
// 		}

// 		// Correct missing instances from event to __cron 
// 		if (
// 			container != inputEvent &&
// 			container.instances &&
// 			inputEvent.instances &&
// 			Object.keys(container.instances).length != Object.keys(inputEvent.instances).length
// 		) {
// 			container.instances = inputEvent.instances;
// 		}

// 		if (
// 			container != inputEvent &&
// 			container.checkpoints &&
// 			inputEvent.checkpoints &&
// 			Object.keys(container.checkpoints).length != Object.keys(inputEvent.checkpoints).length
// 		) {
// 			container.checkpoints = inputEvent.checkpoints;
// 		}

// 		return { iid, icount, container };
// 	}

// 	static fixInstanceForChildProcess(event: any) {
// 		event.__FANOUT__ = true;
// 		// Get fanout data from process env if running locally
// 		console.log("fixInstanceForChildProcess", process.env.FANOUT_data);
// 		if (process.env.FANOUT_data) {
// 			Object.assign(event, JSON.parse(process.env.FANOUT_data));
// 		}
// 	}

// 	isMaster(): boolean {
// 		return this.iid == 0 || this.icount == null;
// 	}

// 	isWorker(): boolean {
// 		return !this.isMaster();
// 	}

// 	async invokeLambda(iid: number, count: number, newEvent: any): Promise<FanoutInvokeResponse<Result>> {

// 		let data: InvocationResponse;//FanoutInvokeResponse<Result>;
// 		let error;
// 		try {
// 			let lambdaApi = new aws.Lambda({
// 				region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
// 				httpOptions: {
// 					timeout: this.context.getRemainingTimeInMillis() // Default: 120000 // Two minutes
// 				}
// 			});

// 			// todo: Should we invoke a new function or just run a new local process
// 			logger.log("[lambda]", process.env.AWS_LAMBDA_FUNCTION_NAME);
// 			data = await lambdaApi.invoke({
// 				FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
// 				InvocationType: 'RequestResponse',
// 				Payload: JSON.stringify(newEvent),
// 				Qualifier: process.env.AWS_LAMBDA_FUNCTION_VERSION
// 			}).promise();

// 		} catch (err) {
// 			error = err;
// 		}


// 		logger.log(`Done with Lambda instance ${iid + 1}/${count}`);
// 		logger.log("[lambda err]", error);
// 		logger.log("[lambda data]", data);

// 		let response: FanoutInvokeResponse<Result>;
// 		if (error) {
// 			throw error;
// 		} else if (data.FunctionError) {
// 			throw data.Payload;
// 		} else if (data.Payload != undefined && data.Payload != 'null') {
// 			response = JSON.parse(data.Payload as string);
// 		} else {
// 			response = data as any;
// 		}

// 		logger.debug("[lambda invoked invocation/payload]", data, JSON.stringify(newEvent, null, 2));
// 		return response;
// 	}

// 	async invokeProcess(iid: number, count: number, newEvent: any): Promise<FanoutInvokeResponse<Result>> {
// 		// Fork process with event
// 		let worker = require("child_process").fork(process.argv[1], process.argv.slice(2), {
// 			cwd: process.cwd(),
// 			env: Object.assign({}, process.env, {
// 				FANOUT_data: JSON.stringify(newEvent),
// 				runner_keep_cmd: true
// 			}),
// 			execArgv: process.execArgv
// 		});

// 		// setup communication between processes
// 		let responseData: FanoutInvokeResponse<Result>;
// 		worker.once("message", (response: FanoutInvokeResponse<Result>) => {
// 			logger.log(`Got Response with instance ${iid + 1}/${count}`);
// 			responseData = response;
// 		});

// 		return new Promise(resolve => {
// 			worker.once("exit", () => {
// 				logger.log(`Done with child instance ${iid + 1}/${count}`);
// 				logger.log("[responseData]", responseData);
// 				resolve(responseData);
// 			});
// 		});
// 	}

// 	async invokeSelf(event: any, iid: number, count: number): Promise<FanoutInvokeResponse<Result>> {
// 		logger.log(`Invoking ${iid + 1}/${count}`);

// 		// Deep copy the invocation event and set instances variables
// 		let newEvent = JSON.parse(JSON.stringify(event));
// 		let { container } = this.getMetadata(newEvent);
// 		container.iid = iid;
// 		container.icount = count;
// 		container.ignoreLock = true;
// 		// delete (container as any).force;

// 		// Add starting points for all queues.
// 		// leo-sdk will look to this before the default checkpoints.read[queue]
// 		let myInstance = (event.instances || {})[iid] || {};
// 		container.starteid = Object.keys(myInstance).reduce((all, key) => {
// 			if (key.match(/^queue:/) && myInstance[key] && myInstance[key].checkpoint) {
// 				all[key] = myInstance[key].checkpoint;
// 			}
// 			return all;
// 		}, {});

// 		// If running in lamba
// 		if (process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.IS_LOCAL && this.hooks.invokeType !== "process") {
// 			return await this.invokeLambda(iid, count, newEvent);
// 		}
// 		// If running local or child process
// 		else {
// 			return await this.invokeProcess(iid, count, newEvent);
// 		}
// 	}

// 	async masterRun(): Promise<Result> {
// 		// This is the master, start the needed workers
// 		let timestamp = moment.utc();
// 		this.container.maxeid = this.container.maxeid || this.inputEvent.maxeid || timestamp.format(FanoutProcessor.eventIdFormat) + timestamp.valueOf();
// 		this.container.iid = 0;
// 		logger.log("Fanout Master", this.container.iid);


// 		let readFilterGroups: ReadFilterGroup[] = this.inputEvent.read_filter_groups || [];
// 		// Get Bot data if not provided
// 		if (
// 			!this.container.instances ||
// 			!this.container.checkpoints
// 		) {
// 			let bot: BotData = await new Promise((resolve, reject) =>
// 				this.context.sdk.aws.dynamodb.get<BotData>(
// 					this.context.sdk.configuration.resources.LeoCron,
// 					this.inputEvent.botId,
// 					{},
// 					(err, data) => err ? reject(err) : resolve(data)));

// 			this.container.instances = (bot || {}).instances || {};
// 			this.container.checkpoints = (bot || {}).checkpoints || { read: {}, write: {} };
// 			this.inputEvent.requested_kinesis = (bot || {}).requested_kinesis || {};
// 			readFilterGroups = (bot || {}).read_filter_groups || [];
// 			if (bot == null) {
// 				await this.context.sdk.bot.createBot(this.inputEvent.botId, {});
// 			}
// 		}

// 		// Find number of requested instances
// 		let instances = Math.ceil(this.getNeedNeedInstances(this.inputEvent, this.container));
// 		instances = Math.max(1, Math.min(instances, this.hooks.maxInstances || 20));

// 		// Add any entries that don't exist
// 		let command = {
// 			TableName: this.context.sdk.configuration.resources.LeoCron,
// 			Key: {
// 				id: this.inputEvent.botId
// 			},
// 			UpdateExpression: undefined,
// 			ExpressionAttributeNames: {},
// 			ExpressionAttributeValues: {}
// 		};
// 		let toAdd = [];

// 		// Filter out any dead groups
// 		let minEid: string = null;
// 		let maxEid: string = "z/";
// 		let activeInstancesFromFilterGroups = new Set();
// 		let maxInstancesFromGroupsPreFilter = readFilterGroups.reduce((a, b) => Math.max(a, b.icount), instances);
// 		for (let i = 0; i < maxInstancesFromGroupsPreFilter; i++) {
// 			activeInstancesFromFilterGroups.add(i.toString());
// 		}
// 		Object.entries(this.container.instances)
// 			.filter(([key]) => activeInstancesFromFilterGroups.has(key))
// 			.map(([_key, value]) => value)
// 			.concat(this.container.checkpoints.read).forEach(inst => {
// 				Object.entries(inst).forEach(([key, cp]) => {
// 					if (key.match(/^queue:/) && cp?.checkpoint) {
// 						minEid = (minEid && minEid.localeCompare(cp.checkpoint) <= 0) ? minEid : cp.checkpoint;
// 						maxEid = (maxEid && maxEid.localeCompare(cp.checkpoint) >= 0) ? maxEid : cp.checkpoint;
// 					}
// 				});
// 			});

// 		// Only filter if we have a minEid and there are more than 1 group
// 		// Otherwise it just removed and adds the group
// 		if (minEid && readFilterGroups.length > 1) {
// 			readFilterGroups = readFilterGroups.filter(g => g.eid >= minEid);
// 		}
// 		let latest: ReadFilterGroup = readFilterGroups[readFilterGroups.length - 1];
// 		if (
// 			latest == null ||
// 			(
// 				latest.icount != instances && // Have a different icount
// 				// latest.eid < maxEid &&
// 				(Date.now() - latest.ts) >= FanoutProcessor.ReadFilterGroupChangeDelayMS && // outside the change delay window
// 				true // (Date.now() - this.context.sdk.streams.eventIdToTimestamp(latest.eid)) <= FanoutProcessor.ReadFilterGroupChangeMaxEidDistanceMS // last group eid is close
// 			)
// 		) {
// 			readFilterGroups.push({
// 				icount: instances,
// 				eid: maxEid, //this.container.maxeid,
// 				ts: Date.now()
// 			});
// 			toAdd.push(`#rfg = :rfg`);
// 			command.ExpressionAttributeNames["#rfg"] = "read_filter_groups";
// 			command.ExpressionAttributeValues[":rfg"] = readFilterGroups;
// 		} else {
// 			// Ignore the new count because they aren't allowed to change yet
// 			// instances = latest.icount;
// 		}

// 		this.container.icount = instances;
// 		this.container.read_filter_groups = readFilterGroups;

// 		let maxInstancesFromGroups = readFilterGroups.reduce((a, b) => Math.max(a, b.icount), instances);

// 		// Add the starting point for the instances to be the new max eid
// 		let startingCheckpoints = Object.keys((this.container.checkpoints || {}).read || {}).reduce((out, queue) => {
// 			if (queue.match(/^queue:/)) {
// 				out[queue] = {
// 					checkpoint: maxEid
// 				};
// 			}
// 			return out;
// 		}, {});

// 		for (let i = 0; i < maxInstancesFromGroups; i++) {
// 			// Instance doesn't exist yet
// 			if (!this.container.instances[i]) {
// 				// Add checkpoint location in the DB for this instance id
// 				this.container.instances[i] = startingCheckpoints;

// 				toAdd.push(`#instances.#i${i} = :i${i}`);
// 				command.ExpressionAttributeNames[`#i${i}`] = `${i}`;
// 				command.ExpressionAttributeValues[`:i${i}`] = this.container.instances[i];
// 				command.ExpressionAttributeNames["#instances"] = "instances";
// 				this.container.instances[i].__last_activated = Date.now();
// 			} else if (i != 0) {
// 				let changed = false;
// 				this.container.instances[i] = {
// 					...startingCheckpoints,
// 					...this.container.instances[i]
// 				};

// 				// Reset the starting point for the instances to be the new max eid
// 				Object.entries(this.container.instances[i]).forEach(([queue, cp]: [string, Checkpoint]) => {
// 					if (queue.match(/^queue:/) && cp && cp.checkpoint && cp.checkpoint < minEid) {
// 						changed = true;
// 						this.container.instances[i][queue] = {
// 							checkpoint: maxEid
// 						};
// 					}
// 				});

// 				// Only update if we needed to update position
// 				if (changed) {
// 					toAdd.push(`#instances.#i${i} = :i${i}`);
// 					command.ExpressionAttributeNames[`#i${i}`] = `${i}`;
// 					command.ExpressionAttributeValues[`:i${i}`] = this.container.instances[i];
// 					this.container.instances[i].__last_activated = Date.now();
// 					command.ExpressionAttributeNames["#instances"] = "instances";
// 				}
// 			}
// 		}

// 		// Update the cron table with the needed instances
// 		if (toAdd.length > 0) {
// 			command.UpdateExpression = `set ${toAdd.join(",")}`;
// 			logger.log("Updating Worker instances data", JSON.stringify(command, null, 2));
// 			await this.context.sdk.aws.dynamodb.docClient.update(command).promise();
// 		}

// 		let workers: Promise<FanoutInvokeResponse<Result>>[] = [];

// 		// Start the other workers
// 		for (let i = 1; i < maxInstancesFromGroups; i++) {
// 			workers.push(this.invokeSelf(this.inputEvent, i, instances));
// 		}

// 		// Setup Master Worker
// 		workers.unshift(
// 			(async () => {
// 				logger.log(`Invoking 1/${instances}`);

// 				// Handle promise or callback response
// 				let data: Result;
// 				let error;
// 				try {
// 					data = await this.processor.run();
// 				} catch (err) {
// 					error = err;
// 				}

// 				let response = {
// 					error: error || this.processor.handlerResponse.error,
// 					data: data || this.processor.handlerResponse.data,
// 					iid: this.iid
// 				};
// 				if (response.error && response.error instanceof Error) {
// 					response.error = {
// 						name: response.error.name,
// 						message: response.error.message,
// 						stack: response.error.stack
// 					};
// 				}

// 				logger.log(`Done with instance 1 / ${instances} `);
// 				return response;

// 			})());


// 		// Wait for all workers to return and figure out what checkpoint to persist
// 		logger.debug(`Waiting on all Fanout workers: count ${workers.length} `);
// 		let responses = await Promise.all(workers);
// 		return this.hooks.reduce ? this.hooks.reduce(responses) : void 0;
// 	}

// 	async workerRun(): Promise<Result> {
// 		logger.log("Fanout Worker", this.iid);
// 		this.container.cploc = "instances";


// 		//let context_getRemainingTimeInMillis = this.context.getRemainingTimeInMillis;
// 		// // save 3 seconds so the response can get back to the parent with time to process and clean up
// 		// this.context.getRemainingTimeInMillis = () => {
// 		// 	return context_getRemainingTimeInMillis.call(context) - (this.hooks.lambdaTimeoutPaddingMillis || (1000 * 3));
// 		// };

// 		// wrap callback to send back the response to the parent lambda/process



// 		let data: Result;
// 		let error;
// 		try {
// 			data = await this.processor.run();
// 		} catch (err) {
// 			error = err;
// 		}
// 		let response = {
// 			error: error || this.processor.handlerResponse.error,
// 			data: data || this.processor.handlerResponse.data,
// 			iid: this.iid
// 		};
// 		if (response.error && response.error instanceof Error) {
// 			response.error = {
// 				name: response.error.name,
// 				message: response.error.message,
// 				stack: response.error.stack
// 			};
// 		}
// 		this.handlerResponse = this.processor.handlerResponse;
// 		logger.log("Worker sending data back", this.iid);
// 		logger.debug("Worker sending back response", this.iid, JSON.stringify(response, null, 2));

// 		if (process.send) {
// 			// Send response for child process worker to the master
// 			process.send(response);
// 			return;
// 		} else {
// 			// Send response for lambda worker to the master
// 			return response as unknown as Result;
// 		}
// 	}

// 	public async run(): Promise<Result> {
// 		logger.log("Fanout Start");
// 		logger.log("Fanout Handler", this.iid);
// 		logger.debug("Fanout Handler Event", this.iid, JSON.stringify(this.inputEvent, null, 2));

// 		try {
// 			if (this.isMaster()) {
// 				return await this.masterRun();
// 			} else {
// 				return await this.workerRun();
// 			}
// 		}
// 		finally {
// 			logger.log("Fanout End");
// 		}
// 	}
// }

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
