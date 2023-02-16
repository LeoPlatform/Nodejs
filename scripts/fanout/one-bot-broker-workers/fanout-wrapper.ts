import { Context } from "aws-lambda";
import { BotInvocationEvent, Callback } from "../../../lib/types";
import { cpus } from "os";
import { RStreamsSdk } from "../../../index";
import bigInt from "big-integer";
import { createHash } from "crypto";
import { resolve } from "path";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, WriteStream } from "fs";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { Stream } from "stream";
import * as refUtil from "../../../lib/reference";
let state: {
	shardId: string;
	checkpoints: Record<string, string>;
};

async function saveWorkerState() {
	let shardId = workerData.shardId;
	writeFileSync(resolve(`./${shardId}.state.json`), JSON.stringify(state, null, 2));
}

async function getWorkerState() {
	let shardId = workerData.shardId;
	let state;
	try {
		state = JSON.parse(readFileSync(resolve(`./${shardId}.state.json`)).toString());
	} catch (e) {
		state = {};
	}
	return Object.assign({ shardId: shardId, checkpoints: {} }, state);
}

if (!isMainThread) {
	let shardId = workerData.shardId;

	global.isOverride = function (ls) {
		// override the sdk


		let origFromLeo = ls.fromLeo.bind(ls);
		let origCronCheckpoint = ls.cron.checkpoint.bind(ls.cron);
		ls.cron.checkpoint = function (id, event, params, callback) {
			event = refUtil.ref(event).id;
			console.log(shardId, "checkpointing", id, event, params);
			state.checkpoints[event] = params.eid;
			// Delete all files where end is before checkpoint
			callback();
		};
		ls.fromLeo = function (bot, queue, opts) {
			queue = refUtil.ref(queue).id;
			let dir = resolve(`./${shardId}/${queue}/`);

			// TODO: What if there the start doesn't match the files?
			let startEid = opts.start || state.checkpoints[queue] || sdk.streams.eventIdFromTimestamp(Date.now(), "date");
			let files = readdirSync(dir)
				.map(f => parseFileName(dir, f))
				.filter(f => startEid < f.endEid)
				.map(f => f.path);

			let prevFile = "";
			let stats;
			let stream = sdk.streams.pipeline(
				sdk.createSource(async (state) => {
					let files = state.files;
					state.files = [];
					return files;
				}, {}, { files: files }),
				flatMap((file: string) => {
					if (prevFile) {
						console.log(shardId, "Should Delete file:", prevFile);
					}
					prevFile = file;
					console.log(shardId, "Opening file:", file);
					return createReadStream(file);
				}) as any,
				sdk.streams.parse() as any,
				sdk.streams.throughAsync(async (event: { eid: string }) => {
					if (event.eid > startEid) {
						return event;
					}
				}),
				stats = sdk.streams.stats(bot, queue)
			) as any;

			stream.checkpoint = stats.checkpoint.bind(stats);
			stream.get = stats.get.bind(stats);
			return stream;
		};
	};
}

function flatMap<T, U>(fn: (data: T) => Stream): Stream {
	let pass = sdk.streams.passThrough({ objectMode: true });
	return sdk.streams.pipeline(
		sdk.streams.through((data: T, done) => {
			sdk.streams.pipe(
				fn(data),
				sdk.streams.write((data, done) => {
					if (!pass.write(data)) {
						pass.once("drain", () => done());
					} else {
						done();
					}
				}),
				done
				// (err) => {
				// 	if (err) {
				// 		done(err);
				// 	} else if (flush) {
				// 		flush(data, done);
				// 	} else {
				// 		done(err);
				// 	}
				// }
			);
		}),
		pass
	);
}
let sdk = new RStreamsSdk();

export interface FanoutInvocationEvent extends BotInvocationEvent { }
export declare type Fn = (event: FanoutInvocationEvent, context: Context) => Promise<void>;

export interface FanoutConfiguration {
	instances?: () => number;
	eventPartition: (event) => string | number
}


/**
 * Fanout wrapper
 * 1) Starts broker
 * 2) Starts workers
 * 
 * @param fn 
 * @returns 
 */
