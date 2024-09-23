import { ReadEvent, RSFQueueBotInvocationEvent, RStreamsContext } from "..";
import { CronWrapper } from "../wrappers/cron";


export const handler = CronWrapper(async (event: RSFQueueBotInvocationEvent, context: RStreamsContext) => {
	context.sdk.enrichEvents({
		id: event.botId,
		inQueue: event.queue,
		outQueue: event.destination,
		transform
	});
});


export interface OldNew<T> {
	old?: T;
	new?: T;
}

export enum ItemStatus {
	Hidden = 'hidden',
	InStock = 'in-stock',
	OutOfStock = 'out-of-stock',
}

export interface RetailerData {
	retailer_id: string;
	status: ItemStatus;
	quantity: number;
}

export interface Item {
	item_id: string;
	supplier_id: string;
	quantity: number;
	status: ItemStatus;
	per_retailer: Record<string, RetailerData>
}


// Prompt:
// Transform the incomming payload by returning an new item that has the the top level status set based on the per_retailer data.  Per retailer, if the quantity is greather than 0 the item status for that reatailer should be InStock, if the quantity is 0 or less and status is InStock it should be OutOfStock.  The top level status should be InStock if a single retailer has it InStock.  If all retailers agree on the status that should be the top level status. Otherwise, the top level status should be OutOfStock
async function transform(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {
	const newItem = { ...payload.new };

	if (!newItem) {
		return payload;
	}

	let topLevelStatus: ItemStatus = ItemStatus.OutOfStock;
	let allAgree = true;

	for (const retailerId in newItem.per_retailer) {
		const retailerData = newItem.per_retailer[retailerId];

		if (retailerData.quantity > 0) {
			retailerData.status = ItemStatus.InStock;
			topLevelStatus = ItemStatus.InStock;
		} else if (retailerData.status === ItemStatus.InStock) {
			retailerData.status = ItemStatus.OutOfStock;
		}

		if (retailerData.status !== topLevelStatus) {
			allAgree = false;
		}
	}

	if (allAgree) {
		newItem.status = topLevelStatus;
	} else {
		newItem.status = ItemStatus.OutOfStock;
	}

	return { old: payload.old, new: newItem };
}


export async function transform2(payload: OldNew<Item>, event: ReadEvent<OldNew<Item>>) {
	if (payload.new) {
		let firstStatus: undefined | ItemStatus;
		let allSame = true;
		let someInStock = false;

		Object.values(payload.new.per_retailer).forEach(retailer => {
			if (retailer.quantity > 0) {
				retailer.status = ItemStatus.InStock;
				someInStock = true;
			}

			if (firstStatus === undefined) {
				firstStatus = retailer.status;
			} else if (firstStatus !== retailer.status) {
				allSame = false;
			}
		});

		if (allSame) {
			payload.new.status = firstStatus ?? ItemStatus.OutOfStock;
		} else if (someInStock) {
			payload.new.status = ItemStatus.InStock;
		} else {
			payload.new.status = ItemStatus.OutOfStock;
		}
	}

	return payload.new;
}
