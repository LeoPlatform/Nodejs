import moment from "moment";
import { Callback, Checkpoint, Checkpoints, CreateSourceFunction, CreateSourceOptions, Cron, ReadableQueueStream, ReadableStream, ReadEvent, ReadOptions } from "../types";
import async from "async";

import * as s3LocalFileHelper from "./s3_local_file_helper";

import refUtil from "../reference.js";
import { StreamUtil } from "../lib";

import { PassThrough, Readable, Writable, Stream } from "stream";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import pipe from "pump";
import split from "split2";
import { obj as pipeline } from "pumpify";

const logger = require("leo-logger")("leo-stream");
const loggerS3 = logger.sub("fast_s3");
const FIVE_MB_IN_BYTES = 1024 * 1024 * 5;


const pad = "0000000";
const padLength = -1 * pad.length;

interface S3PassThrough extends PassThrough {
	uncompressed: boolean;
	idOffset: number;
}

interface CreateSourcePassThrough<T> extends ReadableStream<T> {
	write<T extends {}>(data: T): boolean;
	throttledWrite(obj: T): void;
	end(): void;
	isEnding: boolean;
	orig_end: any
}

interface InternalReadEvent<T> extends Omit<ReadEvent<T>, "eid"> {
	eid: number;
}

enum StorageType {
	S3 = "s3",
	Gzip = "gzip"
}

interface LeoStreamBaseRecord {
	event: string;
	start: string;
	end: string;

	timestamp: number;
	event_source_timestamp: number;

	size: number;
	gzipSize: number;

	records: number;

	archive: boolean;
	ttl: number;
	v: number;

	/* Fields added based on stored data */
	storageType: StorageType;
	streamData: StreamData;
}

interface StreamData {
	range: string;
	idOffset: number;
	prefix: string;

	getStream<T>(parser: (value: string) => T): ReadableStream<T>;
}

abstract class BaseStreamData implements StreamData {
	// range: string;
	// idOffset: number;
	// prefix: string;

	constructor(public prefix: string, public idOffset: number, public range: string) {
	}

	abstract getStream<T>(parser: (value: string) => T): ReadableStream<T>;
}

class S3StreamData extends BaseStreamData {

	constructor(prefix: string, idOffset: number, range: string, private stream: GetStream) {
		super(prefix, idOffset, range);
	}

	getStream<T>(parser: (value: string) => T): ReadableStream<T> {
		return new pipeline(
			this.stream.getStream(),

			// fs.createReadStream("C:/tmp/rstreams-sdk/prodbus-leos3-17uqyaemyrrxs/1679338178929-0000525_bus_order-entity-old-new_ddb-order-entity-load-order-entity-old-new_764295f993f2fafc2afbbadd51867124_z_2023_03_20_18_49_1679338179102-0000001-88f13c05-19b4-4d7f-8916-61af2d462c2f_bytes=0-3024.gz"),
			// (() => {
			// 	let gzipStream = zlib.createGunzip();
			// 	gzipStream.setEncoding('utf8');
			// 	gzipStream.on('error', function (err) {
			// 		logger.debug("Skipping gzip");
			// 	});
			// 	return gzipStream;
			// })(),


			split((value) => {
				try {
					return parser(value);
				} catch (e) {
					//If we cancel the download early, we don't want to die here.
					return null;
				}
			})
		) as ReadableStream<T>;
	}

}

class GzipStreamData extends BaseStreamData {

	gzip: Buffer;
	constructor(prefix: string, idOffset: number, range: string, data: Buffer) {
		super(prefix, idOffset, range);
		this.gzip = data;
	}
	getStream<T>(parser: (value: string) => T): ReadableStream<T> {
		let gzip = zlib.createGunzip();
		gzip.setEncoding('utf8');
		gzip.on('error', function (err) {
			logger.debug("Skipping gzip");
		});
		let stream = new pipeline(
			gzip,
			split(parser)
		);
		gzip.end(this.gzip);
		return stream as ReadableStream<T>;
	}

}

interface PromiseResolver<T> extends Promise<T> {
	resolve: () => void;
	reject: (err?: any) => void;
}


interface DownloadQueue extends async.QueueObject<DownloadTask> {
	createTask(s3: s3LocalFileHelper.S3File, fileSizeBytes: number, endEid: string): DownloadTask;
	isExiting: boolean;
}

interface TaskFile {
	bucket: string;
	key: string;
	localFilename: string;
	uncompressed: boolean;
}

interface GetStream {
	getStream(): Readable;
}

class DownloadTask implements GetStream {
	s3key: string;
	file: TaskFile;
	downloadStream?: Stream & { destroy: () => void };
	readStream: Readable;
	promise: PromiseResolver<void>;
	fileSizeBytes: number = 0;
	saveFiles: boolean = false;

	constructor(file, fileSizeBytes: number, private ls: typeof StreamUtil, saveFiles = false) {
		this.file = file;
		this.s3key = `s3: ${this.file.bucket}/${this.file.key}`;
		this.promise = createPromiseResolver();
		this.fileSizeBytes = fileSizeBytes;
		this.saveFiles = saveFiles;

		//this.readStream = this.getStream();

	}

	getStream(): Readable {
		if (this.readStream == null) {
			let pass = new PassThrough({
				// autoDestroy: false,
				// allowHalfOpen: true,
				// emitClose: false
			});
			this.promise
				.then(() => {
					// eslint-disable-next-line no-constant-condition
					if (fs.existsSync(this.file.localFilename)) {
						//console.log(this.file.localFilename);
						// Pipe the file stream to the passthrough to start data flowing
						this.ls.pipe(
							fs.createReadStream(this.file.localFilename),
							//this.ls.fromS3(this.file),
							this.file.uncompressed ? undefined : (() => {
								let gzipStream = zlib.createGunzip();
								gzipStream.setEncoding('utf8');
								gzipStream.on('error', function (err) {
									logger.debug("Skipping gzip");
								});
								return gzipStream;
							})(),
							pass,
							(err) => {
								if (!err) {
									try {
										loggerS3.debug(`get_s3_stream.localFileReady.cleanup deleting local s3 file: ${this.file.localFilename}`);
										if (!this.saveFiles) {
											fs.unlinkSync(this.file.localFilename);
										}
									} catch (err) {
										loggerS3.error(`get_s3_stream.localFileReady.cleanup.error deleting local s3 file: ${this.file.localFilename}`);
									}
									pass.end();
								} else {
									pass.emit("error", err);
								}
							}
						);
					} else {
						this.ls.pipe(
							this.ls.fromS3(this.file),
							pass,
						);
					}
				})
				.catch(err => pass.emit("error", err));

			this.readStream = pass;
		}
		return this.readStream;
	}
	cancel(): void {
		if (this.downloadStream) {
			let s3key = `s3: ${this.file.bucket}/${this.file.key}`;
			this.downloadStream.on("error", (err) => {
				// Ignore errors.  This stream was never used
				loggerS3.debug("close_remaining_s3_streams.error Error closing s3 stream:", s3key, err);
			});

			loggerS3.debug("close_remaining_s3_streams.destroy closing s3 stream:", s3key);
			this.downloadStream.destroy();
		}
	}
}

interface LeoStreamS3Record extends LeoStreamBaseRecord {
	uncompressed: boolean;
	storageType: StorageType.S3;
	s3: {
		bucket: string;
		key: string;
		range: string;
		idOffset?: number;
	},
	offsets: {
		event: string;
		end: number;
		gzipOffset: number;
		gzipSize: number;
		offset: number;
		records: number;
		size: number;
		start: number;
	}[],
}

interface LeoStreamGzipRecord extends LeoStreamBaseRecord {
	storageType: StorageType.Gzip;
	gzip: Buffer
}