export default function (fn: Fn, config: FanoutConfiguration): Fn {
	return async (event, context) => {
		fixInstanceForLocal(event.__cron);
		let id = getId(event);
		console.time(`${id}-duration`);
		console.log(id, "Start");
		try {
			if (isMain(event)) {
				await runMain(event, config);
			} else {
				await runWorker(fn, event, context);
			}
		} catch (err) {
			console.log(id, err);
		} finally {
			console.log(id, "End");
			console.timeEnd(`${id}-duration`);
		}
	};
}

export function getId(event: FanoutInvocationEvent) {
	return event.__cron.iid == null ? "main" : event.__cron.iid;
}

function isMain(event: FanoutInvocationEvent): boolean {
	return event.__cron.iid == null;
}

async function runMain(event: FanoutInvocationEvent, config: FanoutConfiguration) {
	let id = getId(event);
	console.log(id, "running main");

	let workerData = getWorkerData(event, config);

	// Start Broker
	let broker = runBroker(event, workerData, config);

	// Start workers
	let workers = workerData.shards.map((shard, index) => {
		return startWorker(shard.ShardId, workerData.instances);
	});

	await Promise.allSettled([broker].concat(workers.map(w => w.finished)));
}

function startWorker(shardId: string, count: number) {
	let iid = shardId;
	console.log(`Invoking ${iid}/${count}`);
	let worker = new Worker(process.argv[1], {
		workerData: {
			shardId: shardId,
			count: count
		},
		env: Object.assign({}, process.env, {
			FANOUT_iid: iid,
			FANOUT_icount: count,

			//FANOUT_maxeid: newEvent.__cron.maxeid,
			//runner_keep_cmd: true
		}),
		execArgv: process.execArgv
	});
	// let worker = require("child_process").fork(process.argv[1], process.argv.slice(2), {
	// 	cwd: process.cwd(),
	// 	env: Object.assign({}, process.env, {
	// 		FANOUT_iid: iid,
	// 		FANOUT_icount: count,

	// 		//FANOUT_maxeid: newEvent.__cron.maxeid,
	// 		//runner_keep_cmd: true
	// 	}),
	// 	execArgv: process.execArgv,
	// 	//stdio: [s, s, s, 'ipc'],
	// 	//shell: true
	// });

	return {
		shardId,
		worker,
		finished: new Promise<any>((resolve, reject) => {
			try {
				// Fork process with event
				let responseData = {};
				worker.on("error", reject);
				worker.once("exit", (code) => {
					console.log(`Done with child instance ${iid}/${count}`);
					console.log("[responseData]", responseData);
					if (code !== 0) {
						reject(new Error(`Worker stopped with exit code ${code}`));
					} else {
						resolve(responseData);
					}
				});
			} catch (err) {
				reject(err);
			} finally {
				console.log(`Finished ${iid}/${count}`);
			}
		})
	};
}


interface QueueSummary {
	queue: string;
	eid: string;
	records: string;
	bytes: string;
}

interface WorkerData {
	instances: number,
	shards: {
		ShardId: string;
		ParentShardId?: string;
		HashKeyRange: {
			StartingHashKey: string;
			StartingHashKeyValue: bigInt.BigInteger;
			EndingHashKey: string;
			EndingHashKeyValue: bigInt.BigInteger;
		},
		queues: Record<string, QueueSummary>;
		// producerEid: string;
		// lagRecords: number;
		// lagBytes: number;
	}[]
}

function getWorkerData(event: FanoutInvocationEvent, config: FanoutConfiguration): WorkerData {
	let instanceFn = config.instances ? config.instances : (_event: FanoutInvocationEvent) => cpus().length - 1;
	let instanceCount = instanceFn(event);


	let shards = [];
	let start = bigInt("0", 10);
	let end = bigInt("340282366920938463463374607431768211455", 10);

	let stepSize = end.divide(instanceCount);

	let current = start;
	for (let i = 0; i < instanceCount; i++) {
		let s = current;
		current = current.plus(stepSize);
		let e = current;
		let shardId = "shardId-" + i.toString().padStart(12, "0");
		let shardData = getShardDataFromFiles(shardId);
		shards.push({
			ShardId: shardId,
			HashKeyRange: {
				StartingHashKey: s.toString(10),
				StartingHashKeyValue: s,
				EndingHashKey: e.toString(10),
				EndingHashKeyValue: e
			},
			queues: shardData
			// producerEid: shardData.eid,
			// lagRecords: shardData.records,
			// lagBytes: shardData.bytes
		});

		current = current.plus(1);
	}
	//console.log(shards);
	return {
		instances: instanceCount,
		shards: shards
	};
}

