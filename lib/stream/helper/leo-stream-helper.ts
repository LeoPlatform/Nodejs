import path, { basename, dirname } from "path";
import { WorkerPool } from "./worker-pool";
import { cpus, totalmem } from "os";
import * as async from "async";
import { Stats, createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlink, unlinkSync, writeFileSync } from "fs";
import { Transform, PassThrough } from "stream";
import * as  streamUtil from "../../streams";
import { ReadOptionHooks, ReadOptions, StreamRecord, TransformStream } from "../../types";
import { gunzipSync } from "zlib";
import { RStreamsSdk } from "../../../index";
import { S3ClientConfig } from "@aws-sdk/client-s3";
//import { Worker } from 'worker_threads';
let logger = require("leo-logger")("leo-stream-helper");

const MB = 1024 * 1024;
const GB = MB * 1024;

let { parseTaskModuleContent, downloadTaskModuleContent } = JSON.parse(gunzipSync(Buffer.from(require("./worker-thread-content.js"), "base64")).toString());
// let workerThreadModuleLookup = Object.entries({
// 	// "parse-task-module.js": () => import("./parse-task-module"),
// 	// "download-task-module.js": () => import("./download-task-module"),
// }).reduce((all, [key, fn]) => {
// 	console.log(fn.toString());
// 	all[key] = (fn.toString().match(/\(.*?(\d+)\)/) || ["", key.replace(/\.js$/, "")])[1] + ".js";
// 	return all;
// }, {});
// console.log("Post  import", workerThreadModuleLookup);


export interface ReadHooksParams {
	/**
	 * Configuration for the AWS S3 Client used in the download threads
	 */
	awsS3Config?: S3ClientConfig;

	/**
	 * Amount of space available to use when downloading S3 files.
	 * @default 419430400 (400 MB)
	 */
	availableDiskSpace?: number;

	/**
	 * Can be undefined|1
	 * 
	 * Determines how files are merged to local disk 
	 */
	mergeFileVersion?: number;

	/**
	 * Target file size when merging S3 files to local disk
	 */
	mergeFileSize?: number;

	/**
	 * Number of threads to use to download S3 files
	 */
	downloadThreads?: number;

	/**
	 * number of threads to use to parse string json into objects
	 */
	parseThreads?: number;

	/** 
	 * @ignore
	*/
	payloadAtEnd?: boolean;

	/** 
	 * @ignore
	*/
	unzipFiles?: boolean;

	/** 
	 * Save the local files rather then deleting them after being consumed
	 * @default false
	*/
	saveFiles?: boolean;

	/**
	 * Directory used when downloading files
	 * @default /tmp/rstreams
	 */
	tmpDir?: string;

	/**
	 * Path to the download task code
	 * 
	 * @default internal code
	 */
	downloadTaskPath?: string;

	/**
	 * Path to the parse task code
	 * 
	 * @default internal code
	 */
	parseTaskPath?: string;

	/** 
	 * Weather or not to enable parallel parsing 
	 */
	parallelParse?: boolean;

	/**
	 * Parse Gzip content in threads too.
	 * This flag is not fully supported yet
	 * @ignore
	 */
	parallelParseGzip?: boolean,
	//parallelParseBufferSize?: number;

	/**
	 * Settings for the Parser task
	 */
	parseTaskParser?: {
		/**
		 * Custom options to pass to the parser
		 */
		opts?: any;

		/**
		 * Name of the parser or Path to the parser factory file
		 */
		parser?: string;

		/**
		 * Data size used to send parsed data between threads
		 */
		bufferSize?: number;
	};
}

/**
 * Verify that a task module exists.  If it doesn't save the internal content in a location
 * so that it does exists.  Otherwise worker threads won't work
 * @param taskPath path to that task. can be null
 * @param tmpDir directory to store code if needed
 * @param taskModule code of the task to save if needed
 * @param filename filename to use to look for the module
 * @returns path to the task
 */