type LeoStreamRecord = LeoStreamGzipRecord | LeoStreamS3Record;


interface ReadOptionsV2<T = unknown> extends ReadOptions {
	subqueue?: string,
	buffer?: number;
	parse?: (data: string) => ReadEvent<T>;
	fast_s3_read_parallel_download_limit?: number;
}

function createPromiseResolver<R>() {
	let resolve;
	let reject;
	let promise = new Promise((res, rej) => {
		reject = rej;
		resolve = res;
	}) as PromiseResolver<R>;

	promise.resolve = resolve;
	promise.reject = reject;
	return promise;
}
export class StreamUtilV2 {
	fromLeoVersion: string;
	constructor(private ls: typeof StreamUtil) {
		this.fromLeoVersion = process.env.RSTREAMS_READ_VERSION ?? "v1";
	}
	public fromLeo<T>(
		botId: string,
		queue: string,
		opts?: ReadOptionsV2<T>
	): ReadableQueueStream<T> {

		if (this.fromLeoVersion === "v2") {
			return this.fromLeoV2(botId, queue, opts);
		} else {
			return this.fromLeoV1(botId, queue, opts);
		}
	}

	public fromLeoV2<T>(
		ID: string,
		queue: string,
		opts?: ReadOptionsV2<T>
	): ReadableQueueStream<T> {
		const ls = this.ls;
		const configure = ls.configuration;
		const dynamodb = ls.dynamodb;
		const cron = ls.cron;

		console.log("fromLeo:V2");
		let CRON_TABLE = configure.resources.LeoCron;
		let EVENT_TABLE = configure.resources.LeoEvent;
		let STREAM_TABLE = configure.resources.LeoStream;

		opts = opts || {};
		queue = refUtil.ref(queue).queue(opts.subqueue).id;

		// If stop time wasn't specified try and get 80% of the remaining time
		if (!opts.stopTime && configure.registry && configure.registry.context) {
			opts.stopTime = moment.now() + (configure.registry.context.getRemainingTimeInMillis() * 0.8);
		}
		if (!opts.stopTime && opts.runTime) {
			opts.stopTime = moment().add(opts.runTime).valueOf();
		}

		opts = Object.assign({
			buffer: 16,
			loops: 100,
			start: null,
			limit: Number.POSITIVE_INFINITY,
			size: Number.POSITIVE_INFINITY,
			debug: false,
			stopTime: moment().add(240, "seconds"),
			stream_query_limit: opts.fast_s3_read ? 1000 : 50,
			fast_s3_read: false,
			fast_s3_read_parallel_fetch_max_bytes: FIVE_MB_IN_BYTES,
			fast_s3_read_parallel_download_limit: 40,
			fast_s3_read_save_files: false,
			fast_s3_read_max_download_file_size_bytes: FIVE_MB_IN_BYTES,
			fast_s3_read_download_as_uncompressed: false,
			parse: JSON.parse
		}, opts || {});
		logger.debug(opts);

		if (opts.fast_s3_read) {
			logger.info('using fast_s3_read');
		}


		let pipeState: {

			totalCount: number;
			totalSize: number;
			count: number;
			hasTime: boolean;
			isPassDestroyed: boolean;
			usingSnapshot: boolean;
			originalQueue: string;
			start: string;
		} = {
			hasTime: true,
			totalCount: 0,
			totalSize: 0,
			count: 0,
			isPassDestroyed: false,
			usingSnapshot: false,

			originalQueue: queue,
			start: "",
		};


		interface SourceState {
			max_eid: string;

			loops?: number;
			hasMoreEvents: boolean;

			//usingSnapshot: boolean;
			snapshotNext: string;
			snapshotEnd: string;
			usingArchive: boolean;
			//originalQueue: string;

			queue: string;
			position: string;
			LastEvaluatedKey?: any;
		}

		let newStats: () => {
			eid: string | null;
			units: number;
			source_timestamp: number | null;
			started_timestamp: number | null;
			ended_timestamp: number | null;
			start_eid: string | null;
		} = () => {
			return {
				eid: null,
				units: 0,
				source_timestamp: null,
				started_timestamp: null,
				ended_timestamp: null,
				start_eid: null,
			};
		};
		let stats = newStats();
		let updateStats = (event: ReadEvent<T> & { units?: number }) => {
			let timestamp = Date.now();
			let start = (event.event_source_timestamp || timestamp);

			stats.source_timestamp = stats.source_timestamp ? Math.min(start, stats.source_timestamp) : start;
			stats.started_timestamp = stats.started_timestamp ? Math.max(timestamp, stats.started_timestamp) : timestamp;
			stats.ended_timestamp = stats.ended_timestamp ? Math.max(timestamp, stats.ended_timestamp) : timestamp;
			stats.eid = event.eid;
			stats.units += event.units || 1;
			stats.start_eid = stats.start_eid || event.eid;
		};

		function throttledWrite(stream, obj, callback) {
			if (!stream.push(obj)) {
				//logger.debug("back pressure");
				stream.once('drain', () => {
					//logger.debug("back pressure done");
					callback();
				});
			} else {
				callback();
			}
		}
		const parser = opts.parse ?? JSON.parse;


		let downloadQueue = async.queue(function (task: DownloadTask, callback) {
			let file = task.file;
			let bucket = file.bucket;
			let key = file.key;
			let localFilename = file.localFilename;


			loggerS3.debug(`downloadQueue.start_file starting task for: ${bucket}/${key}`);
			if (downloadQueue.isExiting) {
				loggerS3.debug(`downloadQueue.skipping ending task-exit for: ${bucket}/${key}`);
				return callback();
			} else if (fs.existsSync(localFilename)) {
				// Skip becasue the file already exists
				loggerS3.debug(`downloadQueue.finished_file ending existed for: ${bucket}/${key}`);
				return callback();
			} else if (task.fileSizeBytes > opts.fast_s3_read_max_download_file_size_bytes) {
				// Skip becasue the file is larger the config size
				loggerS3.debug(`downloadQueue.finished_file ending to large (${task.fileSizeBytes} > ${opts.fast_s3_read_max_download_file_size_bytes}) for : ${bucket}/${key}`);
				return callback();
			}

			fs.mkdirSync(path.dirname(localFilename), { recursive: true });

			let stream = ls.pipeline.call(ls,
				...[
					ls.fromS3(file),
					file.uncompressed ? ls.gunzip() : undefined,
					fs.createWriteStream(localFilename)
				].filter(a => a)
			);
			task.downloadStream = stream;
			require("end-of-stream")(stream, (err) => {
				if (err) {
					// Didn't download correctly we need to remove the local file if it exists
					try {
						loggerS3.debug(`downloadQueue.error Error downloading s3: ${bucket}/${key} file: ${localFilename}`);
						fs.unlinkSync(localFilename);
					} catch (err) {
						loggerS3.error(`downloadQueue.error Error deleting local s3: ${bucket}/${key} file: ${localFilename}`);
					}
				} else {
					loggerS3.debug(`downloadQueue.finished_file Complete downloading s3: ${bucket}/${key} file: ${localFilename}`);
				}

				loggerS3.debug(`downloadQueue.finished_file ending task-normal for: ${bucket}/${key}`);

				// We are exiting so ignore any closing errors.
				if (downloadQueue.isExiting && err && err.message == "premature close") {
					callback();
				} else {
					callback(err);
				}
			});
		}, opts.fast_s3_read_parallel_download_limit) as DownloadQueue;

		downloadQueue.createTask = function (
			s3: s3LocalFileHelper.S3File,
			fileSizeBytes: number,
			endEid: string
		) {
			const task = new DownloadTask(
				{
					bucket: s3.bucket,
					key: s3.key,
					range: s3.range,
					uncompressed: s3.uncompressed,
					localFilename: s3LocalFileHelper.buildLocalFilePath(s3, endEid)
				},
				fileSizeBytes,
				ls,
				opts.fast_s3_read_save_files
			);
			// Add the task to the download queue
			downloadQueue.push(task, (err) => {
				loggerS3.debug(`create_s3_stream.download_queue_add.${err ? "error" : "success"} pushing to queue end: ${task.s3key}`, err || "");
				err ? task.promise.reject(err) : task.promise.resolve();
			});
			return task;
		};

		downloadQueue.error(function (err, task) {
			loggerS3.debug("downloadQeueue.error Download queue error", err, task);
		});

		function isPipeExiting() {
			return pipeState.totalCount >= opts.limit
				|| pipeState.totalSize >= opts.size
				|| !pipeState.hasTime ||
				pipeState.isPassDestroyed;
		}

		const queueReadStream: ReadableQueueStream<T> = ls.pipeline(
			this.createSource(async (state: SourceState) => {
				async function doQuery(state: SourceState) {
					if (pipeState.usingSnapshot || state.max_eid.localeCompare(state.position) > 0) {

						logger.debug("checking next loop, loops remaining ", state.loops, ", Time Remaining:", opts.stopTime - moment.now());
						pipeState.hasTime = pipeState.hasTime && (opts.stopTime > moment.now());
						logger.debug(
							pipeState.totalCount,
							opts.limit,
							pipeState.totalSize,
							opts.size,
							state.hasMoreEvents,
							pipeState.hasTime,
							state.loops,
							state.max_eid,
							state.position,
							(pipeState.usingSnapshot || state.max_eid.localeCompare(state.position))
						);

						if (
							pipeState.totalCount >= opts.limit ||
							pipeState.totalSize >= opts.size ||
							!state.hasMoreEvents ||
							!pipeState.hasTime ||
							state.loops <= 0 ||
							(!pipeState.usingSnapshot && state.max_eid.localeCompare(state.position) <= 0)
						) {
							logger.debug("Calling Pass.end");
							return [];
						}


						var params = {
							TableName: STREAM_TABLE,
							KeyConditionExpression: "#event = :event and #key between :start and :maxkey",
							ExpressionAttributeNames: {
								"#event": "event",
								"#key": "end",
							},
							Limit: opts.stream_query_limit || 50,
							ExpressionAttributeValues: {
								":event": queue,
								":maxkey": pipeState.usingSnapshot ? state.snapshotEnd.replace("_snapshot/", "") + 9 : state.max_eid,
								":start": pipeState.usingSnapshot ? state.position.replace("_snapshot/", "") : state.position
							},
							ExclusiveStartKey: state.LastEvaluatedKey,
							ReturnConsumedCapacity: 'TOTAL'
						};
						logger.debug(params);
						let result = await dynamodb.docClient.query(params).promise();

						state.LastEvaluatedKey = result.LastEvaluatedKey;
						let items = result.Items || [];

						if (items.length == 0) {
							if (pipeState.usingSnapshot) { //Then let's go back to the real queue
								state.queue = pipeState.originalQueue;
								state.position = state.snapshotNext;
								pipeState.usingSnapshot = false;
								delete state.LastEvaluatedKey;
								return doQuery(state);
							} else if (state.usingArchive) { //Then let's go back to the real queue
								queue = pipeState.originalQueue;
								state.usingArchive = false;
								delete state.LastEvaluatedKey;
								return doQuery(state);
							} else {
								logger.debug("no more events");
								state.hasMoreEvents = false;
								return [];
							}
						}

						return items.map((i, n) => { i.index = n; return i; });
					} else {
						logger.debug("no events");
						return [];
					}
				}

				return doQuery(state);
			}, {
			}, async () => {
				try {
					let docs = await dynamodb.docClient.batchGet({
						RequestItems: {
							[CRON_TABLE]: {
								Keys: [{
									id: ID
								}]
							},
							[EVENT_TABLE]: {
								Keys: [{
									event: queue
								}]
							}
						}
					}).promise();

					if (docs.UnprocessedKeys !== undefined && Object.keys(docs.UnprocessedKeys).length > 0) {
						throw new Error("Not enough capacity to read");
					}

					let start = null;
					let leoEvent = docs.Responses?.[EVENT_TABLE]?.[0] ?? null;
					let leoCron = docs.Responses?.[CRON_TABLE]?.[0] ?? null;

					let defaultCheckpointStart = "z/" + moment().format("YYYY/MM/DD");
					let archive_end = null;

					let snapshotNext = null;
					let snapshotStart = null;
					let snapshotEnd = null;
					let usingSnapshot = false;
					let usingArchive = false;
					let originalQueue = queue;
					if (leoEvent) {
						if (leoEvent.snapshot) {
							snapshotNext = leoEvent.snapshot.next;
							snapshotStart = leoEvent.snapshot.start;
						}
						if (leoEvent.archive) {
							archive_end = leoEvent.archive.end;
						}
					}
					var queueRef = refUtil.refId(queue);

					// TODO: can I move this to a function
					if (opts.start) {
						start = opts.start + " "; //we want it to start after this one
					} else if (configure.registry && configure.registry.__cron && configure.registry.__cron.starteid && configure.registry.__cron.starteid[queueRef]) {
						start = configure.registry.__cron.starteid[queueRef];
					} else if (docs.Responses && docs.Responses[CRON_TABLE] && docs.Responses[CRON_TABLE][0]) { //There are no cron jobs, not possible to stream
						if (leoCron.checkpoint && !leoEvent.v) {
							start = leoCron.checkpoint;
						} else if (leoCron?.checkpoints?.read?.[queueRef]) {
							start = leoCron.checkpoints.read[queueRef].checkpoint || defaultCheckpointStart;
						} else {
							start = defaultCheckpointStart;
						}
					} else {
						start = defaultCheckpointStart;
					}


					console.log(`Reading event from ${queue} ${start}`);

					// if (opts.fast_s3_read) {
					// 	s3LocalFileHelper.tryPurgeS3Files(start, opts.fast_s3_read_parallel_fetch_max_bytes);
					// }

					// TODO: can i move this to a function
					{
						if ((start == "z/" || start == "z/ ") && snapshotStart) {
							start = snapshotStart;
						}

						if (start.match(/^_snapshot/)) {
							queue += "/_snapshot";
							usingSnapshot = true;

							//Don't want to move onto the next snapshot
							snapshotEnd = start.replace(/[^/]+$/, '9999999999');
						}

						if (archive_end && archive_end.localeCompare(start) > 0) {
							queue += "/_archive";
							usingArchive = true;
						}

						if (start === null) { //We will not run unless we got a start
							throw new Error("Unable to determine start position");
						}
					}

					let checkpointData = ["registry", "__cron", "checkpoints", "read"].reduce((o, f) => o[f] = o[f] || {}, configure);
					checkpointData[queueRef] = leoCron?.checkpoints?.read?.[queueRef];

					let max_eid: string = configure?.registry?.__cron?.maxeid ?? opts.maxOverride ?? leoEvent?.max_eid ?? '';

					pipeState.originalQueue = originalQueue;
					pipeState.start = start;
					return {
						max_eid,

						loops: opts.loops,
						hasMoreEvents: true,

						usingSnapshot,
						snapshotNext,
						snapshotEnd,
						usingArchive,
						//originalQueue,

						queue,
						position: start,
						LastEvaluatedKey: null,
					};
				} catch (err) {
					if (err.message == 'The provided key element does not match the schema') {
						console.log(ID, queue);
					}
					throw err;
				}
			}),
			ls.through((item: LeoStreamRecord, done) => {

				if (item.end.localeCompare(pipeState.start) <= 0 || isPipeExiting()) {
					return done();
				}

				// Storage type isn't stored in the db so add it based on the data
				item.storageType = "s3" in item ? StorageType.S3 : StorageType.Gzip;

				let { range, idOffset, prefix } = getRangeAndOffset(item, pipeState.start, pipeState.usingSnapshot);
				if (item.storageType === StorageType.S3) {
					item.streamData = new S3StreamData(
						prefix,
						idOffset,
						range,
						opts.fast_s3_read
							? downloadQueue.createTask({
								bucket: item.s3.bucket,
								key: item.s3.key,
								range: range,
								uncompressed: opts.fast_s3_read_download_as_uncompressed,
							}, item.gzipSize, item.end)
							: { getStream: () => ls.fromS3(item.s3) }
					);
				} else if (item.storageType === StorageType.Gzip) {
					item.streamData = new GzipStreamData(prefix, idOffset, range, item.gzip);
				} else {
					throw new Error("Unknown storgage type");
				}
				done(null, item);
			}, (flushDone) => {
				console.log("Flushed download");
				// Cancel any downloads still in flight
				downloadQueue.isExiting = true;
				let tasks = downloadQueue.workersList();
				tasks.forEach(task => {
					task.data.cancel();
				});

				// Wait for the queue to drain
				loggerS3.debug("close_remaining_s3_streams.start closing all remaining s3 streams", tasks.length);
				if (downloadQueue.idle()) {
					loggerS3.debug("close_remaining_s3_streams.drain.idle waiting for queue to drain", tasks);
					flushDone();
				} else {
					loggerS3.debug("close_remaining_s3_streams.drain.start waiting for queue to drain", tasks);
					downloadQueue.drain = async () => {
						loggerS3.debug("close_remaining_s3_streams.drain.finished waiting for queue to drain done", downloadQueue.length());
						flushDone();
					};
				}
			}),
			ls.through({
				//highWaterMark: opts.stream_query_limit * 10
			}, function (item: LeoStreamRecord, done) {

				if (isPipeExiting()) {
					return done();
				}

				let prefix = item.streamData.prefix;
				let idOffset = item.streamData.idOffset;

				let createEId: (eid: number) => string;
				if (pipeState.usingSnapshot) {
					createEId = function (eid) {
						return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
					};
				} else {
					createEId = function (eid) {
						return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
					};
				}

				// eslint-disable-next-line @typescript-eslint/no-this-alias
				const self = this;
				pipe(
					item.streamData.getStream(parser),
					ls.write((ie: InternalReadEvent<T>, done) => {
						let e = ie as unknown as ReadEvent<T>; // next line fixes the eid difference
						e.eid = createEId(ie.eid);
						if (!pipeState.isPassDestroyed && e.eid.localeCompare(pipeState.start) > 0 && pipeState.totalCount < opts.limit && pipeState.totalSize < opts.size) { //Then it is greater than the event they were looking at
							throttledWrite(self, e, done);
						} else { //otherwise it means we had a number in the middle of a file
							logger.debug(`skipping ${item.storageType}`, pipeState.start, e.eid);
							done();
						}
					}), (err) => {
						if (err &&
							err.code != "RequestAbortedError" &&
							!(pipeState.isPassDestroyed && err.code == "Z_BUF_ERROR") &&
							!(pipeState.isPassDestroyed && err.message == "premature close")) {
							logger.error(err);
							done(err);
						} else {
							logger.debug(`${item.storageType} event read finished.  Records: ${item.records}, Total: ${pipeState.totalCount}`);
							done();
						}
					}
				);
			}, (done) => {

				console.log("Flushed Streamer");
				done();
			}),
			ls.through(function (obj: ReadEvent<T>, done) {
				if (isPipeExiting()) {
					return done();
				}
				pipeState.count++;
				pipeState.totalCount++;
				// start = obj.eid + " "; //we want it to continue after this one
				updateStats(obj);
				obj.event = pipeState.originalQueue;
				done(null, obj);
			}, (done) => {

				console.log("Flushed prep");
				done();
			})
		) as unknown as ReadableQueueStream<T>;

		// Add Checkpoint functions to the returned stream
		queueReadStream.checkpoint = function (params, done) {
			if (typeof params === "function") {
				done = params;
				params = {};
			}
			let data = Object.assign(stats, params);
			logger.debug("Stats", data);
			if (ID && queue && data.units > 0) {
				cron.checkpoint(ID, queue, data, (err) => {
					err && console.log("Stats error:", err);
					stats = newStats();
					done(err, data);
				});
			} else {
				done(null, data);
			}
		} as {
			(params: Checkpoint, done: Callback): void;
			(done: Callback): void;
		};
		queueReadStream.get = function () {
			return stats;
		};


		["end", "finish", "close"].forEach(event => {

			queueReadStream.on(event, (...args) => {
				console.log("STREAM EVENT:", event, ...args);
			});
		});
		return queueReadStream;
	}