interface FileRecord {
	path: string;
	size: number;
	records: number;
	startEid: string;
	endEid: string;
}

interface CurrentFile {
	stream: WriteStream;
	meta: FileRecord;
}

interface ShardData {
	files: FileRecord[],
	currentFile: CurrentFile
}

const tenMB = 1024 * 1024 * 10;
function createFileStream(shard: string, queue: string, eid: string): CurrentFile {
	let [_, year, month, day, hour, minute, ts] = eid.split("/");
	let path = resolve("./", `${shard}/${refUtil.ref(queue).id}/${ts}.jsonl`);
	return {
		stream: sdk.streams.pipeline(
			sdk.streams.stringify(),
			createWriteStream(path)
		) as WriteStream,
		meta: {
			path,
			size: 0,
			records: 0,
			startEid: eid,
			endEid: eid
		}
	};
}

async function getStream(shard: string, queue: string, cache: Record<string, ShardData>, eid: string) {
	if (!(shard in cache)) {
		mkdirSync(resolve(`./${shard}/${refUtil.ref(queue).id}`), { recursive: true });
		cache[shard] = {
			files: [],
			currentFile: createFileStream(shard, queue, eid)
		};
	}

	let data = cache[shard];

	if (data.currentFile.meta.size > tenMB) {
		await closeStream(shard, queue, data, eid);
	}

	return data.currentFile;
}

async function closeStream(shard: string, queue: string, data: ShardData, eid?: string) {
	await new Promise(resolve => data.currentFile.stream.end(() => resolve(undefined)));
	let [_, year, month, day, hour, minute, ts] = data.currentFile.meta.endEid.split("/");
	let currentPath = data.currentFile.meta.path;
	data.currentFile.meta.path = data.currentFile.meta.path.replace(/(\.jsonl(?:\.gzip)?)$/, `_${ts}_${data.currentFile.meta.records}_${data.currentFile.meta.size}$1`);
	renameSync(currentPath, data.currentFile.meta.path);
	data.files.push(data.currentFile.meta);
	if (eid != null) {
		data.currentFile = createFileStream(shard, queue, eid);
	} else {
		data.currentFile = null;
	}

}

async function closeAllStreams(cache: Record<string, ShardData>) {
	let summaries = await Promise.all(Object.entries(cache).map(async ([shard, data]) => {
		// data.files.push(data.currentFile.meta);
		// await new Promise(resolve => data.currentFile.stream.end(() => resolve(undefined)));
		await closeStream(shard, "", data);
		let summary = data.files.reduce((a, b) => ({ size: a.size + b.size, records: a.records + b.records }), { size: 0, records: 0 });
		console.log(shard, data.files.length, summary);
		return summary;
	}));
	let fullSummary = summaries.reduce((a, b) => ({ size: a.size + b.size, records: a.records + b.records }), { size: 0, records: 0 });
	console.log("full summary", fullSummary);
}

function parseFileName(dir: string, file: string) {
	let [start, end, records, bytes] = file.split(/[_.]/);
	let [startTs, startOffset] = start.split("-").map(i => parseInt(i));
	let [endTs, endOffset] = end.split("-").map(i => parseInt(i));

	if (!endTs) {
		endTs = startTs;
		endOffset = startOffset;
	}

	return {
		path: resolve(dir, file),
		startEid: sdk.streams.eventIdFromTimestamp(startTs, "full", startOffset),
		endEid: sdk.streams.eventIdFromTimestamp(endTs, "full", endOffset),
		records: parseInt(records) || 0,
		bytes: parseInt(bytes) || 0
	};
}