function verifyTaskModule(taskPath: string, tmpDir: string, taskModule: string, filename: string) {
	if (taskPath == null) {

		// Check if the entry is available (webpack may package it away)
		let chain = [
			path.resolve(__dirname, `./${filename}`),
			path.resolve("./", `./${filename}`)
		];
		for (let f of chain) {
			let exists = existsSync(f);
			//console.log("Checking File:", f, exists);
			if (exists) {
				taskPath = f;
				break;
			}
		}

		// If there still isn't a module copy the source to the tmp directory
		if (!existsSync(taskPath)) {
			// Copy the source to the tmp code directory
			taskPath = path.resolve(tmpDir, `code/${filename}`);
			//if (!existsSync(taskPath) || (Date.now() - statSync(taskPath).mtime.valueOf()) > (1000 * 60 * 5)) {
			mkdirSync(dirname(taskPath), { recursive: true });
			let fileContent = [
				taskModule.toString(),
				`typeof taskModule === "function" && taskModule(require)`
			].join("\n");
			//logger.log(filename, "\n", fileContent);
			writeFileSync(taskPath, fileContent);
			//}
		}
	}
	logger.debug("Task Path", filename, taskPath);
	return taskPath;
}

interface StatsPlus extends Stats {
	fullpath: string;
}

export function getAllFiles(dirPath: string, arrayOfFiles?: StatsPlus[]): StatsPlus[] {
	let files = existsSync(dirPath) ? readdirSync(dirPath) : [];

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		let fullPath = path.resolve(dirPath, file);
		let stat = statSync(fullPath) as StatsPlus;
		if (stat.isDirectory()) {
			arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
		} else {
			stat.fullpath = fullPath;
			arrayOfFiles.push(stat);
		}
	});

	return arrayOfFiles;
}
const memSizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
function convertBytes(bytes: number) {
	let sign = Math.sign(bytes);
	bytes = Math.abs(bytes);


	if (bytes == 0) {
		return "n/a";
	}

	const i = (Math.floor(Math.log(bytes) / Math.log(1024)));
	if (i == 0) {
		return (bytes * sign) + " " + memSizes[i];
	}
	return ((bytes * sign) / Math.pow(1024, i)).toFixed(1) + " " + memSizes[i];
}

interface LocalFileStreamRecordS3 {
	bucket: string;
	key: string;
	start: string;
	end: string;
	gzipSize: number;
	writeStartEid: boolean;
}
interface LocalFileStreamRecord extends StreamRecord {
	s3Like?: boolean;
	filePrefix?: string;
	localFile: {
		id: number;
		filePath: string;
		readyPromise: PromiseResolver<void>;
		unlinkOnStreamClose?: string[]
		data?: any;
	},
	gzip?: string;
	s3?: LocalFileStreamRecordS3 | LocalFileStreamRecordS3[];
	offsets?: any[];
	s3Parts?: LocalFileStreamRecord[];
	mergeS3GzipSize?: number;
}

interface ExtraHooks<SR extends StreamRecord> {
	onGetEventsAddDownload: (StreamRecords: SR[]) => void
	onGetEventsMerge: (StreamRecords: SR[]) => void | SR[];
	getExtraMetaData: () => {
		availableDiskSpace: number;
		startingDiskSpace: number;
		enddingDiskSpace: number;
	}
}

/**
 * Creates read hooks that use worker threads for downloading and parsing
 * @param settings 
 * @returns 
 */
