import sinon from "sinon";
import { expect, assert } from "chai";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import dynamodbLib from "../lib/dynamodb";

describe("lib/dynamodb.js", function () {
	const sandbox = sinon.createSandbox();

	function build(doc: Record<string, any>) {
		sandbox.stub(DynamoDBDocument, "from").returns(doc as unknown as DynamoDBDocument);
		return (dynamodbLib as any)({
			onUpdate: () => { },
			resources: { LeoSettings: "MockLeoSettings" },
			aws: { region: "us-west-2" }
		});
	}

	beforeEach(() => {
		delete process["__config"];
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe("D1 get/put/merge/update/scan", function () {
		it("D1 get reads with ConsistentRead and returns Item", function (done) {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "a", v: 1 } }));
			const ddb = build({ get });
			ddb.get("T", "a", (err, item) => {
				assert.isNull(err);
				assert.deepEqual(item, { id: "a", v: 1 });
				assert.deepEqual(get.getCall(0).args[0], {
					TableName: "T",
					Key: { id: "a" },
					ConsistentRead: true,
					ReturnConsumedCapacity: "TOTAL"
				});
				done();
			});
		});

		it("D1 get uses opts.id as the key name", function (done) {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ get });
			ddb.get("T", "a", { id: "pk" }, (err, item) => {
				assert.isUndefined(item);
				assert.deepEqual(get.getCall(0).args[0].Key, { pk: "a" });
				done();
			});
		});

		it("D1 get passes the error to the callback", function (done) {
			const boom = new Error("boom");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ get });
			ddb.get("T", "a", (err) => {
				assert.equal(err, boom);
				done();
			});
		});

		it("D1 put writes the item with the id merged in and returns Success", function (done) {
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ put });
			ddb.put("T", "a", { x: 1 }, (err, result) => {
				assert.isNull(err);
				assert.equal(result, "Success");
				assert.deepEqual(put.getCall(0).args[0], {
					TableName: "T",
					Key: { id: "a" },
					Item: { x: 1, id: "a" },
					ReturnConsumedCapacity: "TOTAL"
				});
				done();
			});
		});

		it("D1 put uses opts.id for the key name", function (done) {
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ put });
			ddb.put("T", "a", { x: 1 }, { id: "pk" }, () => {
				assert.deepEqual(put.getCall(0).args[0].Key, { pk: "a" });
				assert.deepEqual(put.getCall(0).args[0].Item, { x: 1, pk: "a" });
				done();
			});
		});

		it("D1 put passes the error to the callback", function (done) {
			const boom = new Error("put failed");
			const put = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ put });
			ddb.put("T", "a", {}, (err, result) => {
				assert.equal(err, boom);
				assert.isUndefined(result);
				done();
			});
		});

		it("D1 merge deep-merges onto the existing item and puts it back", function (done) {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "a", nested: { a: 1, b: 2 } } }));
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ get, put });
			ddb.merge("T", "a", { nested: { b: 3, c: 4 } }, (err, result) => {
				assert.isNull(err);
				assert.equal(result, "Success");
				assert.deepEqual(put.getCall(0).args[0].Item, { id: "a", nested: { a: 1, b: 3, c: 4 } });
				done();
			});
		});

		it("D1 merge returns the get error without putting", function (done) {
			const boom = new Error("get failed");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const put = sandbox.stub();
			const ddb = build({ get, put });
			ddb.merge("T", "a", { x: 1 }, {}, (err) => {
				assert.equal(err, boom);
				expect(put.called).to.equal(false);
				done();
			});
		});

		it("D1 update builds a set expression and skips undefined values", function (done) {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ update });
			ddb.update("T", { id: "a" }, { one: 1, two: undefined, "three-x": "3" }, () => {
				assert.deepEqual(update.getCall(0).args[0], {
					TableName: "T",
					Key: { id: "a" },
					UpdateExpression: "set #one = :one, #three_x = :three_x",
					ExpressionAttributeNames: { "#one": "one", "#three_x": "three-x" },
					ExpressionAttributeValues: { ":one": 1, ":three_x": "3" },
					ReturnConsumedCapacity: "TOTAL"
				});
				done();
			});
		});

		it("D1 update uses if_not_exists for fields marked once", function (done) {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ update });
			ddb.update("T", { id: "a" }, { one: 1, two: 2 }, { fields: { one: { once: true } } }, () => {
				assert.equal(update.getCall(0).args[0].UpdateExpression, "set #one = if_not_exists(#one, :one), #two = :two");
				done();
			});
		});

		it("D1 update passes ReturnValues through", function (done) {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ update });
			ddb.update("T", { id: "a" }, { one: 1 }, { ReturnValues: "ALL_NEW" }, () => {
				assert.equal(update.getCall(0).args[0].ReturnValues, "ALL_NEW");
				done();
			});
		});

		it("D1 update with no settable fields sends undefined expression parts", function (done) {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ update });
			ddb.update("T", { id: "a" }, { one: undefined }, () => {
				const params = update.getCall(0).args[0];
				assert.isUndefined(params.UpdateExpression);
				assert.isUndefined(params.ExpressionAttributeNames);
				assert.isUndefined(params.ExpressionAttributeValues);
				done();
			});
		});

		it("D1 updateMulti runs one update per item and collects results in order", function (done) {
			const update = sandbox.stub().callsFake((p, cb) => cb(null, { table: p.TableName }));
			const ddb = build({ update });
			ddb.updateMulti([
				{ table: "T1", key: { id: "a" }, set: { x: 1 } },
				{ table: "T2", key: { id: "b" }, set: { y: 2 } }
			], (err, results) => {
				assert.isNull(err);
				assert.deepEqual(results, [{ table: "T1" }, { table: "T2" }]);
				assert.equal(update.callCount, 2);
				assert.deepEqual(update.getCall(1).args[0].Key, { id: "b" });
				done();
			});
		});

		it("D1 updateMulti reports the first error", function (done) {
			const boom = new Error("nope");
			const update = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ update });
			ddb.updateMulti([{ table: "T1", key: { id: "a" }, set: { x: 1 } }], { limit: 1 }, (err) => {
				assert.equal(err, boom);
				done();
			});
		});

		it("D1 scan returns Items", function (done) {
			const scan = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }, { id: 2 }] }));
			const ddb = build({ scan });
			ddb.scan("T", null, (err, items) => {
				assert.isNull(err);
				assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
				assert.deepEqual(scan.getCall(0).args[0], { TableName: "T", ReturnConsumedCapacity: "TOTAL" });
				done();
			});
		});

		it("D1 scan passes the error to the callback", function (done) {
			const boom = new Error("scan failed");
			const scan = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ scan });
			ddb.scan("T", null, (err) => {
				assert.equal(err, boom);
				done();
			});
		});
	});

	describe("D2 getSetting/saveSetting", function () {
		it("D2 saveSetting puts a value row into LeoSettings", function (done) {
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ put });
			ddb.saveSetting("s1", { a: 1 }, (err, result) => {
				assert.isNull(err);
				assert.equal(result, "Success");
				assert.deepEqual(put.getCall(0).args[0].Item, { id: "s1", value: { a: 1 } });
				assert.equal(put.getCall(0).args[0].TableName, "MockLeoSettings");
				done();
			});
		});

		it("D2 getSetting reads the row from LeoSettings", function (done) {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "s1", value: 5 } }));
			const ddb = build({ get });
			ddb.getSetting("s1", (err, item) => {
				assert.deepEqual(item, { id: "s1", value: 5 });
				assert.equal(get.getCall(0).args[0].TableName, "MockLeoSettings");
				done();
			});
		});

		it("D2 getSettingPromise resolves the stored row", async function () {
			const get = sandbox.stub().callsFake((p, cb) => cb(null, { Item: { id: "s1", value: 5 } }));
			const ddb = build({ get });
			assert.deepEqual(await ddb.getSettingPromise("s1"), { id: "s1", value: 5 });
		});

		it("D2 setSettingPromise resolves Success", async function () {
			const put = sandbox.stub().callsFake((p, cb) => cb(null, {}));
			const ddb = build({ put });
			assert.equal(await ddb.setSettingPromise("s1", 9), "Success");
			assert.deepEqual(put.getCall(0).args[0].Item, { id: "s1", value: 9 });
		});

		it("D2 getSettingPromise rejects with the get error", async function () {
			const boom = new Error("get failed");
			const get = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ get });
			let err;
			try { await ddb.getSettingPromise("s1"); } catch (e) { err = e; }
			assert.equal(err, boom);
		});
	});

	describe("D1 query", function () {
		it("D1 query returns data with _stats when there is no LastEvaluatedKey", async function () {
			const query = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }], Count: 1 }));
			const ddb = build({ query });
			const data = await ddb.query({ TableName: "T" });
			assert.deepEqual(data.Items, [{ id: 1 }]);
			assert.deepEqual(data._stats, { mb: 1, count: 1 });
		});

		it("D1 query pages with ExclusiveStartKey and merges Items/Count/ScannedCount/capacity", async function () {
			const query = sandbox.stub();
			query.onFirstCall().callsFake((p, cb) => cb(null, {
				Items: [{ id: 1 }], Count: 1, ScannedCount: 2, LastEvaluatedKey: { id: 1 }, ConsumedCapacity: { CapacityUnits: 1 }
			}));
			query.onSecondCall().callsFake((p, cb) => cb(null, {
				Items: [{ id: 2 }], Count: 1, ScannedCount: 3, ConsumedCapacity: { CapacityUnits: 4 }
			}));
			const ddb = build({ query });
			const data = await ddb.query({ TableName: "T" });
			assert.deepEqual(data.Items, [{ id: 1 }, { id: 2 }]);
			assert.equal(data.Count, 2);
			assert.equal(data.ScannedCount, 5);
			assert.equal(data.ConsumedCapacity.CapacityUnits, 5);
			assert.isUndefined(data.LastEvaluatedKey);
			assert.deepEqual(data._stats, { mb: 2, count: 2 });
			assert.deepEqual(query.getCall(1).args[0].ExclusiveStartKey, { id: 1 });
		});

		it("D1 query stops paging once the mb limit is reached", async function () {
			const query = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }], Count: 1, LastEvaluatedKey: { id: 1 } }));
			const ddb = build({ query });
			const data = await ddb.query({ TableName: "T" }, { mb: 1 });
			assert.equal(query.callCount, 1);
			assert.deepEqual(data.LastEvaluatedKey, { id: 1 });
		});

		it("D1 query stops paging once the count limit is reached", async function () {
			const query = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }], Count: 1, LastEvaluatedKey: { id: 1 } }));
			const ddb = build({ query });
			await ddb.query({ TableName: "T" }, { count: 1 });
			assert.equal(query.callCount, 1);
		});

		it("D1 query stops paging when progress calls back false", async function () {
			const query = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }], Count: 1, LastEvaluatedKey: { id: 1 } }));
			const ddb = build({ query });
			await ddb.query({ TableName: "T" }, { progress: (d, s, cb) => cb(false) });
			assert.equal(query.callCount, 1);
		});

		it("D1 query with method scan calls docClient.scan", async function () {
			const scan = sandbox.stub().callsFake((p, cb) => cb(null, { Items: [], Count: 0 }));
			const query = sandbox.stub();
			const ddb = build({ query, scan });
			await ddb.query({ TableName: "T" }, { method: "scan" });
			assert.equal(scan.callCount, 1);
			assert.equal(query.callCount, 0);
		});

		it("D1 query rejects with the client error", async function () {
			const boom = new Error("query failed");
			const query = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ query });
			let err;
			try { await ddb.query({ TableName: "T" }); } catch (e) { err = e; }
			assert.equal(err, boom);
		});

		it("D1 query rejects when a subsequent page fails", async function () {
			const boom = new Error("page 2 failed");
			const query = sandbox.stub();
			query.onFirstCall().callsFake((p, cb) => cb(null, { Items: [{ id: 1 }], Count: 1, LastEvaluatedKey: { id: 1 } }));
			query.onSecondCall().callsFake((p, cb) => cb(boom));
			const ddb = build({ query });
			let err;
			try { await ddb.query({ TableName: "T" }); } catch (e) { err = e; }
			assert.equal(err, boom);
		});
	});

	describe("D1 batchGetTable/batchGetHashkey", function () {
		it("D1 batchGetTable dedupes keys and sends a batchGet per chunk", function (done) {
			const batchGet = sandbox.stub().callsFake((p, cb) => cb(null, {
				Responses: { T: p.RequestItems.T.Keys.map((k) => ({ ...k, found: true })) }
			}));
			const ddb = build({ batchGet });
			ddb.batchGetTable("T", [{ id: "a" }, { id: "b" }, { id: "a" }], (err, results) => {
				assert.isNull(err);
				assert.deepEqual(results, [{ id: "a", found: true }, { id: "b", found: true }]);
				assert.equal(batchGet.callCount, 1);
				assert.deepEqual(batchGet.getCall(0).args[0], {
					RequestItems: { T: { Keys: [{ id: "a" }, { id: "b" }] } },
					ReturnConsumedCapacity: "TOTAL"
				});
				done();
			});
		});

		it("D1 batchGetTable splits keys by chunk_size", function (done) {
			const batchGet = sandbox.stub().callsFake((p, cb) => cb(null, {
				Responses: { T: p.RequestItems.T.Keys.map((k) => ({ ...k })) }
			}));
			const ddb = build({ batchGet });
			ddb.batchGetTable("T", [{ id: "a" }, { id: "b" }, { id: "c" }], { chunk_size: 2, concurrency: 1 }, (err, results) => {
				assert.isNull(err);
				assert.equal(results.length, 3);
				assert.deepEqual(batchGet.getCall(0).args[0].RequestItems.T.Keys, [{ id: "a" }, { id: "b" }]);
				assert.deepEqual(batchGet.getCall(1).args[0].RequestItems.T.Keys, [{ id: "c" }]);
				done();
			});
		});

		it("D1 batchGetTable with no keys calls back with an empty result", function (done) {
			const batchGet = sandbox.stub();
			const ddb = build({ batchGet });
			ddb.batchGetTable("T", [], (err, results) => {
				assert.isNull(err);
				assert.deepEqual(results, []);
				assert.equal(batchGet.callCount, 0);
				done();
			});
		});

		it("D1 batchGetHashkey maps rows by their hash key", function (done) {
			const batchGet = sandbox.stub().callsFake((p, cb) => cb(null, {
				Responses: { T: [{ pk: "x", v: 1 }, { pk: "y", v: 2 }] }
			}));
			const ddb = build({ batchGet });
			ddb.batchGetHashkey("T", "pk", ["x", "y"], (err, byKey) => {
				assert.isNull(err);
				assert.deepEqual(byKey, { x: { pk: "x", v: 1 }, y: { pk: "y", v: 2 } });
				assert.deepEqual(batchGet.getCall(0).args[0].RequestItems.T.Keys, [{ pk: "x" }, { pk: "y" }]);
				done();
			});
		});
	});

	describe("D1 batchTableWrite/createTableWriteStream", function () {
		it("D1 batchTableWrite sends the records as RequestItems and returns empty on success", function (done) {
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(null, { UnprocessedItems: {} }));
			const ddb = build({ batchWrite });
			const records = [{ PutRequest: { Item: { id: 1 } } }];
			ddb.batchTableWrite("T", records, (err, unprocessed) => {
				assert.isNull(err);
				assert.deepEqual(unprocessed, []);
				assert.deepEqual(batchWrite.getCall(0).args[0], {
					RequestItems: { T: records },
					ReturnConsumedCapacity: "TOTAL"
				});
				done();
			});
		});

		it("D1 batchTableWrite returns the records with the error on failure", function (done) {
			const boom = new Error("write failed");
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(boom));
			const ddb = build({ batchWrite });
			const records = [{ PutRequest: { Item: { id: 1 } } }];
			ddb.batchTableWrite("T", records, (err, unprocessed) => {
				assert.equal(err, boom);
				assert.equal(unprocessed, records);
				done();
			});
		});

		it("D1 batchTableWrite reports unprocessed records", function (done) {
			const left = [{ PutRequest: { Item: { id: 2 } } }];
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(null, { UnprocessedItems: { T: left } }));
			const ddb = build({ batchWrite });
			ddb.batchTableWrite("T", [], (err, unprocessed) => {
				assert.equal(err, "unprocessed records");
				assert.equal(unprocessed, left);
				done();
			});
		});

		it("D1 createTableWriteStream batches puts into PutRequests and calls end back", function (done) {
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(null, { UnprocessedItems: {} }));
			const ddb = build({ batchWrite });
			const stream = ddb.createTableWriteStream("T", { chunk_size: 2, concurrency: 1, concurrency_delay: 1 });
			stream.put({ id: 1 });
			stream.put({ id: 2 });
			stream.put({ id: 3 });
			stream.end((err) => {
				assert.isNull(err);
				const sent = batchWrite.getCalls().map((c) => c.args[0].RequestItems.T.map((r) => r.PutRequest.Item.id));
				assert.deepEqual(sent, [[1, 2], [3]]);
				done();
			});
		});

		it("D1 createTableWriteStream keeps only the newest record per key when keys are given", function (done) {
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(null, { UnprocessedItems: {} }));
			const ddb = build({ batchWrite });
			const stream = ddb.createTableWriteStream("T", { keys: ["id", "sort"], chunk_size: 10, concurrency: 1, concurrency_delay: 1 });
			stream.put({ id: "a", sort: 1, v: "old" });
			stream.put({ id: "b", sort: 1, v: "other" });
			stream.put({ id: "a", sort: 1, v: "new" });
			stream.end((err) => {
				assert.isNull(err);
				assert.equal(batchWrite.callCount, 1);
				const items = batchWrite.getCall(0).args[0].RequestItems.T.map((r) => r.PutRequest.Item);
				assert.deepEqual(items, [{ id: "b", sort: 1, v: "other" }, { id: "a", sort: 1, v: "new" }]);
				done();
			});
		});

		it("D1 createTableWriteStream with nothing queued ends without writing", function (done) {
			const batchWrite = sandbox.stub();
			const ddb = build({ batchWrite });
			const stream = ddb.createTableWriteStream("T");
			stream.end((err, remaining) => {
				assert.isNull(err);
				assert.deepEqual(remaining, []);
				assert.equal(batchWrite.callCount, 0);
				done();
			});
		});

		it("D1 createTableWriteStream retries unprocessed records and gives up with an error", function (done) {
			this.timeout(5000);
			const batchWrite = sandbox.stub().callsFake((p, cb) => cb(new Error("always fails")));
			const ddb = build({ batchWrite });
			const stream = ddb.createTableWriteStream("T", { chunk_size: 5, concurrency: 1, concurrency_delay: 1, retry: 1, retryDelay: 1 });
			stream.put({ id: 1 });
			stream.end((err, count) => {
				assert.equal(err, "Cannot process all the entries");
				assert.equal(count, 1);
				assert.isAtLeast(batchWrite.callCount, 2);
				done();
			});
		});
	});

	describe("D1 construction", function () {
		it("D1 maps legacy maxRetries/httpOptions into client config", function () {
			const from = sandbox.stub(DynamoDBDocument, "from").returns({} as unknown as DynamoDBDocument);
			(dynamodbLib as any)({ onUpdate: () => { }, aws: { region: "us-west-2" } }, {
				maxRetries: 4,
				httpOptions: { connectTimeout: 111, timeout: 222 }
			});
			const client = from.getCall(0).args[0] as any;
			return Promise.resolve(client.config.maxAttempts()).then((attempts) => {
				assert.equal(attempts, 5);
				assert.deepEqual(from.getCall(0).args[1], {
					marshallOptions: { convertEmptyValues: true, removeUndefinedValues: true }
				});
			});
		});
	});
});