function getShardDataFromFiles(shardId: string): Record<string, QueueSummary> {

	let path = resolve("./", `${shardId}/`);
	if (!existsSync(path)) {
		return {};
	}
	let summaries = readdirSync(path).map(queue => {
		let files = readdirSync(resolve(path, queue)).map(file => {
			return parseFileName(path, file);
		});
		return files.reduce((summary, file) => {
			summary.eid = file.endEid;
			summary.records += file.records;
			summary.bytes += file.bytes;

			return summary;
		}, {
			queue: queue,
			eid: "",
			records: 0,
			bytes: 0
		});
	}).reduce((all, one) => {
		if (one) {
			all[one.queue] = one;
		}
		return all;
	}, {});

	// let files = readdirSync(path).map(file => {
	// 	return parseFileName(path, file);
	// });

	return summaries;

}

function getBrokerStartPosition(queue: string, workerData: WorkerData) {
	let startPosition = workerData.shards.reduce<string>((startPosition, shard) => {
		let queueData = shard.queues[refUtil.ref(queue).id];
		if (queueData) {
			let eid = queueData.eid;
			if (startPosition == null || eid > startPosition) {
				startPosition = eid;
			}
		}
		return startPosition;
	}, null);
	return startPosition;
}

async function runBroker(event: FanoutInvocationEvent, workerData: WorkerData, config: FanoutConfiguration) {
	let id = getId(event);
	console.log(id, "running broker");

	let cache = {};
	let queue = "order-entity-old-new";

	let eid;
	let eventCounter = 0;
	let start = getBrokerStartPosition(queue, workerData);
	await sdk.streams.pipeAsync(
		sdk.read("JUNK", queue, {
			fast_s3_read: true,
			start: start,//"z/2022/10/29/00/00",//sdk.streams.eventIdFromTimestamp(Date.now() - (1000 * 60 * 60 * 24 * 2)),
			_parse: (data) => {
				return {
					eid: +data.match(/"eid":(\d+)/)[1],
					payload: {
						new: { suborder_id: +data.match(/"suborder_id":(\d+)/)[1] }
					},
					__data: data,
					size: Buffer.byteLength(data)
				};
			}
		} as any),
		sdk.streams.throughAsync(async (event) => {
			eventCounter++;
			if (eventCounter % 1000 == 0) {
				console.log(eventCounter, event.eid);
			}
			eid = event.eid;
			let partitionData = config.eventPartition(event).toString();
			let hash = bigInt(createHash("md5").update(partitionData).digest("hex"), 16);
			let shard = workerData.shards.find(s => s.HashKeyRange.StartingHashKeyValue <= hash && s.HashKeyRange.EndingHashKeyValue >= hash) || workerData.shards[0];

			let file = await getStream(shard.ShardId, queue, cache, event.eid);
			file.meta.records++;
			file.meta.endEid = event.eid;
			file.meta.size += typeof event === "string" ? Buffer.byteLength(event) : ((event as any).size || JSON.stringify(event).length);
			let isOk = file.stream.write(event);
			if (!isOk) {
				await new Promise(resovle => file.stream.once("drain", () => resovle(undefined)));
			}
		}),
		sdk.streams.devnull()
	);
	console.log(id, "done Reading", eid);
	await closeAllStreams(cache);
}

async function runWorker(fn: Fn, event: FanoutInvocationEvent, context: Context) {
	let id = getId(event);
	console.log(id, "running worker");
	//let folder = resolve("./", `${id}/`);
	//let files = readdirSync(folder);
	// global.fanoutOverrides = {
	// 	fromLeoDbQueryFn: function (params, callback) {
	// 		callback(null, {
	// 			Items: []
	// 			// files.map(file => {
	// 			// 	return { Items: [] };
	// 			// })
	// 		});
	// 	}
	// 	// fromLeo: function (ID, queue, opts) {
	// 	// 	console.log("overriden", ID, queue, opts);
	// 	// 	return this.eventstream.readArray([]);
	// 	// }
	// };
	// global.isOverride = function (ls) {
	// 	// override the sdk
	// };
	state = await getWorkerState();
	await fn(event, context);
	await saveWorkerState();
}

function fixInstanceForLocal(cronData) {
	// Get fanout data from process env if running locally
	if (process.env.FANOUT_iid) {
		cronData.iid = process.env.FANOUT_iid.match(/^\d+$/) ? parseInt(process.env.FANOUT_iid) : process.env.FANOUT_iid;
		cronData.icount = parseInt(process.env.FANOUT_icount);
		cronData.maxeid = process.env.FANOUT_maxeid;
	}
}
