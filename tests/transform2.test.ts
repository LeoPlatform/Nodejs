import { transform2 } from '../examples/cody-2';
import { OldNew, Item, ItemStatus, ReadEvent } from '../types';

describe('transform2', () => {
	it('should set status to InStock when all retailers have quantity > 0', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					retailer1: { quantity: 5, status: ItemStatus.OutOfStock },
					retailer2: { quantity: 3, status: ItemStatus.OutOfStock },
				},
			},
		};
		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).toBe(ItemStatus.InStock);
		expect(result?.per_retailer?.retailer1.status).toBe(ItemStatus.InStock);
		expect(result?.per_retailer?.retailer2.status).toBe(ItemStatus.InStock);
	});

	it('should set status to OutOfStock when all retailers have quantity <= 0', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					retailer1: { quantity: 0, status: ItemStatus.InStock },
					retailer2: { quantity: -1, status: ItemStatus.InStock },
				},
			},
		};
		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).toBe(ItemStatus.OutOfStock);
		expect(result?.per_retailer?.retailer1.status).toBe(ItemStatus.OutOfStock);
		expect(result?.per_retailer?.retailer2.status).toBe(ItemStatus.OutOfStock);
	});

	it('should set status to InStock when some retailers have quantity > 0', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {
					retailer1: { quantity: 5, status: ItemStatus.OutOfStock },
					retailer2: { quantity: 0, status: ItemStatus.InStock },
				},
			},
		};
		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).toBe(ItemStatus.InStock);
		expect(result?.per_retailer?.retailer1.status).toBe(ItemStatus.InStock);
		expect(result?.per_retailer?.retailer2.status).toBe(ItemStatus.OutOfStock);
	});

	it('should return undefined when payload.new is undefined', async () => {
		const payload: OldNew<Item> = {};
		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result).toBeUndefined();
	});

	it('should handle empty per_retailer object', async () => {
		const payload: OldNew<Item> = {
			new: {
				per_retailer: {},
			},
		};
		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).toBe(ItemStatus.OutOfStock);
	});
});
