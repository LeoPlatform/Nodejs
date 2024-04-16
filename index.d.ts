
import Pumpify from "pumpify";
import stream from "stream";
import { Callback, EnrichOptions, EnrichBatchOptions, OffloadOptions, OffloadBatchOptions, ReadOptions, StreamUtil, ToCheckpointOptions, WriteOptions } from "./lib/lib";
import { LeoCron } from "./lib/cron";
import { LeoDynamodb } from "./lib/dynamodb";
import { AwsCredentialIdentity, Provider } from "@smithy/types";
import { Event } from "./lib/types";
import ConfigurationProvider from "./lib/rstreams-configuration";
import { ReadableStream } from "./lib/types";
import { S3, S3ClientConfig } from "@aws-sdk/client-s3";
import { Kinesis, KinesisClientConfig } from "@aws-sdk/client-kinesis";
import { Firehose, FirehoseClientConfig } from "@aws-sdk/client-firehose";
import { CloudFormation } from "@aws-sdk/client-cloudformation";
import { DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandlerOptions } from "@aws-sdk/node-http-handler";
import https from "https";
export * from "./lib/types";

/**
 * The SDK needs these to communicate with an instance of the RStreams Bus.
 * These AWS resources were created as part of the RStreams Bus instance that you mean to access.  
 *
 * You will only rarely have to set these or even know about these yourself.
 * 
 * @see [[`ConfigProviderChain`]]
 */
export interface ConfigurationResources {
	/** The AWS region, e.g. us-east-1. */
	Region: string;

	/** The DynamoDB table name or ARN that stores the definition and state of all queues in the RStreams Bus instance. */
	LeoEvent: string;

	/** The DynamoDB table name or ARN that stores the actual events that flow through all queues in the RStreams Bus instance. */
	LeoStream: string;

	/** The DynamoDB table name or ARN that stores the definition and state of all bots in the RStreams Bus instance. */
	LeoCron: string;

	/** The S3 bucket name or ARN the RStreams Bus instance uses when reading/writing events to S3. */
	LeoS3: string;

	/** The name of the Kinesis stream or ARN the RStreams Bus instance uses to push events into a queue. */
	LeoKinesisStream: string;

	/** The name of the Firehose stream or ARN the RStreams Bus instance uses to push events into a queue. */
	LeoFirehoseStream: string;

	/** The DynamoDB table name or ARN that the RStreams Bus instance uses as a generic key/value store. */
	LeoSettings: string;
}

/**
 * An internal representation of the actual configuration used.  Developers should not have to set
 * anything in this config.  There are rare occasions when a developer may elect to set the AWS credentials
 * here manually, though the AWS SDK has much better means of discovering credentials in most cases.
 */
export interface Configuration {
	/** Stores the AWS region of the RStreams instance. */
	aws: { region: string },

	/** @deprecated Don't use. */
	_meta: { region: string },

	/** The resources used to communicate with the AWS resources that comprise the RStreams Bus instance. */
	resources: ConfigurationResources,

	/** Stores the AWS region of the RStreams instance. */
	region: string,

	/** @internal Allows different components of the SDK to internally share information. */
	registry: any;

	/** The AWS credentials to use. In most cases AWS will discover these.  Set if using STS or other scenarios where want to manually set them. */
	credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>

	// TODO: These exist but do we need to expose them
	//onUpdate: [Function: onUpdate],
	//update: [Function: update],
	//validate: [Function: validate],
	//setProfile: [Function: setProfile],
	//bus: {
	//	s3: 'leos3',
	//	firehose: 'LeoFirehoseStream'
	//},
	//firehose: 'LeoFirehoseStream',
	//kinesis: 'LeoKinesisStream',
	//s3: 'leos3',
	//stream: 'LeoKinesisStream',
}

/**
 * The main entry point for the RStreams Node SDK.  It exposes commonly used functionality
 * in the SDK.  Many of these functions come from [[`StreamUtil`]] which also includes
 * more advanced capabilities. 
 */
