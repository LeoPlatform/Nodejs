import { CronJob } from 'cron';
import { Queue, Message } from 'some-queue-library'; // Replace with actual queue library

interface ItemEntity {
	item_id: string;
	supplier_id: string;
	old_quantity: number;
	new_quantity: number;
}

interface QuantityChangedEvent {
	item_id: string;
	supplier_id: string;
	old_quantity: number;
	new_quantity: number;
	description: string;
}

const sourceQueue = new Queue<ItemEntity>('item-entity-old-new');
const targetQueue = new Queue<QuantityChangedEvent>('item-quantity-changed');

function transformData(item: ItemEntity): QuantityChangedEvent | null {
	const { item_id, supplier_id, old_quantity, new_quantity } = item;

	if (old_quantity === new_quantity) {
		return null;
	}

	let description = '';
	if (new_quantity === 0) {
		description = 'Quantity became zero';
	} else if (old_quantity === 0 && new_quantity > 0) {
		description = 'Quantity became positive';
	} else if (new_quantity > old_quantity) {
		description = 'Quantity increased';
	} else if (new_quantity < old_quantity) {
		description = 'Quantity decreased';
	}

	return {
		item_id,
		supplier_id,
		old_quantity,
		new_quantity,
		description,
	};
}

async function processMessages() {
	const messages: Message<ItemEntity>[] = await sourceQueue.receiveMessages();

	for (const message of messages) {
		const transformedData = transformData(message.body);
		if (transformedData) {
			await targetQueue.sendMessage(transformedData);
		}
		await sourceQueue.deleteMessage(message);
	}
}

const job = new CronJob('*/5 * * * * *', processMessages, null, true, 'America/Los_Angeles');

job.start();
