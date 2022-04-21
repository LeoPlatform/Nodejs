import { StreamUtil } from "./lib";
import { ReadEvent, Event, ReadOptions, ReadableStream, TransformStream, StatsStream } from "./types";
import fs from "fs";
import path from "path";
import util from "./aws-util";
import stream from "stream";
import { Callback, CronData, Milliseconds, ReportCompleteOptions } from "./cron";
import { AWSError } from "aws-sdk";

import refUtil from "./reference";

const requireFn = module.require;

declare type LeoStream = typeof StreamUtil;
declare type LeoStreamMocked = LeoStream & { mocked: boolean }
declare interface Registry {
	rstreamsMock: {
		queues: Set<string>
	}
}

function createPath(dir: string) {
	if (!fs.existsSync(dir)) {
		const parent = path.dirname(dir);
		if (parent) {
			createPath(parent);
		}
		fs.mkdirSync(dir);
	}
}

export default function (leoStream: LeoStream) {
	if (process.env.RSTREAMS_MOCK_DATA == null || (leoStream as LeoStreamMocked).mocked) {
		return;
	}
	const registry = process as unknown as Registry;
	registry.rstreamsMock = registry.rstreamsMock || { queues: new Set() };
	(leoStream as LeoStreamMocked).mocked = true;
	const settings = {
		queueDirectory: path.resolve(process.env.RSTREAMS_MOCK_DATA, "queue"),
		s3Directory: path.resolve(process.env.RSTREAMS_MOCK_DATA, "s3"),
		batchId: "output-data" // uuid.v4()
	};

	const fromLeo = leoStream.fromLeo.bind(leoStream);
	leoStream.fromLeo = <T>(id: string, queue: string, config: ReadOptions): ReadableStream<ReadEvent<T>> & StatsStream => {
		queue = refUtil.ref(queue).id;
		// Look for events that were written to this queue in this process
		const runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] || "";

		// Allow for a queue to to the actual data
		if (runtimeQueue === "passthrough") {
			return fromLeo(id, queue, config);
		}
		const queueDataFileJsonl = path.resolve(settings.queueDirectory, runtimeQueue, `${queue}.jsonl`);
		const queueDataFileJson = path.resolve(settings.queueDirectory, runtimeQueue, `${queue}.json`);
		let mockStream = null;

		if (fs.existsSync(queueDataFileJsonl)) {
			mockStream = leoStream.pipeline(
				fs.createReadStream(queueDataFileJsonl),
				leoStream.parse<ReadEvent<T>>()
			);
		} else if (fs.existsSync(queueDataFileJson)) {
			mockStream = leoStream.eventstream.readArray(requireFn(queueDataFileJson));
		} else {
			mockStream = leoStream.eventstream.readArray([]);
		}

		mockStream.checkpoint = (callback) => callback();
		return mockStream;
	};

	leoStream.toLeo = <T>(): TransformStream<Event<T>, unknown> => {
		let records = 0;
		const timestamp = Date.now();
		const fileStreams = {};
		const mockStream = leoStream.through<Event<T>, unknown>((writeData: Event<T>, callback) => {
			const queue = refUtil.ref(writeData.event).id;
			// Mark queue to have in memory data from this batch
			process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] = settings.batchId;
			registry.rstreamsMock.queues.add(queue);

			// Add an eid 
			const data: ReadEvent<T> = writeData as ReadEvent<T>;
			data.eid = leoStream.eventIdFromTimestamp(timestamp, "full", records);
			records++;
			if (!fileStreams[queue]) {
				const queueDataFileJsonl = path.resolve(settings.queueDirectory, settings.batchId, `${queue}.jsonl`);
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
			const cb = (err) => {
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

	leoStream.fromS3 = (file: {
		bucket: string,
		key: string;
		range?: string;
	}): stream.Readable => {
		const Bucket = path.resolve(settings.s3Directory, file.bucket);
		const Key = file.key;
		// let Range = file.range || undefined;

		const filepath = path.resolve(Bucket, Key);
		if (!fs.existsSync(filepath)) {
			throw util.error(new Error(), {
				message: 'The specified key does not exist.',
				code: 'NoSuchKey'
			});
		}
		return fs.createReadStream(filepath);
	};

	leoStream.toS3 = (Bucket: string, File: string) => {
		const filepath = path.resolve(settings.s3Directory, `${Bucket}/${File}`);
		createPath(path.dirname(filepath));
		return fs.createWriteStream(filepath);
	};


	leoStream.cron.checkLock = (cron: CronData, runid: string, remainingTime: number, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.reportComplete = (cron: CronData, runid: string, status: string, log: unknown, opts: ReportCompleteOptions, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.createLock = (id: string, runid: string, maxDuration: Milliseconds, callback: Callback<AWSError>) => callback(null);
	leoStream.cron.removeLock = (id: string, runid: string, callback: Callback<AWSError>) => callback(null);

	leoStream.toCheckpoint = () => leoStream.devnull();
}