export declare class RStreamsSdk {
	constructor(config?: ConfigurationResources | typeof ConfigurationProvider, awsResourceConfig?: AwsResourceConfig);
	constructor(awsResourceConfig?: AwsResourceConfig);
	/** 
	 * Config used to communicate with AWS resources that comprise the RStreams Bus used by the SDK.
	 * It is included here for information purposes and so you can access the AWS resources that 
	 * the SDK discovered and is using.
	 *
	 * @see [[`ConfigProviderChain`]]  
	 */
	configuration: Configuration;

	/** 
	 * @return Rstreams Used to get the leo stream to do more advanced processing of the streams.
	 * @todo question do we still need this? can/should we put all useful things in this interface?
	 */
	streams: typeof StreamUtil;

	/** @method */
	load: typeof StreamUtil.load;
	/** @method */
	offload: typeof StreamUtil.offload;
	/** @method */
	enrich: typeof StreamUtil.enrich;
	/** @method */
	read: typeof StreamUtil.fromLeo;
	/** 
	 * @internal
	 * @method 
	 */
	write: typeof StreamUtil.toLeo;
	/** 
	 * @internal
	 * @method
	 */
	checkpoint: typeof StreamUtil.toCheckpoint;

	/**
	 * This is an async/await friendly version of the [[`RStreamsSdk.enrich`]] function.
	 * 
	 * It reads events from one queue and writes them to another queue.  Put another way,
	 * an enrich operation reads events from a source `inQueue` and then writes them to a destination `outQueue`,
	 * allowing for side effects or transformation in the process.
	 * 
	 * The [[`EnrichOptions.transform`]] function
	 * is called when events are retrieved from the source queue so you can transform them and send them to the 
	 * destination queue by calling the callback in the transform function.  The callback here as the second argument
	 * of this function is meant to be called when all enriching is done on all events (right before it closes down the stream),
	 * allowing you to do clean up like closing a DB connection or something. 
	 * 
	 * @typeParam T The type of the event read from the source queue
	 * @typeParam U The type of the event that will be written to the destination queue
	 * @param opts The details of how to enrich and the function that does the work to enrich, either the batched or not batched version.
	 *			 The batched version will batch up requests to your transform function and pass it an array instead of a single object.
	 * @method
	 * @see [[`RStreamsSdk.enrich`]]
	 * @todo example
	 * @todo unclear The opts.transform function doesn't appear to be promise based?
	 * @todo incomplete the docs above were partly copied from the callback version and once the unclear above is clear needs correcting.
	 */
	enrichEvents: <T, U>(opts: EnrichOptions<T, U> | EnrichBatchOptions<T, U>) => Promise<void>;

	/**
	 * This is an async/await friendly version of [[`RStreamsSdk.offload`]].
	 * 
	 * It reads events from a queue to do general processing (such as write to an external DB).  It's called
	 * offload because it is commonly used to process events and offload them to external resources
	 * such as ElasticSearch or other databases that are off of the RStreams Bus.
	 * 
	 * @param opts What queue to read from, the transform function and other options.
		 *						 The batched version will batch up requests to your transform function and pass it an array instead of a single object.
	 * @see [[`RStreamsSdk.offload`]]
	 * @method
	 * @todo example
	 */
	offloadEvents: <T>(config: OffloadOptions<T> | OffloadBatchOptions<T>) => Promise<void>;

	/**
	 * This is a callback-based version of the [[`RStreamsSdk.putEvent`]] function and should no longer be used.
	 * Callback-based API flavors will be phased out over time.
	 * 
	 * A callback-based function to write a single event to an RStreams queue.  There are occasions where
	 * this is useful, perhaps inside a pipeline step.
	 *
	 * @typeParam T The data to write as the payload of the event
	 * @param bot_id The name of the bot to write the event as
	 * @param outQueue The name of the queue to write to
	 * @param payload The data to write to the queue
	 * @param callback The function to call when done
	 * @deprecated Please use [[`RStreamsSdk.putEvent`]]
	 * @method
	 * @todo inconsistent bot_id
	 * @todo question offload and enrich are just pass throughs to StreamUtil.offload/enrich. Why isn't this one also?  Why is it actually defined here?
	 * @todo example
	 */
	put: <T>(bot_id: string, outQueue: string, payload: Event<T> | T, callback: Callback) => void;