	public fromLeoV1<T>(
		ID: string,
		queue: string,
		opts?: ReadOptionsV2<T>
	): ReadableQueueStream<T> {

		interface S3File {
			bucket: string;
			key: string;
			range: string;
			localFileReady?: PromiseResolver<void>;
			localFilename?: string;
			uncompressed: boolean;
			idOffset?: number;
		}

		interface StreamRecordV1 {
			event: string;
			start: string;
			end: string;

			timestamp: number;
			event_source_timestamp: number;

			size: number;
			gzipSize: number;

			records: number;

			archive: boolean;
			ttl: number;
			v: number;

			gzip?: Buffer;
			s3?: S3File,

			offsets?: {
				event: string;
				end: number;
				gzipOffset: number;
				gzipSize: number;
				offset: number;
				records: number;
				size: number;
				start: number;
			}[]
		}

		interface StreamStats {
			eid: string | null;
			units: number;
			source_timestamp: number | null;
			started_timestamp: number | null;
			ended_timestamp: number | null;
			start_eid: string | null;
		}

		interface CronData {
			checkpoints?: Checkpoints;
			checkpoint?: string;
		}

		interface QueueData {
			max_eid: string;
			v: any;
			archive: any;
			snapshot: any;
		}

		interface DownloadTaskV1 {
			setStream(stream: Writable);
			file: S3File;
		}

		const ls = this.ls;
		const configure = ls.configuration;
		const dynamodb = ls.dynamodb;
		const cron = ls.cron;

		console.log("fromLeo:V1");
		const CRON_TABLE = configure.resources.LeoCron;
		const EVENT_TABLE = configure.resources.LeoEvent;

		opts = opts || {};
		queue = refUtil.ref(queue).queue(opts.subqueue).id;
		if (!opts.stopTime && configure.registry && configure.registry.context) {
			opts.stopTime = moment.now() + (configure.registry.context.getRemainingTimeInMillis() * 0.8);
		}
		if (!opts.stopTime && opts.runTime) {
			opts.stopTime = moment().add(opts.runTime).valueOf();
		}

		logger.info(opts);
		opts = Object.assign({
			buffer: 16,
			loops: 100,
			start: null,
			limit: Number.POSITIVE_INFINITY,
			size: Number.POSITIVE_INFINITY,
			debug: false,
			stopTime: moment().add(240, "seconds"),
			stream_query_limit: opts.fast_s3_read ? 1000 : 50,
			fast_s3_read: false,
			fast_s3_read_parallel_fetch_max_bytes: FIVE_MB_IN_BYTES,
			fast_s3_read_save_files: false,
			fast_s3_read_max_download_file_size_bytes: FIVE_MB_IN_BYTES,
			fast_s3_read_download_as_uncompressed: false,
			fast_s3_read_parallel_download_limit: 40,
		}, opts || {});
		logger.info(opts);
		if (opts.fast_s3_read) {
			logger.info('using fast_s3_read');
		}

		const pass: ReadableQueueStream<T> = new PassThrough({
			highWaterMark: opts.buffer,
			objectMode: true
		}) as unknown as ReadableQueueStream<T>;

		let hasTime = true;

		// tracks if we've passed destroy on the passthrough
		let isPassDestroyed = false;

		pass.destroy = function (error?: Error) {
			hasTime = false;
			// we have destroyed pass
			isPassDestroyed = true;
			clearStreamTimeout();
			return this;
		};

		function clearStreamTimeout() {
			hasTimeTimeout && clearTimeout(hasTimeTimeout);
			hasTimeTimeout = null;
		}

		function emitError(err: Error) {
			clearStreamTimeout();
			pass.emit("error", err);
			pass.end();
		}

		pass.on("end", () => {
			clearStreamTimeout();
		});

		let hasTimeTimeout = setTimeout(() => {
			pass.destroy();
			console.log("Called timeout");
		}, opts.stopTime - moment().valueOf());

		const newStats = (): StreamStats => {
			return {
				eid: null,
				units: 0,
				source_timestamp: null,
				started_timestamp: null,
				ended_timestamp: null,
				start_eid: null,
			};
		};
		let stats = newStats();
		const updateStats = (event: ReadEvent<T> & { units?: number }) => {
			const timestamp = Date.now();
			const start = (event.event_source_timestamp || timestamp);

			stats.source_timestamp = stats.source_timestamp ? Math.min(start, stats.source_timestamp) : start;
			stats.started_timestamp = stats.started_timestamp ? Math.max(timestamp, stats.started_timestamp) : timestamp;
			stats.ended_timestamp = stats.ended_timestamp ? Math.max(timestamp, stats.ended_timestamp) : timestamp;
			stats.eid = event.eid;
			stats.units += event.units || 1;
			stats.start_eid = stats.start_eid || event.eid;
		};

		pass.checkpoint = function (params, done) {
			if (typeof params === "function") {
				done = params;
				params = {};
			}
			const data = Object.assign(stats, params);
			logger.debug("Stats", data);
			if (ID && queue && data.units > 0) {
				cron.checkpoint(ID, queue, data, (err) => {
					err && console.log("Stats error:", err);
					stats = newStats();
					done(err, data);
				});
			} else {
				done(null, data);
			}
		} as {
			(params: Checkpoint, done: Callback): void;
			(done: Callback): void;
		};

		pass.get = function () {
			return stats;
		};

		dynamodb.docClient.batchGet({
			RequestItems: {
				[CRON_TABLE]: {
					Keys: [{
						id: ID
					}]
				},
				[EVENT_TABLE]: {
					Keys: [{
						event: queue
					}]
				}
			}
		}, function (err, docs) {
			if (err) {
				if (err.message == 'The provided key element does not match the schema') {
					console.log(ID, queue);
				}
				emitError(err);
				return;
			} else if (docs.UnprocessedKeys !== undefined && Object.keys(docs.UnprocessedKeys).length > 0) {
				emitError(new Error("Not enough capacity to read"));
				return;
			}


			let start: string = null;
			let leoEvent: QueueData;
			let leoCron: CronData;
			if (Object.keys(docs.UnprocessedKeys).length >= 1) {
				pass.end();
				return;
			} else if (!docs.Responses || !docs.Responses[EVENT_TABLE] || docs.Responses[EVENT_TABLE].length === 0) { //There are no events that are processable
				pass.end();
				return;
			} else {
				leoEvent = docs.Responses[EVENT_TABLE][0] as QueueData;
			}


			//start from today earliest if no checkpoint specified.
			const defaultCheckpointStart = "z/" + moment().format("YYYY/MM/DD");
			let archive_end: string = null;

			let snapshotNext: string = null;
			let snapshotStart: string = null;
			let snapshotEnd: string = null;
			let usingSnapshot = false;
			let usingArchive = false;
			let originalQueue = queue;
			if (leoEvent) {
				if (leoEvent.snapshot) {
					snapshotNext = leoEvent.snapshot.next;
					snapshotStart = leoEvent.snapshot.start;
				}
				if (leoEvent.archive) {
					archive_end = leoEvent.archive.end;
				}
			}
			let queueRef: string = refUtil.refId(queue);
			leoCron = docs.Responses && docs.Responses[CRON_TABLE] && docs.Responses[CRON_TABLE][0] as CronData;
			if (opts.start) {
				start = opts.start + " "; //we want it to start after this one
			} else if (configure.registry && configure.registry.__cron && configure.registry.__cron.starteid && configure.registry.__cron.starteid[queueRef]) {
				start = configure.registry.__cron.starteid[queueRef];
			} else if (docs.Responses && docs.Responses[CRON_TABLE] && docs.Responses[CRON_TABLE][0]) { //There are no cron jobs, not possible to stream
				if (leoCron.checkpoint && !leoEvent.v) {
					start = leoCron.checkpoint;
				} else if (leoCron.checkpoints && leoCron.checkpoints.read && leoCron.checkpoints.read[queueRef]) {
					start = leoCron.checkpoints.read[queueRef].checkpoint || defaultCheckpointStart;
				} else {
					start = defaultCheckpointStart;
				}
			} else {
				start = defaultCheckpointStart;
			}


			console.log("Reading event from", queue, start);

			if (opts.fast_s3_read) {
				s3LocalFileHelper.tryPurgeS3Files(start, opts.fast_s3_read_parallel_fetch_max_bytes);
			}

			//We want to first use a _snapshot if it exists
			//This means they have to set it to "z/" manually in order to get a snapshot, we won't do a snapshot by default.
			if ((start == "z/" || start == "z/ ") && snapshotStart) {
				start = snapshotStart;
			}
			//If we are using the snapshot, we go to a special queue
			//This could be checkpointed OR because they specified "z/" and converted it
			if (start.match(/^_snapshot/)) {
				queue += "/_snapshot";
				usingSnapshot = true;

				//Don't want to move onto the next snapshot
				snapshotEnd = start.replace(/[^/]+$/, '9999999999');
			}

			if (archive_end && archive_end.localeCompare(start) > 0) {
				queue += "/_archive";
				usingArchive = true;
			}

			if (start === null) { //We will not run unless we got a start
				pass.end();
				return;
			}

			let checkpointData: Checkpoints = ["registry", "__cron", "checkpoints", "read"].reduce((o, f) => o[f] = o[f] || {}, configure);
			checkpointData[queueRef] = leoCron && leoCron.checkpoints && leoCron.checkpoints.read && leoCron.checkpoints.read[queueRef];

			let count = 0;
			pass.throttledWrite = (obj, callback) => {
				count++;
				start = obj.eid + " "; //we want it to continue after this one
				updateStats(obj);
				obj.event = originalQueue;
				if (!pass.write(obj)) {
					logger.debug("back pressure");
					pass.once('drain', () => {
						logger.debug("back pressure done");
						callback();
					});
				} else {
					callback();
				}
			};

			function max(...args) {
				let max = args[0];
				for (let i = 1; i < args.length; ++i) {
					if (args[i] != null && args[i] != undefined) {
						max = max > args[i] ? max : args[i];
					}
				}
				return max;
			}

			let max_eid = (configure.registry && configure.registry.__cron && configure.registry.__cron.maxeid) || opts.maxOverride || leoEvent.max_eid || '';
			let table_name = configure.resources.LeoStream;

			let getEvents = function (callback) {
				const params = {
					TableName: table_name,
					KeyConditionExpression: "#event = :event and #key between :start and :maxkey",
					ExpressionAttributeNames: {
						"#event": "event",
						"#key": "end",
					},
					Limit: opts.stream_query_limit || 50,
					ExpressionAttributeValues: {
						":event": queue,
						":maxkey": usingSnapshot ? snapshotEnd.replace("_snapshot/", "") + 9 : max_eid,
						":start": usingSnapshot ? start.replace("_snapshot/", "") : start
					},
					"ReturnConsumedCapacity": 'TOTAL'
				};
				logger.debug(params);
				dynamodb.docClient.query(params, function (err, data) {
					logger.debug("Consumed Capacity", data && data.ConsumedCapacity);
					if (err) {
						logger.error(err);
						callback(err);
						return;
					}
					callback(null, data.Items);
				});
			};

			let hasMoreEvents = true;
			let hasLoops = opts.loops;
			let totalCount = 0;
			let totalSize = 0;


			if (usingSnapshot || max_eid.localeCompare(start) > 0) {
				async.whilst(() => {
					logger.debug("checking next loop, loops remaining ", hasLoops, ", Time Remaining:", opts.stopTime - moment.now());
					hasTime = hasTime && (opts.stopTime > moment.now());
					logger.debug(totalCount, opts.limit, totalSize, opts.size, hasMoreEvents, hasTime, hasLoops, max_eid, start, (usingSnapshot || max_eid.localeCompare(start)));
					return totalCount < opts.limit && totalSize < opts.size && hasMoreEvents && hasTime && hasLoops && (usingSnapshot || max_eid.localeCompare(start) > 0);
				}, (done) => {
					let count = 0;
					hasLoops--;
					getEvents(function (err, items: StreamRecordV1[]) {
						if (err) {
							return done(err);
						}
						logger.debug("found", items.length, "items");
						if (items.length == 0) {
							if (usingSnapshot) { //Then let's go back to the real queue
								queue = originalQueue;
								start = snapshotNext;
								usingSnapshot = false;
								return done();
							} else if (usingArchive) { //Then let's go back to the real queue
								queue = originalQueue;
								usingArchive = false;
								return done();
							} else {
								logger.debug("no more events");
								hasMoreEvents = false;
								return done();
							}
						}

						let counts = 0;
						let size = 0;
						let bytes = 0;
						const s3_streams: Record<string, {
							bytes: number;
							stream?: {
								destroy: (...args: any[]) => void;
								on: (...args: any[]) => void;
							};
						}> = {};

						let last_s3_index = 0;

						let downloadQueueExiting = false;

						let downloadQueue = async.queue<DownloadTaskV1>(function (task, callback) {

							let file = task.file;
							let bucket = file.bucket;// || file.Bucket;
							let key = file.key;// || file.Key;

							loggerS3.debug(`downloadQueue.start_file starting task for: ${bucket}/${key}`);
							if (downloadQueueExiting) {
								loggerS3.debug(`downloadQueue.skipping ending task-exit for: ${bucket}/${key}`);
								callback();
								return;
							}
							let localFilename = file.localFilename;
							fs.mkdirSync(path.dirname(localFilename), { recursive: true });
							let stream: Writable = ls.pipeline.call(ls,
								...[
									ls.fromS3(file),
									file.uncompressed ? ls.gunzip() : undefined,
									fs.createWriteStream(localFilename)
								].filter(a => a)
							);
							task.setStream(stream);
							require("end-of-stream")(stream, (err) => {
								if (err) {
									// Didn't download correctly we need to remove the local file if it exists
									try {
										loggerS3.debug(`downloadQueue.error Error downloading s3: ${bucket}/${key} file: ${localFilename}`);
										fs.unlinkSync(localFilename);
									} catch (err) {
										loggerS3.error(`downloadQueue.error Error deleting local s3: ${bucket}/${key} file: ${localFilename}`);
									}
								} else {
									loggerS3.debug(`downloadQueue.finished_file Complete downloading s3: ${bucket}/${key} file: ${localFilename}`);
								}

								loggerS3.debug(`downloadQueue.finished_file ending task-normal for: ${bucket}/${key}`);

								// We are exiting so ignore any closing errors.
								if (downloadQueueExiting && err && err.message == "premature close") {
									callback();
								} else {
									callback(err);
								}
							});
						}, opts.fast_s3_read_parallel_download_limit);

						downloadQueue.error(function (err, task) {
							loggerS3.debug("downloadQeueue.error Download queue error", err, task);
						});

						let loggerS3 = logger.sub("fast_s3");

						const close_remaining_s3_streams = (cb: Callback) => {
							downloadQueueExiting = true;
							loggerS3.debug("close_remaining_s3_streams.start closing all remaining s3 streams", Object.keys(s3_streams).length);

							Object.entries(s3_streams).forEach(([key, data]) => {

								loggerS3.debug("close_remaining_s3_streams.stream attempting close s3 stream:", key, !!data.stream);
								if (data.stream) {
									data.stream.on('error', (err) => {
										// Ignore errors.  This stream was never used
										loggerS3.debug("close_remaining_s3_streams.error Error closing s3 stream:", key, err);
									});
									loggerS3.debug("close_remaining_s3_streams.destroy closing s3 stream:", key);
									data.stream.destroy();
								}
							});

							// Close out the download queue
							if (downloadQueue.idle()) {
								loggerS3.debug("close_remaining_s3_streams.drain.idle waiting for queue to drain", downloadQueue.workersList());
								cb();
							} else {
								loggerS3.debug("close_remaining_s3_streams.drain.start waiting for queue to drain", downloadQueue.workersList());
								// TODO: should i be calling drain.  Double check that this is correct
								downloadQueue.drain(() => {
									loggerS3.debug("close_remaining_s3_streams.drain.finished waiting for queue to drain done", downloadQueue.length());
									cb();
								});
							}
						};

						let get_s3_stream = (index: number) => {

							loggerS3.debug("get_s3_stream.start:", index);
							// Connect to as many S3 files as possible while only holding the configured mbs of 
							// event data in front of it
							for (; last_s3_index <= index || (last_s3_index < items.length && bytes < opts.fast_s3_read_parallel_fetch_max_bytes); last_s3_index++) {

								let item = items[last_s3_index];
								if (item.s3) {
									let key = `s3: ${item.s3.bucket}/${item.s3.key}`;
									loggerS3.debug("get_s3_stream.set_range:", last_s3_index, key);
									set_range(item);

									// Create a stream for this S3 file
									if (item.gzipSize <= opts.fast_s3_read_max_download_file_size_bytes) {

										let myBytes = item.gzipSize;
										//logger.debug("creating s3 connection", bytes, last_s3_index, item.end, item.s3.key);
										// Add to the total bytes waiting to be processed
										bytes += myBytes;
										loggerS3.debug("get_s3_stream.create_s3_stream", last_s3_index, "setting up bytes", myBytes, bytes, key);
										s3_streams[last_s3_index] = {
											bytes: myBytes,
											stream: create_s3_stream(item, last_s3_index)
										};
										let ndx = last_s3_index;
										items[ndx].s3.localFileReady.finally(() => {
											// We are finished with this download stream 
											// so remove it so the exit process doesn't try to clean it up too
											loggerS3.debug("get_s3_stream.localFileReady.finally", ndx, key);
											delete s3_streams[ndx].stream;
										});
									} else {
										loggerS3.debug("get_s3_stream.skip_create_s3_stream", last_s3_index, "skipping because of file size", item.gzipSize, bytes, key);
									}
								}
							}

							let key = `s3: ${items[index].s3.bucket}/${items[index].s3.key}`;
							if (items[index].s3.localFileReady) {
								loggerS3.debug("get_s3_stream.localFileReady.start", index, key);
								let pass: S3PassThrough = ls.passThrough() as S3PassThrough;
								items[index].s3.localFileReady.then(() => {
									loggerS3.debug("get_s3_stream.localFileReady.ready", index, key);
									ls.pipe(
										fs.createReadStream(items[index].s3.localFilename),
										pass,
										(err) => {
											loggerS3.debug("get_s3_stream.localFileReady.finished", index, key);
											free_s3_stream(index);
											if (!err) {
												try {
													loggerS3.debug(`get_s3_stream.localFileReady.cleanup deleting local s3 file: ${items[index].s3.localFilename}`, index, key);
													if (!opts.fast_s3_read_save_files) {
														fs.unlinkSync(items[index].s3.localFilename);
													}
												} catch (err) {
													loggerS3.error(`get_s3_stream.localFileReady.cleanup.error deleting local s3 file: ${items[index].s3.localFilename}`, index, key);
												}
											}
										});
								}).catch(err => pass.emit("error", err));

								pass.uncompressed = items[index].s3.uncompressed;
								pass.idOffset = items[index].s3.idOffset;
								return pass;
							} else {
								loggerS3.debug("get_s3_stream.localFileReady.s3_direct", index, key);
								//console.log(items[index]);
								//console.log(items[index].s3.gzipSize, opts.fast_s3_read_max_download_file_size_bytes);
								const s = ls.fromS3(items[index].s3) as S3PassThrough;
								s.idOffset = items[index].s3.idOffset;
								return s;
							}
						};

						// Remove this streams byte count from the bytes waiting to be processed
						const free_s3_stream = (index: number) => {
							loggerS3.debug("free_s3_stream", index);
							if (s3_streams[index] != null) {

								const key = `s3: ${items[index].s3.bucket}/${items[index].s3.key}`;
								bytes -= s3_streams[index].bytes;
								loggerS3.debug("free_s3_stream.free_bytes", index, s3_streams[index].bytes, bytes, key);
							}
							delete s3_streams[index];
						};

						const set_range = (item: StreamRecordV1) => {
							if (item.s3 && item.end.localeCompare(start) > 0) {
								// if (item.start) {
								let _parts = item.start.split(/-/);
								let prefix = _parts[0];
								let idOffset = parseInt(_parts[1]);
								// }

								let createEId = null;
								if (usingSnapshot) {
									createEId = function (eid) {
										return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
									};
								} else {
									createEId = function (eid) {
										return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
									};
								}
								let fileOffset: number = null;
								let fileEnd = item.gzipSize;

								for (let i = 0; i < item.offsets.length; i++) {
									let offset = item.offsets[i];

									let endEID: string;
									if (item.archive) {
										endEID = offset.end as unknown as string;
									} else {
										endEID = createEId(offset.end);
									}

									if (start.localeCompare(endEID) < 0) {
										if (fileOffset == null) {
											fileOffset = offset.gzipOffset;
											idOffset += offset.start;
										}
									}
								}

								let file = item.s3;
								file.range = `bytes=${fileOffset}-${fileEnd}`;
								file.idOffset = idOffset;
							}
						};

						const create_s3_stream = (item: StreamRecordV1, index: number) => {

							const s3key = `s3: ${item.s3.bucket}/${item.s3.key}`;
							loggerS3.debug("create_s3_stream.start", index, s3key);
							if (item.s3 && item.end.localeCompare(start) > 0) {

								const file = item.s3;
								// let bucket = file.bucket;// || file.Bucket;
								// let key = file.key;// || file.Key;

								file.uncompressed = opts.fast_s3_read_download_as_uncompressed == true;

								file.localFilename = s3LocalFileHelper.buildLocalFilePath(file, item.end);

								file.localFileReady = createPromiseResolver();

								if (fs.existsSync(file.localFilename)) {
									loggerS3.debug("create_s3_stream.file_exists", index, item.s3.key);
									file.localFileReady.resolve();
									return null;
								}

								let theStream: Writable;
								const destroy = (...args) => {
									loggerS3.debug("create_s3_stream.destroy", index, `Destroying ${index} ${s3key} file: ${file.localFilename}`);
									theStream && theStream.destroy(...args);
								};
								const on = (...args) => {
									theStream && (theStream as any).on(...args);
								};

								loggerS3.debug(`create_s3_stream.download_queue_add pushing to queue start: ${index} ${s3key}`);

								const task: DownloadTaskV1 = {
									file,
									setStream: function (stream) {
										loggerS3.debug(`create_s3_stream.set_stream ${index} ${s3key}`);
										theStream = stream;
									}
								};
								downloadQueue.push(task, (err) => {
									loggerS3.debug(`create_s3_stream.download_queue_add.success pushing to queue end: ${index} ${s3key}`, err || "");
									err ? file.localFileReady.reject(err) : file.localFileReady.resolve();
								});
								return { destroy, on };
							}
							return null;
						};

						async.eachOfSeries(items, (item: StreamRecordV1, i: number, done) => {

							if (totalCount >= opts.limit || totalSize >= opts.size || !hasTime || isPassDestroyed) {
								return done();
							}
							//if (item.start) {
							let _parts = item.start.split(/-/);
							let prefix = _parts[0];
							let idOffset = parseInt(_parts[1]);
							//}

							let createEId = null;
							if (usingSnapshot) {
								createEId = function (eid) {
									return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
								};
							} else {
								createEId = function (eid) {
									return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
								};
							}

							if (item.s3) {
								let cb = done;
								done = function (...args) {
									free_s3_stream(i);
									process.nextTick(() => cb(...args));
								};
								if (item.end.localeCompare(start) > 0) { //Then it is greater than the event they were looking at
									//let's figure out where we should jump into this file.
									let s3Stream: Readable & { uncompressed?: boolean };

									if (opts.fast_s3_read) {
										let stream = get_s3_stream(i);
										idOffset = stream.idOffset;
										s3Stream = stream;
									} else {
										let fileOffset: number = null;
										let fileEnd = item.gzipSize;
										let recordOffset = 0;

										for (let i = 0; i < item.offsets.length; i++) {
											let offset = item.offsets[i];

											let endEID;
											if (item.archive) {
												endEID = offset.end;
											} else {
												endEID = createEId(offset.end);
											}

											if (start.localeCompare(endEID) < 0) {
												logger.debug(start, offset.start, offset.end);
												counts += offset.records; //is this right?
												size += offset.size; //this isn't exact when getting in the middle of a file, but close enough
												if (fileOffset == null) {
													fileOffset = offset.gzipOffset;
													idOffset += offset.start;
												}
												// Took out trying to pre-emptively end the file. The benefit wasn't there, and it was causing
												// readers to skip 1000's of events if they were using a limit.
											}
										}

										const file = item.s3;
										file.range = `bytes=${fileOffset}-${fileEnd}`;
										logger.debug(file.bucket, file.key, file.range);
										s3Stream = ls.fromS3(file);
									}
									let eid = 0;
									let gunzipStream = zlib.createGunzip();
									gunzipStream.setEncoding('utf8');
									gunzipStream.on('error', function (err) {
										logger.debug("Skipping gzip");
									});

									pipe(
										...[
											s3Stream,
											s3Stream.uncompressed ? undefined : gunzipStream,
											split((value) => {
												try {
													return {
														length: Buffer.byteLength(value),
														obj: JSON.parse(value)
													};
												} catch (e) {
													//If we cancel the download early, we don't want to die here.
													return null;
												}
											}),
											ls.write((obj: { obj: ReadEvent<T>, length: number }, done) => {
												let e = obj.obj;
												if (!item.archive) {
													e.eid = createEId(eid++);
												}
												let isGreaterThanStart = e.eid.localeCompare(start) > 0;

												if (!isPassDestroyed && isGreaterThanStart && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
													totalCount++;
													totalSize += obj.length;
													pass.throttledWrite(e, done);
												} else { //otherwise it means we had a number in the middle of a file
													if (isPassDestroyed || totalCount >= opts.limit || totalSize >= opts.size) {
														//we might as well close this this stream;
														pass.destroy();
														s3Stream.destroy();
													}
													logger.debug("skipping s3", start, e.eid);
													done();
												}
											}), (err) => {
												if (err &&
													err.code != "RequestAbortedError" &&
													!(isPassDestroyed && err.code == "Z_BUF_ERROR") &&
													!(isPassDestroyed && err.message == "premature close")) {
													logger.error(err);
													done(err);
												} else {
													done();
												}
											}].filter(a => a)
									);
								} else {
									done();
								}
							}
							// else if (!item.gzip || item.gzip == true) {
							// 	item.eid = item.kinesis_number;
							// 	delete item.kinesis_number;
							// 	// v1 getEvents already unzipped the payload
							// 	if (item.gzip && leoEvent.v >= 2) {
							// 		try {
							// 			item.payload = JSON.parse(zlib.gunzipSync(item.payload).toString());
							// 		} catch (e) {
							// 			item.payload = {};
							// 		}
							// 	} else if (typeof item.payload === "string") {
							// 		item.payload = JSON.parse(item.payload);
							// 	}

							// 	if (!isPassDestroyed && item.eid.localeCompare(start) > 0 && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
							// 		totalCount++;
							// 		pass.throttledWrite(item, done);
							// 	} else { //otherwise it means we had a number in the middle of a file
							// 		logger.debug("skipping gzip");
							// 		done();
							// 	}
							// } 
							else if (item.gzip) {
								let gzip = zlib.createGunzip();
								gzip.setEncoding('utf8');
								gzip.on('error', function (err) {
									logger.debug("Skipping gzip");
								});
								pipe(gzip, split(JSON.parse), ls.write((e: ReadEvent<T>, done) => {
									e.eid = createEId(e.eid);
									if (!isPassDestroyed && e.eid.localeCompare(start) > 0 && totalCount < opts.limit && totalSize < opts.size) { //Then it is greater than the event they were looking at
										totalCount++;
										pass.throttledWrite(e, done);
									} else { //otherwise it means we had a number in the middle of a file
										logger.debug("skipping gzipped");
										done();
									}
								}), (err) => {
									if (err) {
										logger.error(err);
										done(err);
									} else {
										logger.debug("gzipped event read finished", item.records, totalCount);
										done();
									}
								});
								gzip.end(item.gzip);
							}
						}, function (err) {
							start = items[items.length - 1].end + " ";
							logger.debug("done with this loop", err || "");
							loggerS3.debug("Closing Streams - start");
							close_remaining_s3_streams(() => {
								loggerS3.debug("Closing Streams - done");
								if (err) {
									pass.emit("error", err);
								} else {
									done();
								}
							});
						});
					});
				}, (err) => {
					logger.debug("Calling Pass.end");
					if (err) logger.error(err);
					pass.end();
				});
			} else {
				logger.debug("no events");
				pass.end();
				return;
			}
		});




		return pass;
	}

