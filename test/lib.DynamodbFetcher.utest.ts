import { expect, assert } from "chai";
import sinon from "sinon";
import { DynamodbFetcher } from "../lib/DynamodbFetcher";

describe('lib/DynamodbFetcher.ts', function () {
	let fetcher: DynamodbFetcher<any, any>;

	beforeEach(function () {
		fetcher = new DynamodbFetcher('test-table', (item) => ({ id: item.id }));
	});

	describe("constructor", function () {
		it('should set tableName', function () {
			expect(fetcher.tableName).to.equal('test-table');
		});

		it('should set getDdbKey function', function () {
			const item = { id: '123', name: 'test' };
			const key = fetcher.getDdbKey(item);
			expect(key).to.deep.equal({ id: '123' });
		});

		it('should initialize batch counter to 0', function () {
			expect(fetcher.batch).to.equal(0);
		});

		it('should set batchOptions if provided', function () {
			const options = { maxRecords: 100, parallelLimit: 10 };
			const fetcherWithOptions = new DynamodbFetcher('table', (i) => i, options as any);
			expect(fetcherWithOptions.batchOptions).to.not.be.undefined;
		});

		it('should create ddb client', function () {
			expect(fetcher.ddb).to.not.be.undefined;
		});
	});

	describe("keyToString", function () {
		it('should convert single key to string', function () {
			const key = { id: '123' };
			const result = fetcher.keyToString(key);
			expect(result).to.equal('id:123');
		});

		it('should convert multiple keys to string sorted alphabetically', function () {
			const key = { z: '3', a: '1', m: '2' };
			const result = fetcher.keyToString(key);
			expect(result).to.equal('a:1/m:2/z:3');
		});

		it('should handle numeric values', function () {
			const key = { id: 123 };
			const result = fetcher.keyToString(key);
			expect(result).to.equal('id:123');
		});

		it('should handle composite keys', function () {
			const key = { pk: 'user#123', sk: 'profile' };
			const result = fetcher.keyToString(key);
			expect(result).to.equal('pk:user#123/sk:profile');
		});

		it('should handle empty object', function () {
			const key = {};
			const result = fetcher.keyToString(key);
			expect(result).to.equal('');
		});
	});

	describe("join", function () {
		let batchGetStub: sinon.SinonStub;

		beforeEach(function () {
			batchGetStub = sinon.stub(fetcher.ddb, 'batchGet');
		});

		afterEach(function () {
			batchGetStub.restore();
		});

		it('should return events with joinedData when DDB returns data', async function () {
			batchGetStub.resolves({
				Responses: {
					'test-table': [
						{ id: '1', name: 'Item 1' },
						{ id: '2', name: 'Item 2' }
					]
				}
			});

			const events = [
				{ id: '1', value: 'a' },
				{ id: '2', value: 'b' }
			];

			const result = await fetcher.join(events);

			expect(result).to.have.length(2);
			expect((result[0] as any).joinedData).to.deep.equal({ id: '1', name: 'Item 1' });
			expect((result[1] as any).joinedData).to.deep.equal({ id: '2', name: 'Item 2' });
		});

		it('should handle empty events array', async function () {
			const result = await fetcher.join([]);
			expect(result).to.deep.equal([]);
			expect(batchGetStub.called).to.be.false;
		});

		it('should handle events with null keys', async function () {
			const nullKeyFetcher = new DynamodbFetcher('test-table', (item) => item.id ? { id: item.id } : null);
			const batchGetStubNull = sinon.stub(nullKeyFetcher.ddb, 'batchGet');
			batchGetStubNull.resolves({
				Responses: {
					'test-table': [{ id: '1', name: 'Item 1' }]
				}
			});

			const events = [
				{ id: '1', value: 'a' },
				{ value: 'b' } // no id, key will be null
			];

			const result = await nullKeyFetcher.join(events);

			expect(result).to.have.length(2);
			expect((result[0] as any).joinedData).to.not.be.undefined;
			expect((result[1] as any).joinedData).to.be.undefined;

			batchGetStubNull.restore();
		});

		it('should deduplicate keys', async function () {
			batchGetStub.resolves({
				Responses: {
					'test-table': [{ id: '1', name: 'Item 1' }]
				}
			});

			const events = [
				{ id: '1', value: 'a' },
				{ id: '1', value: 'b' } // same id
			];

			await fetcher.join(events);

			// Should only have one key in the batch
			const batchParams = batchGetStub.firstCall.args[0];
			expect(batchParams.RequestItems['test-table'].Keys).to.have.length(1);
		});

		it('should increment batch counter', async function () {
			batchGetStub.resolves({ Responses: { 'test-table': [] } });

			expect(fetcher.batch).to.equal(0);
			await fetcher.join([{ id: '1' }]);
			expect(fetcher.batch).to.equal(1);
			await fetcher.join([{ id: '2' }]);
			expect(fetcher.batch).to.equal(2);
		});

		it('should handle DDB returning undefined joinedData', async function () {
			batchGetStub.resolves({
				Responses: {
					'test-table': [] // no matching items
				}
			});

			const events = [{ id: '1', value: 'a' }];
			const result = await fetcher.join(events);

			expect((result[0] as any).joinedData).to.be.undefined;
		});
	});
});
