import { FastParseType, ParserName } from "../lib/stream/helper/parser-util";
import { FastJsonReadEvent, RStreamsSdk, ReadEvent } from "../index";

process.env.RSTREAMS_CONFIG_SECRET = "rstreams-ProdBus";
const MB = 1024 * 1024;
const runTime = 10000;

async function fastReadAutoConfigure() {
	let sdk = new RStreamsSdk();

	await sdk.streams.pipeAsync(
		sdk.read("fast-read-bot", "item-entity-old-new", {
			runTime,
			autoConfigure: true, // Auto configures options for reading based CPU cores, memory, & free disk space
		}),
		sdk.streams.counter(),
		sdk.streams.devnull()
	);
}

async function fastReadAutoConfigureWithValues() {
	let sdk = new RStreamsSdk();

	await sdk.streams.pipeAsync(
		sdk.read("fast-read-bot", "item-entity-old-new", {
			runTime,
			autoConfigure: {
				availableDiskSpace: 400 * MB,
				downloadThreads: 2,
				parseThreads: 2,
				parseTaskParser: {
					bufferSize: 2 * MB
				}
			}
		}),
		sdk.streams.counter(),
		sdk.streams.devnull()
	);
}

async function fastReadFastJsonParser() {
	let sdk = new RStreamsSdk();

	interface OldNew<T> {
		old?: T;
		new?: T;
	}
	interface ItemIds {
		supplier_id: number;
		item_id: number;
	}
	interface Item extends ItemIds {
		quantity_available: number;
		sku: string;
		title: string;
		ean?: string;
		// ...
	}


	const accountIds = new Set([]);
	await sdk.streams.pipeAsync(
		sdk.read("fast-read-bot", "item-entity-old-new", {
			runTime,
			autoConfigure: true,
			/**
			 * FastJson parser allows opts.fields to defined  what fields to parse from the raw data
			 * the resulting event will have a basic event wrapper with the payload containing the defined fields
			 * and an event wrapper field `__unparsed_value___` which is the string value of the entire event
			 * Once all defined fields have been visited, parsing can skip the rest of the event input 
			 */
			parser: ParserName.FastJson,
			parserOpts: {
				fields: [
					{
						"field": "payload.new.supplier_id",
						"type": FastParseType.Number
					}, {
						"field": "payload.new.item_id",
						"type": FastParseType.Number
					}
				]
			},
			//autoConfigure: true
		}),
		sdk.streams.counter(),
		sdk.streams.throughAsync(async (event: FastJsonReadEvent<OldNew<ItemIds>>) => {
			if (accountIds.has(event.payload.new.supplier_id)) {
				// Event Passes filter, parse the entire event if needed
				// Note: __unparsed_value__ contains unprocessed event wrapper data.  Only the `payload` should be used
				let fullOldNewItem: OldNew<Item> = JSON.parse(event.__unparsed_value__).payload;
				await doWorkWithFullItem(event, fullOldNewItem.new);
			}
		}),
		sdk.streams.devnull()
	);
}

async function doWorkWithFullItem(wrapper: ReadEvent<unknown>, payload: any) {
	console.log(wrapper.eid, payload);
}

(async () => {
	let fnNumber = parseInt(process.argv[2] || '1');
	console.log(fnNumber);
	switch (fnNumber) {
		case 1: await fastReadAutoConfigure(); break;
		case 2: await fastReadAutoConfigureWithValues(); break;
		case 3: await fastReadFastJsonParser(); break;
	}

})();
