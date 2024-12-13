import { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync } from "fs";
import * as workerThreads from "worker_threads";
import split from "split2";
import { PassThrough, pipeline, Readable, Writable } from "stream";
import zlib from "zlib";
import { S3 } from "@aws-sdk/client-s3";
import { basename, dirname, extname, resolve } from "path";
import { execSync } from "child_process";
const { parentPort, workerData } = workerThreads as { parentPort: any, workerData: DownloadWorkerData };
const { createGunzip: gunzip, createGzip: gzip, gzipSync } = zlib;

let pipe = pipeline;

interface DownloadWorkerData {
	awsS3Config: any;
	id: number;
	payloadAtEnd: boolean;
	unzipFiles: boolean;
	concurrency?: number;
	requestId?: string;
}


let stringify = () => new PassThrough({
	objectMode: true,
	transform(chunk, _encoding, callback) {
		callback(null, JSON.stringify(chunk) + "\n");
	},
});

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
	let s3 = new S3(workerData.awsS3Config);
	const tryFinalizeMultipartUpload = async (file) => {
		//logger.debug("MultipartUpload Start", file);
		let bucket = file.bucket || file.Bucket;
		let key = file.key || file.Key;
		let mpResponse = await s3.listMultipartUploads({
			Bucket: bucket,
			Prefix: key
		});
		if (mpResponse.Uploads.length) {
			let file = mpResponse.Uploads[0];
			let allParts = await s3.listParts({
				Bucket: bucket,
				Key: file.Key,
				UploadId: file.UploadId
			});
			let parts = allParts.Parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber }));
			if (parts.length > 0) {
				let params = {
					Bucket: bucket,
					Key: file.Key,
					UploadId: file.UploadId,
					MultipartUpload: {
						Parts: parts
					}
				};
				//console.log("MultipartUpload params:", params);
				await s3.completeMultipartUpload(params);
				//logger.log(`MultipartUpload Complete:`, bucket, file.Key, file.UploadId);
			}
		}
	};
	const fromS3 = function (file) {
		let pass = new PassThrough();

		(async () => {
			let obj = await s3.getObject({
				Bucket: file.bucket || file.Bucket,
				Key: file.key || file.Key,
				Range: file.range || undefined
			});
			let stream = obj.Body as Readable;
			stream.destroy = stream.destroy || (stream as any).close || (() => {
				(obj as any).abort();
			});
			// [
			// 	"httpHeaders",
			// 	"httpUploadProgress",
			// 	"httpDownloadProgress"
			// ].map(event => {
			// 	obj.Body.on(event, (...args) => {
			// 		stream.emit(event, ...args);
			// 	});
			// });
			stream.on("error", async (err: any) => {
				let passAlong = true;
				if (err.code === "NoSuchKey" || err.name === "NoSuchKey") {
					try {
						await tryFinalizeMultipartUpload(file);
						passAlong = false;
						stream.unpipe(pass);
						let newStream = (await s3.getObject({
							Bucket: file.bucket || file.Bucket,
							Key: file.key || file.Key,
							Range: file.range || undefined
						})).Body as Readable;
						newStream.on("error", err => pass.emit("error", err));
						pipe(newStream, pass);
					} catch (err) {
						console.error("Error Looking for partial Multipart Upload", err);
					}
				}
				if (passAlong) {
					pass.emit("error", err);
				}
			});
			stream.pipe(pass);
		})();
		return pass;
	};

	//let prefix = `${workerData.requestId || ""}Download Worker ${workerData.id}:`;
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
							err ? reject(err) : resolve();
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

