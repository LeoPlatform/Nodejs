import { Handler } from "aws-lambda";
import { BotInvocationEvent, RStreamsContext } from "../lib/types";

export declare type BotHandler<T extends BotInvocationEvent, R = unknown> = (event: T, context: RStreamsContext<R>) => Promise<void>;

export declare function CronWrapper<T extends BotInvocationEvent, R>(handler: BotHandler<T, R>): Handler

export default CronWrapper;
