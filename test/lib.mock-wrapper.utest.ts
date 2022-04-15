import sinon from "sinon";
import chai, { expect, assert } from "chai";
import wrapper from "../lib/mock-wrapper";
import utilFn from "../lib/stream/leo-stream";
import fs, { existsSync } from "fs";
import { promisify } from "util";
import path from "path";
import Module from "module";
import stream from "stream";

describe('lib/mock-wrapper.ts', function () {
	let sandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();

		// Remove all keys that may be from mocking
		Object.keys(process.env).forEach(key => {
			if (key.match(/^RSTREAMS_MOCK_DATA/)) {
				delete process.env[key];
			}
		});
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('no mock flag', async function () {
		let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });
		wrapper(ls);
		assert(!ls["mocked"], "should not be mocked");
	});

	it('with mock flag', async function () {
		let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });
		setMockDataLocation(".mock-data");
		wrapper(ls);
		assert(ls["mocked"], "should be mocked");
	});

	describe("fromLeo", () => {

		it('mock from jsonl', async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			// sandbox.stub(module, "require").callsFake(() => [{ a: 1, b: "2" }]);
			// sandbox.stub(fs, "existsSync")
			// 	.onFirstCall().returns(false)
			// 	.onSecondCall().callsFake((f) => {
			// 		// require._pathCache[f]
			// 		// require.cache[f] = {
			// 		// 	isPreloading: true, require, id: f,
			// 		// 	exports: [{ a: 1, b: "2" }],
			// 		// 	filename: f, loaded: true, parent: module, children: [],
			// 		// 	path: path.dirname(f), paths: []
			// 		// };
			// 		return true;
			// 	});

			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "createReadStream").callsFake(() => {
				return ls.pipeline(ls.eventstream.readArray([{
					a: 1,
					b: "2"
				}]), ls.stringify());
			});
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");
			let data = [];
			await
				ls.pipeAsync(
					ls.fromLeo("Mock", "MockQueue"),
					ls.through((d, done) => {
						data.push(d);
						done();
					}),
					ls.devnull()
				);
			assert.deepEqual(data, [{
				a: 1,
				b: "2"
			}]);
		});

		it('mock from json', async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			// intercept the dynamic file require
			const Module = require('module')
			let _load = Module._load;
			sandbox.stub(Module, "_load").callsFake((...args) => {
				if (typeof args[0] === "string" && args[0].match(/MockQueue\.json$/)) {
					return [{ a: 3, b: "4" }, { a: 5, b: "6" }];
				} else {
					return _load(...args);
				}
			});
			sandbox.stub(fs, "existsSync")
				.onFirstCall().returns(false)
				.onSecondCall().returns(true);
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");
			let data = [];
			await
				ls.pipeAsync(
					ls.fromLeo("Mock", "MockQueue"),
					ls.through((d, done) => {
						data.push(d);
						done();
					}),
					ls.devnull()
				);
			assert.deepEqual(data, [{
				a: 3,
				b: "4"
			}, {
				a: 5,
				b: "6"
			}]);
		});

		it('mock non existing file', async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			sandbox.stub(fs, "existsSync").returns(false)
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");
			let data = [];
			await
				ls.pipeAsync(
					ls.fromLeo("Mock", "MockQueue"),
					ls.through((d, done) => {
						data.push(d);
						done();
					}),
					ls.devnull()
				);
			assert.deepEqual(data, []);
		});

		it('mock checkpoint', async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			sandbox.stub(fs, "existsSync").returns(false)
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");

			let invoked = false;
			(ls.fromLeo("Mock", "MockQueue") as any).checkpoint(() => (invoked = true));
			assert(invoked, "Should have called callback");
		});
	});



	describe("toLeo", () => {
		it('mock from write', async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			let data = [];
			let error;
			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "createWriteStream").callsFake(() => {
				return ls.eventstream.writeArray((err, d) => {
					error = err;
					data.push(d);
				});
			});
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");

			// Override the creating of eids in the wrapper to give a constant
			(ls as any).eventIdFromTimestamp = () => "z/2022/04/15/23/08/1650064081366-0000000"
			await
				ls.pipeAsync(
					ls.eventstream.readArray([{ event: "MockQueue", id: "MockParentBot", payload: { b: 1, c: true } }]),
					ls.toLeo("MOCK")
				);
			assert.deepEqual(data, [[
				"{\"event\":\"MockQueue\",\"id\":\"MockParentBot\",\"payload\":{\"b\":1,\"c\":true},\"eid\":\"z/2022/04/15/23/08/1650064081366-0000000\"}\n"
			]]);
			assert.isNotNull("RSTREAMS_MOCK_DATA_Q_MockQueue")
		});
	});

	describe("fromS3", () => {
		it("reads file that doesn't exist", async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			sandbox.stub(fs, "existsSync").returns(false);
			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");


			try {
				ls.fromS3({ key: "KEY", bucket: "BUCKET" });
				assert.fail("Should have thrown and error");
			} catch (err) {
				assert.deepEqual(err.code, "NoSuchKey");
			}
		});

		it("reads file that exist", async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "createReadStream").callsFake(() => {
				return ls.eventstream.readArray([{
					a: 1,
					b: "2"
				}]);
			});

			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");

			// Override the creating of eids in the wrapper to give a constant

			let data = [];
			await ls.pipeAsync(ls.fromS3({ key: "KEY", bucket: "BUCKET" }),
				ls.through((d, done) => {
					data.push(d)
					done();
				}),
				ls.devnull()
			);

			assert.deepEqual(data, [{
				a: 1,
				b: "2"
			}]);
		});
	});

	describe("toS3", () => {


		it("writes to a file", async function () {
			let ls = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

			sandbox.stub(fs, "existsSync").returns(true);
			sandbox.stub(fs, "createWriteStream").callsFake(() => {
				return new stream.Writable();
			});

			setMockDataLocation(".mock-data");
			wrapper(ls);
			assert(ls["mocked"], "should be mocked");

			let s3Stream = ls.toS3("BUCKET", "KEY")

			assert(s3Stream instanceof stream.Writable, "Sholuld be a Writable stream");
		});
	});
});


function setMockDataLocation(location: string) {
	process.env.RSTREAMS_MOCK_DATA = location;
}