export function createFastS3ReadHooks(settings: ReadHooksParams): ReadOptionHooks<LocalFileStreamRecord> & ExtraHooks<LocalFileStreamRecord> {
	settings = {
		downloadThreads: Math.max(1, cpus().length - 1),
		payloadAtEnd: false,
		unzipFiles: false,
		saveFiles: false,
		tmpDir: process.env.RSTREAMS_TMP_DIR || "/tmp/rstreams",
		...settings
	};
	let batchId = 0;
	let queryId = 0;
	let taskId = 0;
	let downloadThreads = settings.downloadThreads ?? Math.max(1, cpus().length - 1);
	let parseThreads = settings.parseThreads ?? Math.max(1, cpus().length - 1);
	let downloadTaskPath = verifyTaskModule(settings.downloadTaskPath, settings.tmpDir, downloadTaskModuleContent, "download-task-module.js");
	let parseTaskPath = verifyTaskModule(settings.parseTaskPath, settings.tmpDir, parseTaskModuleContent, "parse-task-module.js");

	let pool = new WorkerPool(
		"Download",
		downloadTaskPath,
		downloadThreads,
		{
			payloadAtEnd: settings.payloadAtEnd,
			unzipFiles: settings.unzipFiles,
			awsS3Config: {
				...settings.awsS3Config,
				// copy over only the credentials options, other credential fields won't serialize
				...(settings.awsS3Config?.credentials ? {
					credentials: {
						accessKeyId: (settings.awsS3Config?.credentials as any).accessKeyId,
						secretAccessKey: (settings.awsS3Config?.credentials as any).secretAccessKey,
						sessionToken: (settings.awsS3Config?.credentials as any).sessionToken,
					}
				} : undefined)
			},
			concurrency: 10,
		}
	);



	let workerLink = {};
	let parsePool = new WorkerPool(
		"Parse",
		parseTaskPath,
		settings.parallelParse ? parseThreads : 0,
		{
			parser: settings.parseTaskParser?.parser,
			parserOpts: settings.parseTaskParser?.opts,
			bufferSize: settings.parseTaskParser?.bufferSize,// ?? settings.parallelParseBufferSize
		},
		{
			data: async (worker, result) => {
				let done = () => {
					worker.postMessage({
						event: "pushed",
						data: {
							id: result.id
						}
					});
				};
				let stream = workerLink[result.id];
				let data = Array.isArray(result.data) ? result.data : [result.data];

				for (let i = 0; i < data.length; i++) {
					if (!stream.push(data[i])) {
						logger.debug(result.id, "parsePool Backpressure - start");
						await new Promise(resolve => stream.once("drain", () => {
							logger.debug(result.id, "parsePool Backpressure - done");
							resolve(undefined);
						}));
					}
				}
				done();
			}
		}
	);

	function poolStream(
		pool: WorkerPool,
		id: number,
		source: ({
			filePath: string;
		} | {
			gzip: string;
		}),
		queue: string) {
		let pass = streamUtil.passthrough({
			objectMode: true,
			highWaterMark: 10000
		});
		workerLink[id] = pass;
		pool.runTask({
			event: "parse",
			data: {
				id,
				//filePath: file,
				...source,
				queue
			}
		}, (err, result) => {
			err = err || result.error;
			delete workerLink[id];
			if (err) {
				logger.error(err);
				pass.emit("error", err);
			} else {
				pass.end();
			}
		});
		return pass;
	}


	interface DownloadTask {
		id: number;
		s3: any;
		filePath: string;
		data?: any;
		fileSize: number;
	}
	let availableDiskSpace = settings.availableDiskSpace ?? Math.floor(MB * (500 * 0.8));
	let s3Dir = path.resolve(settings.tmpDir, `s3/`);
	let cachedS3Files = getAllFiles(s3Dir);
	let usedDiskSpace = 0;

	function freeDiskSpace(size) {
		let prev = usedDiskSpace;
		usedDiskSpace -= size;
		if (usedDiskSpace < availableDiskSpace && prev >= availableDiskSpace) {
			logger.debug("Download Queue - Resuming");
			downloadQueue.resume();
		}
	}

	function useDiskSpace(size) {
		let prev = usedDiskSpace;
		usedDiskSpace += size;
		if (usedDiskSpace >= availableDiskSpace && prev < availableDiskSpace) {
			logger.debug("Download Queue - Pausing");
			downloadQueue.pause();
		}
	}

	let downloadQueue = async.queue(function (task: DownloadTask, callback) {
		logger.debug(task.id, "download task start");

		if (downloadQueue.isExiting) {
			logger.debug(task.id, "download task end - exiting");
			callback();
		} else if (existsSync(task.filePath)) {
			logger.debug(task.id, "download task end - exists");
			callback();
		} else {

			let filesToDownload = Array.isArray(task.s3) ? task.s3.length : 1;
			let diskSpaceNeededToDownload = filesToDownload == 1 ? task.fileSize : task.fileSize * 2;
			logger.debug(task.id, `Disk Space Required file: ${convertBytes(task.fileSize)} needed: ${convertBytes(diskSpaceNeededToDownload)}, files: ${filesToDownload}, used: ${convertBytes(usedDiskSpace)}`, task.filePath);
			useDiskSpace(diskSpaceNeededToDownload);
			let error;
			pool.runTaskAsync<{ error?: any }>(task)
				.then((data) => {
					error = data.error;
				})
				.catch((err) => {
					error = err;
				})
				.finally(() => {
					logger.debug(task.id, "download task end");
					if (filesToDownload > 1) {
						// clean up the tmp files space used to download (they have been deleted already)
						logger.debug("Disk Space Cleaning Extra", task.id, task.fileSize, task.filePath);
						freeDiskSpace(task.fileSize);
					}
					if (error) {
						// on error we remove the file so cleanup the size used
						logger.debug("Disk Space Cleaning Error", task.id, task.fileSize, task.filePath, Object.assign(new Error(), error));
						freeDiskSpace(task.fileSize);
						if (existsSync(task.filePath)) {
							unlinkSync(task.filePath);
						}
					}
					//logger.log(task.id, "done", err || "", task.filePath);
					callback(downloadQueue.isExiting ? undefined : error);
				});
		}
	}, downloadThreads);

	downloadQueue.fullDrain = async function () {
		let tasks = downloadQueue.workersList();
		logger.debug("download queue drain start", tasks.length, !this.idle());
		// tasks.forEach(taskWrapper => {
		// 	let task = taskWrapper.data;
		// 	logger.log("download task destroy:", task.id, JSON.stringify(task));
		// 	// if (task.downloadStream) {
		// 	// 	task.downloadStream.on("error", (err) => {
		// 	// 		// Ignore errors.  This stream was never used
		// 	// 		logger.debug("close_remaining_s3_streams.error Error closing s3 stream:", task.s3.key, err);
		// 	// 		logger.log("destroy download error:", task.id);
		// 	// 	});

		// 	// 	logger.debug("close_remaining_s3_streams.destroy closing s3 stream:", task.s3.key);
		// 	// 	logger.log("destroy download:", task.id);
		// 	// 	task.downloadStream.destroy();
		// 	// }
		// });
		// logger.log("download queue draining", tasks.length, !this.idle());
		//logger.log("HERE", downloadQueue.length());
		this.kill();
		if (!this.idle()) {
			await new Promise(resolve => downloadQueue.drain = () => resolve(undefined));
		}

		logger.debug("download queue drain end");
	};

	let deleteQueue = async.queue(function (task, callback) {
		logger.debug(task, "delete task start");
		unlink(task, (err) => {
			logger.debug(task, "delete task done", err || "");
			// Don't fail when delete fails
			callback();
		});
	}, downloadThreads);

	deleteQueue.fullDrain = async function () {
		let tasks = deleteQueue.workersList();
		logger.debug("delete queue drain start", tasks.length);
		//this._tasks.empty()
		if (!this.idle()) {
			await new Promise(resolve => deleteQueue.drain = () => resolve(undefined));
		}
		logger.debug("delete queue drain end");
	};


	useDiskSpace(cachedS3Files.reduce((t, f) => t + f.size, 0));
	let startingDiskSpace = usedDiskSpace;
	let endingDiskSpace;
	logger.debug(`Total Disk: ${convertBytes(availableDiskSpace)}, Used: ${convertBytes(usedDiskSpace)}, Free: ${convertBytes(availableDiskSpace - usedDiskSpace)}`);

	let parseStreamId = 0;
	let totalGzipBytesSeen = 0;
	return {
		getExtraMetaData() {
			return {
				availableDiskSpace: availableDiskSpace,
				startingDiskSpace: startingDiskSpace,
				enddingDiskSpace: endingDiskSpace,
				...settings
			};
		},
		onStart(data) {
			logger.debug("Hook onStart", data.queue, data.eid);

			if (usedDiskSpace >= availableDiskSpace) {
				logger.time("Disk Space Cleanup - onStart");
				let minNeededFile = data.eid.replace(/\//g, "_");
				let pergeTargetDiskSpace = Math.floor(availableDiskSpace * 0.8);
				logger.debug("Disk Space Cleanup - Removing file before start", data.eid, convertBytes(pergeTargetDiskSpace));
				for (let i = 0; i < cachedS3Files.length; i++) {
					let f = cachedS3Files[i];
					let name = basename(f.fullpath);
					if (name < minNeededFile) {
						logger.debug("Disk Space Cleanup - Removing file before current position", data.eid, name);
						unlinkSync(f.fullpath);
						freeDiskSpace(f.size);
					} else {
						break;
					}
				}
				for (let i = cachedS3Files.length - 1; i >= 0 && usedDiskSpace >= pergeTargetDiskSpace; i--) {
					let f = cachedS3Files[i];
					let name = basename(f.fullpath);
					logger.debug("Disk Space Cleanup - Removing file far ahead of current position", data.eid, name);
					unlinkSync(f.fullpath);
					freeDiskSpace(f.size);
				}

				logger.timeEnd("Disk Space Cleanup - onStart");
			}

		},
		async onEnd() {
			logger.debug("Hook onEnd");
			downloadQueue.isExiting = true;
			await Promise.allSettled([
				downloadQueue.fullDrain(),
				deleteQueue.fullDrain()
			]);
			// Close pool after everything drains
			await pool.close();
			await parsePool.close();

			logger.debug("Hook onEnd - complete");
			logger.debug(`Total Disk: ${convertBytes(availableDiskSpace)}, Used: ${convertBytes(usedDiskSpace)}, Free: ${convertBytes(availableDiskSpace - usedDiskSpace)}`);
			endingDiskSpace = usedDiskSpace;

		},
		// createSplitParseStream2(JSONparse) {
		// 	return split((value) => {
		// 		try {
		// 			let obj = JSONparse(value);
		// 			if (obj != null && obj.size == null) {
		// 				obj.size = Buffer.byteLength(value);
		// 			}
		// 			return obj;
		// 		} catch (e) {
		// 			//If we cancel the download early, we don't want to die here.
		// 			return null;
		// 		}
		// 	});
		// },
		createSplitParseStream(JSONparse, record) {
			if ((record.s3 || record.s3Like) && settings.parallelParse) {
				return new PassThrough({ objectMode: true }) as unknown as TransformStream<string, any>;
			} else if (record.gzip && settings.parallelParse) {
				// TODO: can I create a split and parse for gzip?
				return null;
			} else {
				return null;
			}
		},
		createS3Stream(streamRecord, index) {
			let _parts = streamRecord.start.split(/-/);
			let idOffset = parseInt(_parts[1]);
			if (streamRecord.s3Like) {
				let pass = poolStream(parsePool, ++parseStreamId, { gzip: streamRecord.gzip }, streamRecord.event) as Transform & { idOffset: number, isUnzipped: boolean };
				pass.isUnzipped = true;
				pass.idOffset = idOffset;
				return {
					get: function () {
						return pass;
					},
					on: function (...args) {
						return (pass as any).on(...args);
					},
					destroy: function (...args) {
						return pass.destroy(...args);
					}
				};
			}



			let localFile = streamRecord.localFile.filePath;

			let parallelParse = settings.parallelParse;
			let pass = new PassThrough({ objectMode: parallelParse }) as Transform & { idOffset: number, isUnzipped: boolean };

			pass.idOffset = idOffset;

			pass.isUnzipped = settings.unzipFiles || parallelParse;

			let fileStream;
			let isDestroyed = false;

			let hasPiped = false;
			let passpipe = pass.pipe.bind(pass);
			pass.pipe = function (dest, opts) {
				hasPiped = true;
				return passpipe(dest, opts);
			};
			streamRecord.localFile.readyPromise.then(() => {
				if (!isDestroyed) {
					fileStream = parallelParse ? poolStream(parsePool, ++parseStreamId, { filePath: localFile }, streamRecord.event) : createReadStream(localFile);
					streamUtil.pipe(fileStream, pass, () => {
						let files = streamRecord.localFile.unlinkOnStreamClose || [];
						if (files.length > 0) {
							logger.debug("Disk Space Cleaning unlinkOnStreamClose", streamRecord.gzipSize, localFile);
							freeDiskSpace(streamRecord.gzipSize);

							(files).forEach(f => {
								deleteQueue.push(f);
								//existsSync(f) && unlinkSync(f);
							});
						}
					});
				}
			}).catch(err => {
				if (!isDestroyed) {
					if (hasPiped) {
						pass.emit("error", err);
					} else {
						let pipe = pass.pipe.bind(pass);
						pass.pipe = function (dest, opts) {
							let ret = pipe(dest, opts);
							dest.emit("error", err);
							return ret;
						};
					}
				}
			});
			return {
				get: function () {
					return pass;
				},
				on: function (...args) {
					return (pass as any).on(...args);
				},
				destroy: function (...args) {
					if (fileStream) {
						return fileStream.destroy(...args);
					} else {
						return pass.destroy(...args);
					}
				}
			};
		},
		onGetEvents(streamRecords) {
			logger.debug("onGetEvents", streamRecords.length);
			let mergeVersion = settings.mergeFileVersion;
			if (mergeVersion == 1 && settings.mergeFileSize != 0) {
				streamRecords = this.onGetEventsMerge(streamRecords);
			} else {
				this.onGetEventsAddDownload(streamRecords);
			}


			let id = queryId++;
			(streamRecords as any).queryId = id;
			logger.debug(id, "Start Query");
			return streamRecords;
		},
		onGetEventsMerge(streamRecords) {
			logger.debug("onGetEventsMerge", streamRecords.length);
			let ret = [];
			let maxFileSize = settings.mergeFileSize ?? (5 * 1024 * 1024);
			streamRecords.forEach(r => {
				totalGzipBytesSeen += r.gzipSize;
				if (r.s3 && !Array.isArray(r.s3)) {
					let last = ret[ret.length - 1];

					r.s3.start = r.start;
					r.s3.end = r.end;
					r.s3.gzipSize = r.gzipSize;
					if (totalGzipBytesSeen < (1 * 1024 * 1024) || last == null || !last.s3 || (last.gzipSize + r.gzipSize) > maxFileSize || last.s3.length > 10) {
						r.s3 = [r.s3];
						ret.push(r);
					} else {
						last.s3.push(r.s3);
						last.offsets = last.offsets.concat(r.offsets);
						last.end = r.end;
						last.records += r.records;
						last.gzipSize += r.gzipSize;
						last.size += r.size;
					}
				} else {
					ret.push(r);
				}
			});
			this.onGetEventsAddDownload(ret);
			return ret;
		},
		onGetEventsAddDownload(streamRecords) {
			logger.debug("onGetEventsAddDownload", streamRecords.length);
			streamRecords.forEach(r => {
				if (r.s3) {
					let filePath = path.resolve(settings.tmpDir, `s3/${r.event}/${r.filePrefix || ""}${((r.end)).replace(/\//g, "_") + "-0-" + r.gzipSize}.jsonl.gz`);
					let readyPromise = createPromiseResolver<void>();
					let id = taskId++;
					logger.debug(id, "task push");
					r.localFile = {
						id,
						filePath,
						readyPromise
					};
					readyPromise.catch(() => {
						// Do nothing.  The error is later emitted if piped
					});
					let task: DownloadTask = {
						id: id,
						s3: r.s3,
						//inMem: false,
						filePath,
						fileSize: r.gzipSize
						//data: undefined
					};
					//r.stream = sdk.streams.passThrough();
					downloadQueue.push(task, (err) => {
						logger.debug(id, "download task queue end", err || "");
						if (err) {
							readyPromise.reject(err);
						} else {
							r.localFile.data = task.data;
							readyPromise.resolve();
						}
					});
				} else if (r.gzip && settings.parallelParse && settings.parallelParseGzip) {
					// TODO: Should we pass gzip like s3 to the parallel parser
					r.s3Like = true;
				}
			});

			// let id = queryId++;
			// (streamRecords as any).queryId = id;
			// logger.log(id, "Start Query");
			// return streamRecords;
		},
		onBatchStart(streamRecords) {
			let returnRecords = streamRecords;
			let id = batchId++;
			let rr = (returnRecords as any);
			rr.batchId = id;
			logger.debug(id, "Start batch", rr.queryId);
		},
		onRecordEnd(streamRecord) {
			//Delete local files
			if (!settings.saveFiles && streamRecord.localFile != null) {
				logger.debug("Disk Space Cleaning onRecordEnd", streamRecord.gzipSize, streamRecord.localFile.filePath);
				freeDiskSpace(streamRecord.gzipSize);
				deleteQueue.push(streamRecord.localFile.filePath);
			}
		}
	};
}


/** 
 * Lambda with 10 GB
 * dthreads: 4 | 2
 * pthreads: even 4 | 8 | 2
 * parseBufferSize: 2MB | 1MB (large objects perfer smaller values)
 * fast_s3_parallel_fatch_max_bytes: 100MB (slower parsers eg. JSON.parse prefer smaller values 50MB)
 * mergeFileSize: No Merge //even 2MB | 5MB (2MB by a little)
**/
let totalCpus = cpus().length;
let workerCpus = totalCpus - 1;
let totalMemory = (parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE, 10) * MB) || totalmem();

