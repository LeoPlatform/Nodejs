import { RStreamsSdk } from "../..";
let fanout: any = null;
let sdk = new RStreamsSdk();


/**
 * Main Bot -> Thread 1 ->   Main Bot for finalize
 *          -> Thread 2 ->   Main Bot for finalize
 */

// 1 bot w/ 1 thread per instance
// where main bot feeds events to each thread
export async function handler(event: any) {
	await sdk.streams.pipeAsync(
		sdk.read("bot1", "my-source-queue"),
		fanout(
			processor,
			function getShardData(event) { return event.payload.item_id; },
			function filter(event) {
				// event.new.images <> event.old.images
				return true;
			})
	);
}

export async function processor() {
	return sdk.streams.throughAsync(async (event) => {
		// do work on event
	});
}


export async function handler3() {
	await sdk.streams.pipeAsync(
		sdk.read("custom-bot", "some-queue"),
		sdk.throughAsync(),
		sdk.streams.devnull()
	);
}

export async function handler4() {
	//await sdk.readWithFanout("id", "queue", processor, filter);
}


/**
 * Main Bot Broker -> Queue for Bot 1 -> Bot 1 -> ...
 *                 -> Queue for Bot 2 -> Bot 2 -> ...
 * 
 * 
 * Broker -> Queue 1   -> Bot 1 (Deprecate & write to 1.1/1.2)
 *        -> Queue 1.1 -> Bot 1.1
 *        -> Queue 1.2 -> Bot 1.2
 *        -> Queue 2   -> Bot 2
 * 
 * Good:
 * Gets rid of the need to skip events
 * Broker keeps shard state
 * 
 * Bad:
 * Botmon bloat
 * Adds an extra step to each flow
 * 
 * Questions:
 * 	What about when we get behind?
 * 
 */
export async function handler2(event: any) {
	await sdk.enrichEvents({
		id: "bot2",
		inQueue: "my-source-queue",
		outQueue: "my-dest-queue",
		async transform(payload, wrapper,) {

		},
	});
}




/***
 *  Producer -> Kinesis -> Shard 1 -> Broker -> Bot 1
 *                      -> Shard 2 -> Broker -> Bot 2
 */
