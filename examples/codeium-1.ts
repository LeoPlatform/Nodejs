import { RStreamsSdk } from '..';
import { CronWrapper } from '../wrapper/cron';
import uuidv4 from "uuid/v4";
async function handler(event: any, context: any, callback: any) {
	const sdk = new RStreamsSdk();
	const sourceQueue = 'item-entity-old-new';
	const destinationQueue = 'item-quantity-changed';

	await sdk.streams.pipeAsync(
		sdk.read('bot-id', sourceQueue, {
			autoConfigure: {
				downloadThreads: 10,
				parseThreads: 4
			}
		}),
		sdk.streams.throughAsync(async (event) => {
			const oldPayload = event.payload.old;
			const newPayload = event.payload.new;

			if (oldPayload.quantity !== newPayload.quantity) {
				let description;
				if (oldPayload.quantity === 0) {
					description = 'Quantity became positive';
				} else if (newPayload.quantity === 0) {
					description = 'Quantity became zero';
				} else if (oldPayload.quantity < newPayload.quantity) {
					description = 'Quantity increased';
				} else {
					description = 'Quantity decreased';
				}

				return {
					event: 'item-quantity-changed',
					payload: {
						item_id: oldPayload.item_id,
						supplier_id: oldPayload.supplier_id,
						old_quantity: oldPayload.quantity,
						new_quantity: newPayload.quantity,
						description
					}
				};
			}
		}),
		sdk.load('bot-id', destinationQueue)
	);
}

export const cronHandler = CronWrapper(handler);
