import CronWrapper from "../wrappers/cron";
import { ReadEvent, RSFBotInvocationEvent, RSFQueueBotInvocationEvent, RStreamsContext } from "..";

export const handler = CronWrapper(async (event: RSFQueueBotInvocationEvent, context: RStreamsContext) => {

	let sdk = new RStreamsSdk();
	await sdk.enrichEvents<InData, OutData>({
		id: event.botId,
		inQueue: event.queue,
		outQueue: event.destination,
		autoConfigure: {
			downloadThreads: 10,
			parseThreads: 4
		},
		transform
	});

});
async function transform(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {

	if (payload.new == null) {
		return payload;
	}

	let topStatus: ItemStatus = ItemStatus.OutOfStock;

	for (const retailer in payload.new.per_retailer) {
		const retailerData = payload.new.per_retailer[retailer];
		if (retailerData.quantity > 0) {
			retailerData.status = ItemStatus.InStock;
			topStatus = ItemStatus.InStock;
		} else if (retailerData.quantity <= 0 && retailerData.status === ItemStatus.InStock) {
			retailerData.status = ItemStatus.OutOfStock;
		}
	}

	//If all retailers agree on the status that should be the top level status. Otherwise, the top level status should be OutOfStock
	for (const retailer in payload.new.per_retailer) {
		const retailerData = payload.new.per_retailer[retailer];
		if (retailerData.status !== topStatus) {
			topStatus = ItemStatus.OutOfStock;
			break;
		}
	}

	payload.new.status = topStatus;

	return payload;
}

async function transform2(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {

	if (payload.new == null) {
		return payload;
	}

	let firstStatus: ItemStatus | undefined = undefined;
	let allSame = true;
	let someInStock = false;

	for (const retailer in payload.new.per_retailer) {
		const retailerData = payload.new.per_retailer[retailer];

		if (retailerData.quantity > 0) {
			someInStock = true;
			retailerData.status = ItemStatus.InStock;
		} else if (retailerData.quantity <= 0 && retailerData.status === ItemStatus.InStock) {
			retailerData.status = ItemStatus.OutOfStock;
		}

		if (firstStatus === undefined) {
			firstStatus = retailerData.status;
		} else if (firstStatus !== retailerData.status) {
			allSame = false;
		}
	}

	if (allSame) {
		payload.new.status = firstStatus ?? ItemStatus.OutOfStock;
	} else if (someInStock) {
		payload.new.status = ItemStatus.InStock;
	} else {
		payload.new.status = ItemStatus.OutOfStock;
	}

	return payload.new;
}

interface OldNew<T> {
	old?: T;
	new?: T;
}

enum ItemStatus {
	Hidden = "hidden",
	InStock = "in-stock",
	OutOfStock = "out-of-stock"
}

interface Item {
	item_id: number;
	retailer_id: number;
	quantity: number;
	status: ItemStatus;
	per_retailer: Record<number, RetailerData>;
}

interface RetailerData {
	retailer_id: number;
	name: string;
	status: ItemStatus;
	quantity: number;
}
