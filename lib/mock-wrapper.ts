import { StreamUtil } from "./lib";
import { ReadEvent, Event, ReadOptions, ReadableStream, WritableStream, TransformStream, WriteOptions, BaseWriteOptions, ReadableQueueStream } from "./types";
import fs from "fs";
import path from "path";
import util from "./aws-util";
import stream from "stream";
import { Callback, CronData, Milliseconds, ReportCompleteOptions } from "./cron";
//import uuid from "uuid";
import refUtil from "./reference";
import * as parserUtil from "./stream/helper/parser-util";

declare var __webpack_require__;
declare var __non_webpack_require__;
const requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

type AWSError = any;
declare type LeoStream = typeof StreamUtil;
export default function (leoStream: LeoStream) {
	if (process.env.RSTREAMS_MOCK_DATA == null || (leoStream as any).mocked) {
		return;
	}
	let registry = process as any;
	registry.rstreamsMock = registry.rstreamsMock || { queues: new Set() };
	(leoStream as any).mocked = true;
	let settings = {
		queueDirectory: path.resolve(process.env.RSTREAMS_MOCK_DATA, "queue"),
		s3Directory: path.resolve(process.env.RSTREAMS_MOCK_DATA, "s3"),
		batchId: "output-data"//uuid.v4()
	};

	let fromLeo = leoStream.fromLeo.bind(leoStream);
	leoStream.fromLeo = <T>(id: string, queue: string, config: ReadOptions<T>): ReadableQueueStream<T> => {
		queue = refUtil.ref(queue).id;
		// Look for events that were written to this queue in this process
		let runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] || "";

		// Allow for a queue to to the actual data
		if (runtimeQueue === "passthrough") {
			return fromLeo(id, queue, config);
		}
		let queueDataFileJsonl = path.resolve(settings.queueDirectory, runtimeQueue, `${queue}.jsonl`);
		let queueDataFileJson = path.resolve(settings.queueDirectory, runtimeQueue, `${queue}.json`);
		let mockStream;

		let JSONparse = parserUtil.createParser({
			parser: config?.parser,
			opts: {
				...config?.parserOpts
			}
		});

		if (fs.existsSync(queueDataFileJsonl)) {
			mockStream = leoStream.pipeline(
				fs.createReadStream(queueDataFileJsonl),
				leoStream.split((value) => JSONparse(value))
			);
		} else if (fs.existsSync(queueDataFileJson)) {
			mockStream = leoStream.pipeline(
				// They may be using a custom parser so we need to convert the json to a string and use the parser
				leoStream.eventstream.readArray(requireFn(queueDataFileJson).map(l => JSON.stringify(l) + "\n")),
				leoStream.split((value) => JSONparse(value))
			);
		} else {
			mockStream = leoStream.eventstream.readArray([]);
		}

		mockStream.checkpoint = (callback) => callback();
		return mockStream;
	};

	let oldLoad = leoStream.load.bind(leoStream);
	leoStream.load = <T>(id: string, queue: string, opts?: BaseWriteOptions): TransformStream<Event<T>, unknown> => {
		if (opts && opts.useS3) {
			delete opts.useS3;
		}
		return oldLoad(id, queue, opts);
	};
	leoStream.toLeo = <T>(botId: string, config?: BaseWriteOptions): TransformStream<Event<T>, unknown> => {
		let records = 0;
		let timestamp = Date.now();
		let fileStreams = {};
		let mockStream = leoStream.through<Event<T>, unknown>((writeData: Event<T>, callback) => {
			// No queue.  Just a command event so we can skip it
			if (!writeData || !writeData.event) {
				return callback();
			}

			let queue = refUtil.ref(writeData.event).id;
			// Mark queue to have in memory data from this batch
			process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] = settings.batchId;
			registry.rstreamsMock.queues.add(queue);

			// Add an eid 
			let data: ReadEvent<T> = writeData as ReadEvent<T>;
			data.eid = leoStream.eventIdFromTimestamp(timestamp, "full", records);
			records++;
			if (!fileStreams[queue]) {
				let queueDataFileJsonl = path.resolve(settings.queueDirectory, settings.batchId, `${queue}.jsonl`);
				createPath(path.dirname(queueDataFileJsonl));
				fileStreams[queue] = leoStream.pipeline(leoStream.stringify(), fs.createWriteStream(queueDataFileJsonl) as unknown as TransformStream<string, unknown>);
			}
			if (!fileStreams[queue].write(data)) {
				fileStreams[queue].once("drain", () => callback());
			} else {
				callback();
			}
		}, (done) => {
			let count = Object.keys(fileStreams).length;
			if (count === 0) {
				done();
				return;
			}
			let called = false;
			let cb = (err) => {
				count--;
				if (!called && (count === 0 || err)) {
					called = true;
					done(err);
				}
			};

			Object.values(fileStreams).forEach((s: stream.Writable) => {
				s.end(cb);
			});
		});

		return mockStream;
	};

	let fromS3 = leoStream.fromS3.bind(leoStream);
	leoStream.fromS3 = (file: {
		bucket: string,
		key: string;
		range?: string;
	}): stream.Readable => {
		let runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${file.key.split("/")[1] ?? ""}`] || "";

		// Allow for a queue to to the actual data
		if (runtimeQueue === "passthrough") {
			return fromS3(file);
		}

		let Bucket = path.resolve(settings.s3Directory, file.bucket);
		let Key = file.key;
		// let Range = file.range || undefined;

		let filepath = path.resolve(Bucket, Key);
		if (!fs.existsSync(filepath)) {
			throw util.error(new Error(), {
				message: 'The specified key does not exist.',
				code: 'NoSuchKey'
			});
		}
		return fs.createReadStream(filepath);
	};

	leoStream.toS3 = (Bucket: string, File: string) => {
		let filepath = path.resolve(settings.s3Directory, `${Bucket}/${File}`);
		createPath(path.dirname(filepath));
		return fs.createWriteStream(filepath);
	};


	leoStream.cron.checkLock = (cron: CronData, runid: string, remainingTime: number, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.reportComplete = (cron: CronData, runid: string, status: string, log: any, opts: ReportCompleteOptions, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.createLock = (id: string, runid: string, maxDuration: Milliseconds, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.removeLock = (id: string, runid: string, callback: Callback<AWSError>) => callback(null);

	leoStream.toCheckpoint = () => leoStream.devnull();
}

function createPath(dir: string) {
	if (!fs.existsSync(dir)) {
		let parent = path.dirname(dir);
		if (parent) {
			createPath(parent);
		}
		fs.mkdirSync(dir);
	}
}