	public createSource<T, R = any>(fn: CreateSourceFunction<T, R>, opts?: CreateSourceOptions, state?: R | (() => Promise<R>)): ReadableStream<T> {
		const ls = this.ls;
		let log = logger.sub("CreateSource");
		// Set default option values
		opts = Object.assign({
			records: Number.POSITIVE_INFINITY,
			milliseconds: undefined
		}, opts);

		// Counter/Timers
		let startTime = Date.now();
		let lastStart = startTime;
		let totalRecords = 0;

		// Stream pass through - This is the returned object
		let pass = ls.passThrough({ objectMode: true }) as unknown as CreateSourcePassThrough<T>;


		// Setup a timeout if requested
		let timeout;
		if (opts.milliseconds != null && opts.milliseconds > 0) {
			timeout = setTimeout(() => {
				if (!pass.isEnding) {
					log.debug('Requested timeout ms hit. Ending');
					pass.end();
				}
			}, opts.milliseconds);
		}

		// Override stream end to cleanup timers
		// and protect agains duplicate calls
		pass.isEnding = false;
		pass.orig_end = pass.end;
		pass.end = function () {
			log.debug('Pass.end Called');
			if (!pass.isEnding) {
				pass.isEnding = true;
				timeout && clearTimeout(timeout);
				pass.orig_end();
			}
			return this;
		} as {
			(cb?: () => void): CreateSourcePassThrough<T>;
			(chunk: any, cb?: () => void): CreateSourcePassThrough<T>;
			(chunk: any, encoding?: BufferEncoding, cb?: () => void): CreateSourcePassThrough<T>;
		};


		// Convience method for async writting with backpressure
		pass.throttledWrite = function (data: T) {
			return new Promise((resolve) => {
				if (!pass.write(data)) {
					pass.once('drain', () => {
						resolve(undefined);
					});
				} else {
					resolve(undefined);
				}
			});
		};

		let initStateFn;
		if (typeof state === "function") {
			initStateFn = state;
		} else {
			initStateFn = () => state;
		}

		// Generator to poll for more data
		async function* poller() {
			let state = await initStateFn();
			// Get the initial set of data to stream
			let records = await fn(state);

			// Loop yielding and fetching records until 
			// 1) There are no more recrods
			// 2) Time runs out
			// 3) We have yielding the requested number of records
			outerLoop:
			while ((records != null && records.length > 0) && opts.records > totalRecords && !pass.isEnding) {
				for (const hit of records) {
					totalRecords++;

					// send the results back to the caller and wait to be resumed
					// that's why this is a generator function (function*)
					yield hit;

					// Break out of the current batch because we hit 
					// an end condition
					if (opts.records <= totalRecords || pass.isEnding) {
						break outerLoop;
					}
				}

				log.debug(`Batch Records: ${records.length}, Percent: ${totalRecords}/${opts.records}, Total Duration: ${Date.now() - startTime}, Batch Duration ${Date.now() - lastStart}`);
				lastStart = Date.now();

				// Get the next set of records
				records = await fn(state);
			}
		}

		// Async function to query and write data to the stream
		let run = (async function () {
			for await (const data of poller()) {
				await pass.throttledWrite(data);
			}
		});

		// Start running the async function with hooks to pass along errors
		// and end the pass through
		run()
			.then(() => pass.end())
			.catch(err => pass.emit('error', err));

		return pass;
	}
}

