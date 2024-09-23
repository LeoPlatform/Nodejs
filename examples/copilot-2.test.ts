import { expect } from 'chai';
import { ReadEvent } from '..';
import { Item, ItemStatus, OldNew, transform2 } from './copilot-2';

describe('transform2', () => {
	it('should set top level status to InStock if any retailer has quantity > 0', async () => {
		const payload = {
			new: {
				item_id: 'item1',
				supplier_id: 'supplier1',
				quantity: 10,
				status: ItemStatus.OutOfStock,
				per_retailer: {
					retailer1: { retailer_id: 'retailer1', status: ItemStatus.OutOfStock, quantity: 0 },
					retailer2: { retailer_id: 'retailer2', status: ItemStatus.OutOfStock, quantity: 5 }
				}
			}
		};

		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).to.equal(ItemStatus.InStock);
		expect(result?.per_retailer.retailer2.status).to.equal(ItemStatus.InStock);
	});

	it('should set top level status to OutOfStock if all retailers have quantity <= 0', async () => {
		const payload = {
			new: {
				item_id: 'item2',
				supplier_id: 'supplier2',
				quantity: 0,
				status: ItemStatus.InStock,
				per_retailer: {
					retailer1: { retailer_id: 'retailer1', status: ItemStatus.InStock, quantity: 0 },
					retailer2: { retailer_id: 'retailer2', status: ItemStatus.InStock, quantity: 0 }
				}
			}
		};

		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).to.equal(ItemStatus.OutOfStock);
		expect(result?.per_retailer.retailer1.status).to.equal(ItemStatus.OutOfStock);
		expect(result?.per_retailer.retailer2.status).to.equal(ItemStatus.OutOfStock);
	});

	it('should set top level status to the common status if all retailers agree', async () => {
		const payload = {
			new: {
				item_id: 'item3',
				supplier_id: 'supplier3',
				quantity: 10,
				status: ItemStatus.Hidden,
				per_retailer: {
					retailer1: { retailer_id: 'retailer1', status: ItemStatus.Hidden, quantity: 5 },
					retailer2: { retailer_id: 'retailer2', status: ItemStatus.Hidden, quantity: 10 }
				}
			}
		};

		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result?.status).to.equal(ItemStatus.Hidden);
	});

	it('should return the original payload if new item is not present', async () => {
		const payload = {
			old: {
				item_id: 'item4',
				supplier_id: 'supplier4',
				quantity: 0,
				status: ItemStatus.OutOfStock,
				per_retailer: {
					retailer1: { retailer_id: 'retailer1', status: ItemStatus.OutOfStock, quantity: 0 }
				}
			}
		};

		const result = await transform2(payload, {} as ReadEvent<OldNew<Item>>);
		expect(result).to.be.undefined;
	});
});
