interface DownloadWorkerData {
	id: number;
	payloadAtEnd: boolean;
	unzipFiles: boolean;
	concurrency?: number;
	requestId?: string;
}
/**
 * module that downloads a set of files to disk
 * @param req require module provided by node, pass in to get around webpack
 */
export function taskModule(req) {
	let { createWriteStream, mkdirSync, unlinkSync, existsSync } = req("fs");
	let { dirname, basename, resolve, extname } = req("path");
	let { execSync } = req("child_process");
	let { parentPort, workerData } = req("worker_threads") as {
		parentPort: any; workerData: DownloadWorkerData
	};
	let aws = req("aws-sdk");
	let { PassThrough, pipeline } = req("stream");
	let { createGunzip: gunzip, createGzip: gzip, gzipSync } = req("zlib");
	let pipe = pipeline;
	let stringify = () => new PassThrough({
		objectMode: true,
		transform(chunk, _encoding, callback) {
			callback(null, JSON.stringify(chunk) + "\n");
		},
	});
	let split = (fn) => {
		let last = "";
		let buffer = [];
		return new PassThrough({
			objectMode: true,
			transform(chunk, _encoding, callback) {
				buffer = buffer.concat((last + chunk).toString().split("\n"));
				last = buffer.pop();
				while (buffer.length && this.push(fn(buffer.shift()))) {
					//empty
				}
				callback();
			},
			flush(callback) {
				if (last) {
					buffer.push(last);
				}
				while (buffer.length) {
					this.push(fn(buffer.shift()));
				}
				callback();

			},
		});
	};

	let concurrency = workerData.concurrency;

	const promiseAllConcurrency = async <T>(queue: (() => Promise<T>)[], concurrency?: number) => {
		if (concurrency == null) {
			concurrency = queue.length;
		}
		let index = 0;
		const results = [];

		// Run a pseudo-thread
		const execThread = async () => {
			while (index < queue.length) {
				const curIndex = index++;
				// Use of `curIndex` is important because `index` may change after await is resolved
				results[curIndex] = await queue[curIndex]();
			}
		};

		// Start threads
		const threads = [];
		for (let thread = 0; thread < concurrency; thread++) {
			threads.push(execThread());
		}
		await Promise.all(threads);
		return results;
	};

	if (parentPort) {
		let s3 = new aws.S3();
		const fromS3 = function (file) {
			let pass = PassThrough();
			let obj = s3.getObject({
				Bucket: file.bucket || file.Bucket,
				Key: file.key || file.Key,
				Range: file.range || undefined
			});
			let stream = obj.createReadStream();
			stream.destroy = stream.destroy || stream.close || (() => {
				obj.abort();
			});
			[
				"httpHeaders",
				"httpUploadProgress",
				"httpDownloadProgress"
			].map(event => {
				obj.on(event, (...args) => {
					stream.emit(event, ...args);
				});
			});
			stream.on("error", async (err) => {
				let passAlong = true;
				// if (err.code === "NoSuchKey") {
				// 	try {
				// 		await ls.tryFinalizeMultipartUpload(file);
				// 		passAlong = false;
				// 		stream.unpipe(pass);
				// 		let newStream = s3.getObject({
				// 			Bucket: file.bucket || file.Bucket,
				// 			Key: file.key || file.Key,
				// 			Range: file.range || undefined
				// 		}).createReadStream();
				// 		newStream.on("error", err => pass.emit("error", err));
				// 		ls.pipe(newStream, pass);
				// 	} catch (err) {
				// 		logger.error("Error Looking for partial Multipart Upload", err);
				// 	}
				// }
				if (passAlong) {
					pass.emit("error", err);
				}
			});
			stream.pipe(pass);
			return pass;
		};

		let prefix = `${workerData.requestId || ""}Download Worker ${workerData.id}:`;
		// let l = console.log.bind(console);
		// console.log = function (...args) {
		// 	args.unshift(prefix);
		// 	return l(...args);
		// };

		let payloadAtEnd = workerData.payloadAtEnd;
		let unzipFiles = workerData.unzipFiles;
		//console.log("Payload At End:", payloadAtEnd);
		//console.log("Zip:", unzipFiles);

		// Main handler to process a file or set of files
		parentPort.on('message', async (task: {
			id: number;
			s3: any;
			filePath: string;
			//data?: any
		}) => {
			mkdirSync(dirname(task.filePath), { recursive: true });
			let s3Files: {
				key: string;
				bucket: string;
				start: string;
				gzipSize: number;
				writeStartEid: boolean;
			}[] = [];

			if (Array.isArray(task.s3)) {
				s3Files = task.s3;
			} else {
				s3Files = [task.s3];
			}

			let error: any;
			//console.log("Downloading files:", s3Files.length, s3Files.reduce((a, b) => a + b.gzipSize, 0), task.filePath);
			let subFiles = [];
			let subFilesPromises: (() => Promise<void>)[] = [];
			try {
				for (let i = 0; i < s3Files.length; i++) {
					let s3 = s3Files[i];
					let ext = extname(task.filePath);
					let filePathPart = resolve(dirname(task.filePath), basename(task.filePath, ext) + `_${i}.` + ext);
					subFiles.push(filePathPart);

					// If there is only 1 file then go directly to the desired file
					if (s3Files.length == 1) {
						filePathPart = task.filePath;
					}

					let steps: any[] = [fromS3(s3)];

					// Note: Didn't help with speed
					if (unzipFiles) {
						steps.push(gunzip());
					}

					// Note: Didn't help with speed
					if (payloadAtEnd) {
						steps.push(...[
							unzipFiles ? gunzip() : null,
							split(e => {
								let o = JSON.parse(e);
								let p = o.payload;
								delete o.payload;
								o.payload = p;
								return o;
							}),
							stringify(),
							gzip(),
						].filter(s => s));
					}

					steps.push(createWriteStream(filePathPart));

					// Write a eid command in the file if merging multiple files
					if (i > 0 || s3.writeStartEid) {
						steps[steps.length - 1].write(gzipSync(`__cmd:eid__${JSON.stringify({ eid: s3.start })}\n`));
					}
					subFilesPromises.push(() => new Promise((resolve, reject) => {
						(pipe as any)(
							...steps as any,
							(err) => {
								err ? reject(err) : resolve(filePathPart);
							}
						);
					}));

				}

				// Await for them all with some concurrency
				await promiseAllConcurrency(subFilesPromises, concurrency);
			} catch (err) {
				error = err;
			} finally {
				//console.log(task.id, "task end", error || "", task.filePath);

				// If there are multiple files then merge them into the one desired file
				if (!error && subFiles.length > 1) {
					try {
						execSync(`cat ${subFiles.map(p => basename(p).replace(/\\/g, "/")).join(" ")} >> ${task.filePath}`, {
							cwd: dirname(task.filePath)
						}).toString("utf-8");
					} catch (err) {
						error = err;
					} finally {
						// Clean up all the files
						subFiles.map(f => existsSync(f) && unlinkSync(f));
					}
				}

				// If there was an error remove the file so it isn't cached
				if (error && existsSync(task.filePath)) {
					unlinkSync(task.filePath);
				}

				//console.log(task.id, "done", err || "", task.filePath);

				// Send a message back to the main thread that we finished
				parentPort.postMessage({
					id: task.id,
					error: (error != null && typeof error != "string") ? Object.getOwnPropertyNames(error).reduce((e, f) => { e[f] = error[f]; return e; }, {}) : undefined
				});
			}
		});
	}
}
