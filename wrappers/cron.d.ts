import { Callback, Handler } from "aws-lambda";
import { BotInvocationEvent, RStreamsContext } from "../lib/types";

export declare type BotHandler<T extends BotInvocationEvent, R = unknown, C = unknown> = (event: T, context: RStreamsContext<R>) => Promise<C>;


/** @deprecated Don't use. */
export declare type LegacyBotHandler<T extends BotInvocationEvent, R = unknown, C = unknown> = (event: T, context: RStreamsContext<R>, callback: Callback<C>) => void | Promise<C>;

export declare function CronWrapper<T extends BotInvocationEvent, R, C>(handler: BotHandler<T, R> | LegacyBotHandler<T, R>): Handler<T, C>

export default CronWrapper;
