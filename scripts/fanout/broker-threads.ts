import { createReadStream, createWriteStream, mkdirSync, WriteStream } from "fs";
import { basename, dirname } from "path";
import { BotInvocationEvent, RStreamsSdk } from "../..";

process.env.RSTREAMS_CONFIG_SECRET = "rstreams-us-west-2-clint-bus";

let sdk = new RStreamsSdk();
export const handler = cronWrapper(async function (event: FanoutInvocationEvent) {
	let count = 0;
	let eid;
	console.log("Starting:", JSON.stringify(event));
	await sdk.streams.pipeAsync(
		sdk.read("fanout-broker-threads", "order-entity-old-new", { start: "z/2022/11/29/" }),
		sdk.streams.throughAsync(async (event) => {
			count++;
			eid = event.eid;
			await sleep(10);
			if (count % 100 == 0) {
				console.log(event.eid, count);
			}
		}),
		sdk.streams.devnull()
	);
	console.log(`${event.iid} Events: ${count}, eid: ${eid}`);
});

async function sleep(ms) {
	await new Promise(resolve => setTimeout(() => resolve(undefined), ms));
}


async function broker(instances, channels) {
	let files = {};

	let getShardData = (event) => (event.payload.new || event.payload.old).suborder_id;

	let getShard = (data) => {
		return data % instances;
	};

	let getLocalFileStream = (shard) => {
		if (!(shard in files)) {
			console.log("Creating file stream:", shard);
			//let streamFileName = `./out-data/${shard}-0.jsonl`;
			//mkdirSync(dirname(streamFileName), { recursive: true });
			files[shard] = {
				shard: shard,
				fileCount: 0,
				eventCount: 0,
				stream:
					sdk.streams.pipeline(
						sdk.streams.through((data: any, done) => {
							files[shard].eventCount++;
							//console.log("sending event:", shard, data.eid);
							channels[shard].once("message", () => {
								//console.log("received ok:", shard, data.eid);
								done(null, data);
							});
							channels[shard].send({ data });

							//return data;
						}, (done) => {
							//console.log("sending end:", shard);
							channels[shard].once("message", () => {
								//console.log("received end:", shard);
								done();
							});
							channels[shard].send({ end: true });
						}),
						sdk.streams.devnull()
						//sdk.streams.stringify(),
						//createWriteStream(streamFileName)
					)
			};
		}

		return files[shard].stream;
	};

	let closeAllStreams = async () => {
		let fileAwaits = Object.values(files).map((streamData: { stream: WriteStream }) => {
			return new Promise((resolve, reject) => {
				let stream = streamData.stream;
				delete streamData.stream;
				console.log("Closed Stream:", JSON.stringify(streamData, null, 2));
				stream.end((err) => err ? reject() : resolve(undefined));
			});
		});
		await Promise.all(fileAwaits);
	};


	let count = 0;
	console.time("broker-read");
	await sdk.streams.pipeAsync(
		sdk.read("fanout-broker-threads", "order-entity-old-new", { start: "z/2022/11/29/", fast_s3_read: true }),
		sdk.streams.throughAsync(async (event) => {
			count++;
			let data = getShardData(event);
			let shard = getShard(data);

			let stream = getLocalFileStream(shard);

			let isOk = stream.write(event);

			if (!isOk) {
				await new Promise(resolve => stream.once("drain", () => resolve(undefined)));
			}
		}),
		sdk.streams.devnull()
	);
	console.timeEnd("broker-read");

	console.log("Broker Closing Streams");
	await closeAllStreams();
	console.log("Broker Total:", count);
}

interface FanoutInvocationEvent extends BotInvocationEvent {
	iid?: string;
	icount?: number;
}

function fixInstanceForLocal(cronData) {
	// Get fanout data from process env if running locally
	if (process.env.FANOUT_iid) {
		cronData.iid = parseInt(process.env.FANOUT_iid);
		cronData.icount = parseInt(process.env.FANOUT_icount);
		cronData.maxeid = process.env.FANOUT_maxeid;
	}
}

function startInstance(iid, count) {
	console.log(`Invoking ${iid + 1}/${count}`);
	let worker = require("child_process").fork(process.argv[1], process.argv.slice(2), {
		cwd: process.cwd(),
		env: Object.assign({}, process.env, {
			FANOUT_iid: iid,
			FANOUT_icount: count,
			//FANOUT_maxeid: newEvent.__cron.maxeid,
			//runner_keep_cmd: true
		}),
		execArgv: process.execArgv,
		//stdio: [s, s, s, 'ipc'],
		//shell: true
	});
	return {
		iid: iid,
		channel: worker,
		promise: new Promise((resolve, reject) => {
			try {
				// Fork process with event

				let responseData = {};
				// worker.once("message", (response) => {
				// 	console.log(`Got Response with instance ${iid + 1}/${count}`);
				// 	responseData = response;
				// });
				worker.once("exit", () => {
					console.log(`Done with child instance ${iid + 1}/${count}`);
					console.log("[responseData]", responseData);
					resolve(responseData);
				});
			} catch (err) {
				reject(err);
			}
		})
	};
}

function startInstances(instances): { promise: Promise<void>, channel: any, iid: string }[] {
	let workers = [];
	for (let i = 0; i < instances; i++) {
		workers.push(startInstance(i, instances));
	}
	return workers;
}

function cronWrapper(fn: (event: FanoutInvocationEvent) => Promise<void>): (event: FanoutInvocationEvent) => Promise<void> {
	return async (event) => {
		fixInstanceForLocal(event);
		let instances = event.icount || 0;
		let id = event.iid == null ? "broker" : event.iid;
		try {
			console.log("Cron Start", id);
			if (event.iid == null) {
				if (instances <= 1) {
					await fn(event);
				} else {
					console.log("Broker");
					let workers = startInstances(instances);
					await broker(instances, workers.reduce((all, one) => {
						all[one.iid] = one.channel;
						return all;
					}, {}));
					await Promise.all(workers.map(w => w.promise));
				}
			} else {
				console.log("Fanout --", id);

				let pass = sdk.streams.passThrough({ objectMode: true, highWaterMark: 100 }) as any;
				process.on('message', (msg: any) => {
					if (msg.data) {
						//console.log('processing:', id, msg.data.eid);
						let isOk = pass.write(msg.data);
						if (isOk) {
							process.send({ iid: id });
						} else {
							console.log('draining:', id, msg.data.eid);
							pass.once("drain", () => {
								process.send({ iid: id });
							});
						}
					} else if (msg.end) {
						//console.log('ending:', id);
						pass.end(() => {
							process.send({ iid: id });
						});
					} else {
						console.log('unknown:', id, msg);
					}
				});

				// Read from a file instead
				//let streamFileName = `./out-data/${id}-0.jsonl`;
				sdk.streams.fromLeo = sdk.read = () => {
					//console.log("reading from:", streamFileName);
					return pass;
				};


				await fn(event);
			}
		} catch (e) {
			console.log("Cron Error", id, e);
		} finally {
			console.log("Cron End", id);
			process.disconnect && process.disconnect();
		}
	};
}


let botId = "fanout-broker-threads";
(async () => {
	let id = process.env.FANOUT_iid || "broker";
	console.time(`${id}-handler`);
	await handler({
		botId: botId,
		icount: 15,
		__cron: {
			id: botId,
			name: botId,
			ts: Date.now(),
			ignoreLock: true
		}
	});
	console.log("Handler Exit", id);
	console.timeEnd(`${id}-handler`);
})();
