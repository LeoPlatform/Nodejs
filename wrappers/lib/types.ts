import { RStreamsContext } from "../../index";
import { RStreamsBot } from "../smart";
import { FanoutEvent, FanoutInvokeResponse } from "./fanout-processor";


export type EventPartitionFn = (event: any) => string | number | string[] | number[];
export type InstancesFn<InvocationEvent> = ((invocationEvent: InvocationEvent, cronData: FanoutEvent) => number);
export type InitializeFn<InvocationEvent> = (invoker: RStreamsBot<InvocationEvent, unknown, unknown>) => Promise<void>;
export type HandlerFn<InvocationEvent, Settings, Result> = (inputEvent: InvocationEvent, context: RStreamsContext<Settings>) => Promise<Result>;
export type ReduceFn<Result> = (responses: FanoutInvokeResponse<Result>[]) => Result;

export interface RStreamsBotHooks<InvocationEvent, Settings, Result> {
	initialize?: InitializeFn<InvocationEvent>;
	handler: HandlerFn<InvocationEvent, Settings, Result>;
	eventPartition?: EventPartitionFn;
	instances?: number | InstancesFn<InvocationEvent>;
	maxInstances?: number; // Defaults to 20  todo: should there be a default
	invokeType?: "process" | "lambda"; // run as child process or invoke new lamba
	reduce?: ReduceFn<Result>
}

export interface ProcessorParameters<E, T, S> {
	inputEvent: E;
	context: RStreamsContext<S>;
	init: Promise<void>;
	fn: (event: E, context: RStreamsContext<S>) => Promise<T>;
}

export interface IProcessor<T> {
	handlerResponse: {
		error?: Error,
		data?: T
	};
	run(): Promise<T>;
}

export enum InstanceStatus {
	error = "error",
	complete = "complete"
}