/**
 * Adds range and idOffset to an s3 item
 * @param item 
 * @param start 
 * @param usingSnapshot 
 */
function getRangeAndOffset(item: LeoStreamRecord, start: string, usingSnapshot: boolean) {
	if (item.end.localeCompare(start) > 0) {
		let prefix: string;
		let idOffset: number;
		if (item.start) {
			let _parts = item.start.split(/-/);
			prefix = _parts[0];
			idOffset = parseInt(_parts[1]);
		}

		let createEId = null;
		if (usingSnapshot) {
			createEId = function (eid) {
				return "_snapshot/" + prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
			};
		} else {
			createEId = function (eid) {
				return prefix + "-" + (pad + (idOffset + eid)).slice(padLength);
			};
		}
		let fileOffset = null;
		let fileEnd = item.gzipSize;

		if (item.storageType === StorageType.S3) {
			for (let i = 0; i < item.offsets.length; i++) {
				var offset = item.offsets[i];

				let endEID;
				if (item.archive) {
					endEID = offset.end;
				} else {
					endEID = createEId(offset.end);
				}

				if (start.localeCompare(endEID) < 0) {
					if (fileOffset == null) {
						fileOffset = offset.gzipOffset;
						idOffset += offset.start;
					}
				}
			}

			// var file = item.s3;
			// file.range = `bytes=${fileOffset}-${fileEnd}`;
			// file.idOffset = idOffset;
		} else if (item.storageType === StorageType.Gzip) {
			fileOffset = 0;
		}

		return {
			prefix,
			range: `bytes=${fileOffset}-${fileEnd}`,
			idOffset: idOffset,
		};
	}
}
