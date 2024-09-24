import { ReadEvent, RSFQueueBotInvocationEvent, RStreamsContext, RStreamsSdk } from "..";
import CronWrapper from "../wrappers/cron";


export const handler = CronWrapper(async (invocationEvent: RSFQueueBotInvocationEvent, context: RStreamsContext) => {

	let sdk = context.sdk;

	await sdk.enrichEvents({
		id: invocationEvent.botId,
		inQueue: invocationEvent.queue,
		outQueue: invocationEvent.destination,
		transform

	});

});

interface OldNew<T> {
	old?: T;
	new?: T;
}
enum ItemStatus {
	InStock = "in-stock",
	OutOfStock = "out-of-stock",
	Hidden = "hidden",
}

interface RetailerData {
	retailer_id: string;
	quantity: number;
	status: ItemStatus;
}
interface Item {
	item_id: string;
	status: ItemStatus;
	sku: string;
	quantity_available: number;
	per_retailer: Record<string, RetailerData>
}

// Prompt:
// Transform the incomming payload by returning an new item that has the the top level status set based on the per_retailer data.  Per retailer, if the quantity is greather than 0 the item status for that reatailer should be InStock, if the quantity is 0 or less and status is InStock it should be OutOfStock.  The top level status should be InStock if a single retailer has it InStock.  If all retailers agree on the status that should be the top level status. Otherwise, the top level status should be OutOfStock
async function transform(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {
	if (!payload.new) {
		return payload;
	}

	const newItem = { ...payload.new };

	if (newItem.per_retailer) {
		let hasInStock = false;
		let allSameStatus = true;
		let firstStatus: ItemStatus | null = null;

		for (const [retailerId, retailerData] of Object.entries(newItem.per_retailer)) {
			if (retailerData.quantity > 0) {
				retailerData.status = ItemStatus.InStock;
				hasInStock = true;
			} else if (retailerData.quantity <= 0 && retailerData.status === ItemStatus.InStock) {
				retailerData.status = ItemStatus.OutOfStock;
			}

			if (firstStatus === null) {
				firstStatus = retailerData.status;
			} else if (retailerData.status !== firstStatus) {
				allSameStatus = false;
			}
		}

		if (hasInStock) {
			newItem.status = ItemStatus.InStock;
		} else if (allSameStatus && firstStatus !== null) {
			newItem.status = firstStatus;
		} else {
			newItem.status = ItemStatus.OutOfStock;
		}
	}

	return { ...payload, new: newItem };

}

async function transform2(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {
	if (payload.new) {
		let firstStatus: undefined | ItemStatus = undefined;
		let allSameStatus = true;
		let someInStock = false;

		Object.values(payload.new.per_retailer).forEach(retailer => {
			if (retailer.quantity > 0) {
				retailer.status = ItemStatus.InStock;
				someInStock = true;
			} else if (retailer.quantity <= 0 && retailer.status === ItemStatus.InStock) {
				retailer.status = ItemStatus.OutOfStock;
			}

			if (firstStatus === undefined) {
				firstStatus = retailer.status;
			} else if (retailer.status !== firstStatus) {
				allSameStatus = false;
			}
		});

		if (allSameStatus) {
			payload.new.status = firstStatus ?? ItemStatus.OutOfStock;
		} else if (someInStock) {
			payload.new.status = ItemStatus.InStock;
		} else {
			payload.new.status = ItemStatus.OutOfStock;
		}
	}
}