	/**
	 * An async/await friendly function to write a single event to a queue.  There are occasions where
	 * this is useful, perhaps inside a pipeline step.
	 *
	 * @typeParam T The data to write as the payload of the event
	 * @param bot_id The name of the bot to write the event as
	 * @param outQueue The name of the queue to write to
	 * @param payload The payload of the event to write
	 * @method
	 * @todo inconsistent bot_id
	 * @todo example
	 */
	putEvent: <T>(bot_id: string, outQueue: string, payload: Event<T> | T) => Promise<void>;


	/**
	 * An async/await friendly function to write an array of events to a queue.
	 *
	 * @typeParam T The data to write as the payload of the event
	 * @param payloads The payloads of the events to write
	 * @param settings The botId and queue to use if payloas is a T[] instead of Event<T>[], and writeOptions for sdk.load()
	 * @method
	 * @todo example
	 */
	putEvents: <T>(payloads: (Event<T> | T)[], settings?: { botId?: string, queue?: string, writeOptions?: WriteOptions }) => Promise<void>;


	/** @method */
	throughAsync: typeof StreamUtil.throughAsync;


	/** A library allowing one to manually create, update, checkpoint or retrieve information on a bot. */
	bot: LeoCron;
	aws: {
		/** Helpful methods for interacting with RStreams' DynamoDB tables. */
		dynamodb: LeoDynamodb,

		/** A refernce to the AWS S3 library. */
		s3: S3,

		/** A refernce to the AWS Kinesis library. */
		kinesis: Kinesis

		/** A refernce to the AWS Firehose library. */
		firehose: Firehose

		/** A refernce to the AWS CloudFormation library. */
		cloudformation: CloudFormation
	};

	/**
	 * @deprecated This is a legacy feature that is no longer used that remains for backward compatibility.
	 * @method
	 */
	destroy: (callback: (err: any) => void) => void;


	/**
	 * A stream generated from a function that returns and array of data of type T
	 * 
	 * Allows for custom state to be kept and passed to the function generating new data
	 * 
	 * @typeParam T The data emitted from the stream
	 * @typeParam R The current state of the source stream
	 * @param fn Function that produces records to flow down stream
	 * @param opts Options to limit how may records to produce or how long to produce them
	 * @param state The current custom state of the source stream
	 * @returns A Stream of data type T
	 * @method
	 */
	createSource: <T, R = any>(fn: CreateSourceFunction<T, R>, opt?: CreateSourceOptions, state?: R) => ReadableStream<T>;
}

/**
 * Async function that you write that takes the current state R and returns an array of data tpye T
 */
export declare type CreateSourceFunction<T, R> = (state: R) => Promise<T[] | undefined>;

/**
 * Options for the function [[`RStreamsSdk.createSource`]]
 */
export interface CreateSourceOptions {
	/** max number or records to emit before ending the stream */
	records?: number;

	/** max number of milliseconds to wait before closing the stream */
	milliseconds?: number;
}



interface ServiceConfigDeprecations {
	/**
	  * @deprecated use requestHandler
	  */
	httpOptions?: NodeHttpHandlerOptionsDeprecations

	/**
	  * @deprecated use maxAttempts.  value should be maxRetries + 1
	  */
	maxRetries?: number;
}

interface NodeHttpHandlerOptionsDeprecations extends NodeHttpHandlerOptions {
	/**
	  * @deprecated use requestTimeout
	  */
	timeout?: number;

	/**
	  * @deprecated use connectionTimeout
	  */
	connectTimeout?: number;
	/**
		  * @deprecated use httpsAgent
		  */
	agent?: https.Agent
}

export interface AwsResourceConfig {
	s3Config?: S3ClientConfig & ServiceConfigDeprecations,
	dynamodbConfig?: DynamoDBClientConfig & ServiceConfigDeprecations
	firehoseConfig?: FirehoseClientConfig & ServiceConfigDeprecations,
	kinesisConfig?: KinesisClientConfig & ServiceConfigDeprecations
}

/**
 * This returns a function that you call to create an instance of the RStreams SDK.
 * @param config The SDK is usually smart enough to find the config it needs or you can pass it in directly here.
 * @returns The SDK instance itself.
 */
declare function ExportTypeFn(config?: ConfigurationResources | typeof ConfigurationProvider, awsConfig?: AwsResourceConfig): RStreamsSdk;
export default ExportTypeFn;