let lambdaDefaultsByMemory = [
	{
		memory: 10 * GB,
		downloadThreads: 2,
		parseThreads: 4,
		parseBufferSize: 2 * MB,
		parallelFetchMax: 50 * MB
	}, {
		memory: 0,
		// Split CPUs between download and parse
		downloadThreads: Math.max(1, Math.floor(Math.max(1, workerCpus * 0.3))),
		parseThreads: Math.max(1, workerCpus - Math.floor(Math.max(1, workerCpus * 0.3))),
		parseBufferSize: 2 * MB,
		parallelFetchMax: 5 * MB
	}
].sort((a, b) => b.memory - a.memory);

function getLambdaDefaults(memoryAvailable: number) {
	return lambdaDefaultsByMemory.find(d => d.memory <= memoryAvailable) || lambdaDefaultsByMemory[lambdaDefaultsByMemory.length - 1];
}

export interface ExtraConfig {
	tmpDir?: string;
	awsS3Config?: S3ClientConfig
}

/**
 * Addes configured read hooks to the read options
 * @param readOpts 
 * @param partialHookSettings 
 * @param extraConfig 
 * @returns 
 */
export function addReadHooks<T>(readOpts: ReadOptions<T>, partialHookSettings?: Partial<ReadHooksParams>, extraConfig?: RStreamsSdk | ExtraConfig) {
	Object.assign(readOpts, determineReadHooks(readOpts, partialHookSettings, extraConfig));
	return readOpts;
}

