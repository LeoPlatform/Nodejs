interface ParseWorkerData {
	id: number;
	bufferSize?: number;
	parser: string;
	parserOpts: any;
}
/**
 * 
 * @param req require function provided by nodejs, passed in to get around webpack
 */
export function taskModule(req) {
	let { createReadStream } = req("fs");
	let { parentPort, workerData } = req("worker_threads") as {
		parentPort: any; workerData: ParseWorkerData
	};

	let { PassThrough, pipeline, Writable } = req("stream");
	let { createGunzip: gunzip, createGzip: gzip } = req("zlib");
	let pipe = pipeline;

	// Splits a stream of data on newlines
	let split = (fn) => {
		let last = "";
		let buffer = [];
		return new PassThrough({
			objectMode: true,
			transform(chunk, _encoding, callback) {
				// Add data to bufer
				buffer = buffer.concat((last + chunk).toString().split("\n"));
				// Save the last chunk as it may not be complete
				last = buffer.pop();

				// push lines as long as the stream can accept it
				while (buffer.length && this.push(fn(buffer.shift()))) {
					//empty
				}

				callback();
			},
			flush(callback) {
				// flush that last chunk of data
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

		// Default parsers
		let parsers = {
			"JSON.parse": JSON.parse,
			"empty": (botId, queue, settings) => (input: string) => {
				return {
					id: "unknown",
					event: queue,
					payload: {}
				};
			},
		};

		let JSONparseInner: (val: string) => any;

		if (typeof workerData.parser === "string") {

			JSONparseInner = parsers[workerData.parser];
			if (JSONparseInner == null) {
				//console.log("PARSER:", workerData.parser);
				// If it isn't one of the default parsers
				// it should be an external module that we can require
				// with a function to call to get the parser
				let parseFn = req(workerData.parser);
				if (typeof parseFn !== "function") {
					let lib = parseFn;
					parseFn = lib.default;
					if (typeof parseFn !== "function") {
						parseFn = parseFn.parser;
					}
				}
				//console.log("PARSER context:", parseFn.toString());
				// Create the inner parser and pass in the parser options
				JSONparseInner = (parseFn)(workerData.parserOpts);
			}
		}

		// Handle eid commands and parse the data
		JSONparseInner = JSONparseInner || JSON.parse;
		const JSONparse = function (str) {
			if (str.startsWith("__cmd:eid__")) {
				let cmd = JSON.parse(str.replace("__cmd:eid__", ""));
				cmd._cmd = "setBaseEid";
				return cmd;
			}
			let r = JSONparseInner(str);

			// Add size in bytes if it doesn't exist
			if (r != null && r.size == null) {
				r.size = Buffer.byteLength(str);
			}
			return r;
		};

		interface Task {
			id: number;
			filePath: string;
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
					createReadStream(task.filePath),
					gunzip(),
					split((value) => {
						try {
							let obj = JSONparse(value);
							if (obj.size == null) {
								obj.size = Buffer.byteLength(value);
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
							callbacks[task.id] = (err, data) => {
								//console.log(task.id, "Write Callback returned");
								delete callbacks[task.id];
								done(err, data);
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
}
