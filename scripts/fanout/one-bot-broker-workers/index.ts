import { cpus } from "os";
import { Event } from "../../../lib/types";
import wrapper, { getId } from "./fanout-wrapper";
import { RStreamsSdk } from "../../../index";
import { promisify } from "util";

let sdk = new RStreamsSdk();

interface OldNew<T> {
	old?: T;
	new?: T;
}
interface Order {
	suborder_id: number;
	po_number: string;
	supplier_id: number;
	retailer_id: number;
	items: any[];
}

export const handler = wrapper(async function (event, context) {
	let id = getId(event);
	let queue = "order-entity-old-new";

	console.log(id, "Processing");
	let count = 0;
	let reader;
	await sdk.streams.pipeAsync(
		reader = sdk.read("JUNK", queue, {
			fast_s3_read: true,
			//start: sdk.streams.eventIdFromTimestamp(Date.now() - (1000 * 60 * 60 * 24 * 2)),
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
			count++;
			if (count % 100 === 0) {
				console.log(id, count, event.eid);
			}
		}),
		sdk.streams.devnull()
	);
	await promisify(reader.checkpoint).bind(reader)();
	console.log(id, "total:", count);
}, {
	instances() {
		//return cpus().length;
		return 1;
	},
	eventPartition(event: Event<OldNew<Order>>) {
		return event.payload?.new?.suborder_id || event.payload?.old?.suborder_id;
	},
});