/**
 * 
 * @param settings 
 * @param partialHookSettings 
 * @param extraConfig 
 * @returns 
 */
export function determineReadHooks<T>(settings: ReadOptions<T>, partialHookSettings?: Partial<ReadHooksParams>, extraConfig?: RStreamsSdk | ExtraConfig): Partial<ReadOptions<T>> {

	let extraConfiguration: ExtraConfig = {
		tmpDir: process.env.RSTREAMS_TMP_DIR || "/tmp/rstreams"
	};
	let maybeSdk = (extraConfig as RStreamsSdk);
	if (maybeSdk.streams != null && maybeSdk.configuration != null) {
		extraConfiguration.tmpDir = maybeSdk.streams.tmpDir;
		extraConfiguration.awsS3Config = {
			region: maybeSdk.configuration.aws.region,
			credentials: maybeSdk.configuration.credentials
		};
	} else {
		extraConfiguration = {
			...extraConfiguration,
			...extraConfig
		};
	}

	let defaultsFromMem = getLambdaDefaults(totalMemory);
	let parseTaskParser = typeof settings.parser === "string" ? {
		parser: settings.parser,
		bufferSize: MB,
		...partialHookSettings?.parseTaskParser,
		opts: {
			parser: partialHookSettings?.parseTaskParser?.parser || settings.parser,
			...settings.parserOpts,
			...partialHookSettings?.parseTaskParser?.opts
		},
	} : undefined;
	let parallelParse = parseTaskParser != null;

	let downloadThreads = defaultsFromMem.downloadThreads;
	let parseThreads = defaultsFromMem.parseThreads;
	let saveFiles = false;
	let tmpDir = extraConfiguration.tmpDir;

	// Not using them
	let mergeFileSize;
	let mergeFileVersion;

	let awsS3Config = extraConfiguration.awsS3Config;

	let hookSettings: ReadHooksParams = {
		parallelParse,
		//parallelParseBufferSize,
		downloadThreads,
		parseThreads,
		saveFiles,
		tmpDir,
		mergeFileSize,
		mergeFileVersion,
		awsS3Config,
		...(partialHookSettings || {}),

		// last because it is a sub object that we don't want overriden 
		parseTaskParser,
	};

	let readOpts: ReadOptions<T> & { _hookSettings: ReadHooksParams } = {
		hooks: createFastS3ReadHooks(hookSettings),
		_hookSettings: hookSettings
	};
	if (defaultsFromMem.parallelFetchMax > 0) {
		readOpts.stream_query_limit = 1000;
		readOpts.fast_s3_read = true;
		readOpts.fast_s3_read_parallel_fetch_max_bytes = readOpts.fast_s3_read_parallel_fetch_max_bytes || defaultsFromMem.parallelFetchMax;
	}

	// console.log("Hook Params New:", JSON.stringify({
	// 	...readOpts,
	// 	hooks: hookSettings
	// }, null, 2));
	return readOpts;
}


interface PromiseResolver<T> extends Promise<T> {
	resolve: () => void;
	reject: (err?: any) => void;
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



