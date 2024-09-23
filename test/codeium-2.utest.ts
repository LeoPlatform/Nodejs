import { transform2 } from './transform2';
import { OldNew, Item, ItemStatus } from './types';

describe('transform2 function', () => {
	it('returns the original payload when payload.new is null', async () => {
		const payload: OldNew<Item> = { old: null, new: null };
		const result = await transform2(payload, null);
		expect(result).toEqual(payload);
	});

	it('sets the top-level status to the common status when all retailers have the same status', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					1: { quantity: 10, status: ItemStatus.InStock },
					2: { quantity: 20, status: ItemStatus.InStock },
				},
			},
		};
		const result = await transform2(payload, null);
		expect(result.status).toBe(ItemStatus.InStock);
	});

	it('sets the top-level status to "InStock" when not all retailers have the same status but some are in stock', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					1: { quantity: 10, status: ItemStatus.InStock },
					2: { quantity: 0, status: ItemStatus.OutOfStock },
				},
			},
		};
		const result = await transform2(payload, null);
		expect(result.status).toBe(ItemStatus.InStock);
	});

	it('sets the top-level status to "OutOfStock" when not all retailers have the same status and none are in stock', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					1: { quantity: 0, status: ItemStatus.OutOfStock },
					2: { quantity: 0, status: ItemStatus.OutOfStock },
				},
			},
		};
		const result = await transform2(payload, null);
		expect(result.status).toBe(ItemStatus.OutOfStock);
	});

	it('sets a retailer\'s status to "InStock" when the quantity is greater than 0', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					1: { quantity: 10, status: ItemStatus.OutOfStock },
				},
			},
		};
		const result = await transform2(payload, null);
		expect(result.per_retailer[1].status).toBe(ItemStatus.InStock);
	});

	it('sets a retailer\'s status to "OutOfStock" when the quantity is less than or equal to 0 and the status is "InStock"', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					1: { quantity: 0, status: ItemStatus.InStock },
				},
			},
		};
		const result = await transform2(payload, null);
		expect(result.per_retailer[1].status).toBe(ItemStatus.OutOfStock);
	});
});
