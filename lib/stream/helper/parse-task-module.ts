import { createReadStream } from "fs";
import * as workerThreads from "worker_threads";
import split from "split2";
import { PassThrough, pipeline, Writable } from "stream";
import { createGunzip, createGzip } from "zlib";
import { createParser, ParserName, parsers } from "./parser-util";
const { parentPort, workerData } = workerThreads as { parentPort: any, workerData: ParseWorkerData };
let gunzip = createGunzip;
let pipe = pipeline;

interface ParseWorkerData {
	id: number;
	bufferSize?: number;
	parser: string;
	parserOpts: any;
}

if (parentPort) {
	let callbacks = {};
	//let prefix = `Parse Worker ${workerData.id}:`;
	// let l = console.log.bind(console);
	// console.log = function (...args) {
	// 	args.unshift(prefix);
	// 	return l(...args);
	// };

	// Size of data to push to the parent thread in one message
	let bufferSize = workerData.bufferSize || 1048576;

	const JSONparse = createParser({
		parser: workerData.parser,
		opts: workerData.parserOpts
	});

	interface Task {
		id: number;
		filePath?: string;
		// s3?: {
		// 	key: string;
		// 	bucket: string;
		// };
		gzip?: string
		queue: string;
	}
	interface Message {
		event: string;
		data: Task
	}

	// Handlers for all the messages that can be sent to this module
	let events = {
		// Task to parse a file stream
		parse: (task: Task) => {

			let steps: any[] = [
				(() => {
					if (task.filePath) {
						return createReadStream(task.filePath);
					} else if (task.gzip) {
						let pass = new PassThrough();
						pass.end(task.gzip);
						return pass;
					} else {
						let pass = new PassThrough();
						pass.end();
						return pass;
					}
				})(),
				gunzip(),
				split((value) => {
					try {
						let obj = JSONparse(value);
						if (obj.event == null) {
							obj.event = task.queue;
						}
						return obj;
					} catch (e) {
						//If we cancel the download early, we don't want to die here.
						return null;
					}
				}),
				((size: number) => {
					let buffer = [];
					let bufferByteSize = 0;
					return new PassThrough({
						objectMode: true,
						transform(chunk, _encoding, callback) {
							buffer.push(chunk);
							bufferByteSize += chunk.size;

							// emit a chunk if we passed the buffer size
							if (bufferByteSize >= size) {
								//if (buffer.length >= size) {
								//console.log("emitting", buffer.length, bufferByteSize);
								bufferByteSize = 0;
								callback(null, buffer.splice(0));
							} else {
								callback();
							}

						},
						flush(callback) {
							//flush the final chunk of data 
							callback(null, buffer);

						},
					});
				})(bufferSize),
				new Writable({
					objectMode: true,
					write(obj, _e, done) {
						// Save the callback for this request
						// so it can continue when the parent thread says 
						// it can receive more data
						callbacks[task.id] = (err) => {
							//console.log(task.id, "Write Callback returned");
							delete callbacks[task.id];
							done(err);
						};

						//console.log(task.id, "Write Callback called");
						// Send the data to the parent thread
						parentPort.postMessage({
							id: task.id,
							event: "data",
							data: obj
						});
					}
				})
			];

			(pipe as any)(
				...steps as any,
				(err) => {
					//console.log(task.id, "task end", err || "", task.filePath);
					// Send to the parent that the stream is done
					parentPort.postMessage({
						id: task.id,
						event: "end",
						error: (err != null && typeof err != "string") ? Object.getOwnPropertyNames(err).reduce((e, f) => { e[f] = err[f]; return e; }, {}) : err
					});
				}
			);
		},
		pushed: (data: { id: number, err: any, data: any }) => {
			// Calls the saved callback to continue the stream
			callbacks[data.id](data.err, data.data);
		}
	};

	//console.log("Started");
	// Main message processor
	parentPort.on('message', (message: Message) => {
		// Routes events to the proper handler
		events[message.event](message.data);
	});
}
