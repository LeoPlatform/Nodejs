import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
import utilFn from "../lib/stream/leo-stream";
import streams from "../lib/streams";
import moment from "moment";
chai.use(sinonchai);
let util = utilFn({ onUpdate: () => { }, resources: {}, aws: {} });

let mockSdkConfig = {
	Region: "mock-Region",
	LeoStream: "mock-LeoStream",
	LeoCron: "mock-LeoCron",
	LeoEvent: "mock-LeoEvent",
	LeoS3: "mock-leos3",
	LeoKinesisStream: "mock-LeoKinesisStream",
	LeoFirehoseStream: "mock-LeoFirehoseStream",
	LeoSettings: "mock-LeoSettings",
};

describe("Streams", function () {
	let sandbox;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});
	afterEach(() => {
		sandbox.restore();
	});

	it("eventIdFromTimestamp", async function () {
		let now = 1648149254205;
		assert.equal(streams.eventIdFromTimestamp(now), "z/2022/03/24/19/14/1648149254205");
		assert.equal(streams.eventIdFromTimestamp(now, "year"), "z/2022/");
		assert.equal(streams.eventIdFromTimestamp(now, "month"), "z/2022/03/");
		assert.equal(streams.eventIdFromTimestamp(now, "date"), "z/2022/03/24/");
		assert.equal(streams.eventIdFromTimestamp(now, "hour"), "z/2022/03/24/19/");
		assert.equal(streams.eventIdFromTimestamp(now, "minute"), "z/2022/03/24/19/14/");
		assert.equal(streams.eventIdFromTimestamp(now, "second"), "z/2022/03/24/19/14/1648149254000");
		assert.equal(streams.eventIdFromTimestamp(now, "millisecond"), "z/2022/03/24/19/14/1648149254205");
		assert.equal(streams.eventIdFromTimestamp(now, "bad"), "z/2022/03/24/19/14/1648149254205");
	});

	it("eventIdToTimestamp", async function () {
		let target = moment.utc(1648149254205);
		assert.equal(streams.eventIdToTimestamp("z/2022/03/24/19/14/1648149254205"), target.valueOf(), "should match ms");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/")).format(), target.clone().startOf("year").format(), "should match year");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/")).format(), target.clone().startOf("month").format(), "should match month");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/24/")).format(), target.clone().startOf("date").format(), "should match date");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/24/19/")).format(), target.clone().startOf("hour").format(), "should match hour");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/24/19/14/")).format(), target.clone().startOf("minute").format(), "should match minute");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/24/19/14/1648149254000")).format(), target.clone().startOf("second").format(), "should match second");
		assert.equal(moment.utc(streams.eventIdToTimestamp("z/2022/03/24/19/14/1648149254205")).format(), target.clone().startOf("millisecond").format(), "should match ms");
	});

	it("eventIdToTimestamp error", async function () {
		let error;
		try {
			streams.eventIdToTimestamp(null);
			assert.fail("should throw an error");
		} catch (e) {
			error = e;
		}
		assert.isNotNull(error);
		assert.equal(error.message, "Invalid Event Id.  Should be a string.");

	});

	it("bufferBackoff happy", async function () {
		let data = await new Promise((resolve, reject) => {
			let results = [];
			streams.pipe(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.bufferBackoff(
					(data, done) => {
						done(null, data);
					},
					(records, done) => {
						results.push(records);
						done(null, []);
					},
					{},
					{ records: 3 },
					(done) => {
						done();
					}
				),
				(err) => {
					err ? reject(err) : resolve(results);
				},

			);
		});

		assert.deepEqual(data, [[{
			some: "data1"
		}, {
			some: "data2"
		}, {
			some: "data3"
		}], [{
			some: "data4"
		}, {
			some: "data5"
		}, {
			some: "data6"
		}]]);
	});

	it("bufferBackoff full error", async function () {
		let data = await new Promise((resolve, reject) => {
			let results = [];
			let emitCount = 0;
			streams.pipe(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.bufferBackoff(
					(data, done) => {
						done(null, data);
					},
					(records, done) => {
						emitCount++;
						if (emitCount == 1) {
							done(new Error("bad stuff happened"), records);
						} else {
							results.push(records);
							done(null, []);
						}
					},
					{},
					{ records: 3 },
					(done) => {
						done();
					}
				),
				(err) => {
					err ? reject(err) : resolve(results);
				},

			);
		});

		assert.deepEqual(data, [[{
			some: "data1"
		}, {
			some: "data2"
		}, {
			some: "data3"
		}], [{
			some: "data4"
		}, {
			some: "data5"
		}, {
			some: "data6"
		}]]);
	});

	it("bufferBackoff partial error", async function () {
		let data = await new Promise((resolve, reject) => {
			let results = [];
			let emitCount = 0;
			streams.pipe(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.bufferBackoff(
					(data, done) => {
						done(null, data);
					},
					(records, done) => {
						emitCount++;
						if (emitCount == 1) {
							done(null, records);
						} else {
							results.push(records);
							done(null, []);
						}
					},
					{},
					{ records: 3 },
					(done) => {
						done();
					}
				),
				(err) => {
					err ? reject(err) : resolve(results);
				},

			);
		});

		assert.deepEqual(data, [[{
			some: "data1"
		}, {
			some: "data2"
		}, {
			some: "data3"
		}], [{
			some: "data4"
		}, {
			some: "data5"
		}, {
			some: "data6"
		}]]);
	});

	it("stringify", async function () {
		let data = await new Promise((resolve, reject) => {
			streams.pipe(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.stringify(),
				util.eventstream.writeArray((err, results) => {
					err ? reject(err) : resolve(results);
				}),
			);
		});

		assert.deepEqual(data, [
			"{\"some\":\"data1\"}\n",
			"{\"some\":\"data2\"}\n",
			"{\"some\":\"data3\"}\n",
			"{\"some\":\"data4\"}\n",
			"{\"some\":\"data5\"}\n",
			"{\"some\":\"data6\"}\n"
		]);
	});

	it("parse", async function () {
		let data = await new Promise((resolve, reject) => {
			streams.pipe(
				util.eventstream.readArray([[
					"{\"some\":\"data1\"}",
					"{\"some\":\"data2\"}",
					"{\"some\":\"data3\"}",
					"{\"some\":\"data4\"}",
					"{\"some\":\"data5\"}",
					"{\"some\":\"data6\"}"
				].join("\n")]),
				streams.parse(),
				util.eventstream.writeArray((err, results) => {
					err ? reject(err) : resolve(results);
				}),
			);
		});

		assert.deepEqual(data, [{
			some: "data1"
		}, {
			some: "data2"
		}, {
			some: "data3"
		}, {
			some: "data4"
		}, {
			some: "data5"
		}, {
			some: "data6"
		}]);
	});

	it("parse skip errors", async function () {
		let data = await new Promise((resolve, reject) => {
			streams.pipe(
				util.eventstream.readArray([[
					"{\"some\":\"data1\"}",
					"{\"some\":\"data2\"}",
					"{\"some\":\"data3\"}",
					"{\"some\":\"data4\"}",
					"{\"some\":\"data5}",
					"{\"some\":\"data6\"}"
				].join("\n")]),
				streams.parse(true),
				util.eventstream.writeArray((err, results) => {
					err ? reject(err) : resolve(results);
				}),
			);
		});

		assert.deepEqual(data, [{
			some: "data1"
		}, {
			some: "data2"
		}, {
			some: "data3"
		}, {
			some: "data4"
		}, {
			some: "data6"
		}]);
	});

	describe("log", function () {
		let log = console.log;
		beforeEach(() => {
			console.log = log;
		});
		afterEach(() => {
		});
		it("log normal", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.log(),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["{\n  \"some\": \"data1\"\n}"],
				["{\n  \"some\": \"data2\"\n}"],
				["{\n  \"some\": \"data3\"\n}"],
				["{\n  \"some\": \"data4\"\n}"],
				["{\n  \"some\": \"data5\"\n}"],
				["{\n  \"some\": \"data6\"\n}"]
			]);
			assert.deepEqual(data, [
				{ some: "data1" },
				{ some: "data2" },
				{ some: "data3" },
				{ some: "data4" },
				{ some: "data5" },
				{ some: "data6" },
			], "output should match");
		});

		it("log prefix", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.log("tester"),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["tester", "{\n  \"some\": \"data1\"\n}"],
				["tester", "{\n  \"some\": \"data2\"\n}"],
				["tester", "{\n  \"some\": \"data3\"\n}"],
				["tester", "{\n  \"some\": \"data4\"\n}"],
				["tester", "{\n  \"some\": \"data5\"\n}"],
				["tester", "{\n  \"some\": \"data6\"\n}"]
			]);
			assert.deepEqual(data, [
				{ some: "data1" },
				{ some: "data2" },
				{ some: "data3" },
				{ some: "data4" },
				{ some: "data5" },
				{ some: "data6" },
			], "output should match");
		});

		it("log string", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray(["data1", "data2", "data3", "data4", "data5", "data6", { __cmd: "hello" }]),
					streams.log(),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["data1"],
				["data2"],
				["data3"],
				["data4"],
				["data5"],
				["data6"],
				["{\n  \"__cmd\": \"hello\"\n}"]
			], "Logs should match");
			assert.deepEqual(data, [
				"data1",
				"data2",
				"data3",
				"data4",
				"data5",
				"data6",
				{ __cmd: "hello" }
			], "output should match");
		});
	});

	describe("counter", function () {
		let log = console.log;
		let now = Date.now;
		beforeEach(() => {
			console.log = log;
			Date.now = now;
		});
		afterEach(() => {
		});
		it("counter with label and 1", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			Date.now = (() => { let s = 1000; return () => s++; })();
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.counter("counter", 1),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["counter 1 RPS: 1000 BPS: 0.00 1ms "],
				["counter 2 RPS: 1000 BPS: 0.00 2ms "],
				["counter 3 RPS: 1000 BPS: 0.00 3ms "],
				["counter 4 RPS: 1000 BPS: 0.00 4ms "],
				["counter 5 RPS: 1000 BPS: 0.00 5ms "],
				["counter 6 RPS: 1000 BPS: 0.00 6ms "],
				["Total", "counter 6 RPS: 857 BPS: 0.00 7ms "]
			]);
			assert.deepEqual(data, [
				{ some: "data1" },
				{ some: "data2" },
				{ some: "data3" },
				{ some: "data4" },
				{ some: "data5" },
				{ some: "data6" },
			], "output should match");
		});

		it("counter with label and 2", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			Date.now = (() => { let s = 1000; return () => s++; })();
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.counter("counter", 2),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["counter 2 RPS: 2000 BPS: 0.00 1ms "],
				["counter 4 RPS: 2000 BPS: 0.00 2ms "],
				["counter 6 RPS: 2000 BPS: 0.00 3ms "],
				["Total", "counter 6 RPS: 1500 BPS: 0.00 4ms "]
			]);
			assert.deepEqual(data, [
				{ some: "data1" },
				{ some: "data2" },
				{ some: "data3" },
				{ some: "data4" },
				{ some: "data5" },
				{ some: "data6" },
			], "output should match");
		});

		it("counter 2", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			Date.now = (() => { let s = 1000; return () => s++; })();
			let data = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.counter(2),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(logs, [
				["2 RPS: 2000 BPS: 0.00 1ms "],
				["4 RPS: 2000 BPS: 0.00 2ms "],
				["6 RPS: 2000 BPS: 0.00 3ms "],
				["Total", "6 RPS: 1500 BPS: 0.00 4ms "]
			]);
			assert.deepEqual(data, [
				{ some: "data1" },
				{ some: "data2" },
				{ some: "data3" },
				{ some: "data4" },
				{ some: "data5" },
				{ some: "data6" },
			], "output should match");
		});
	});

	describe("devnull", function () {
		let log = console.log;
		beforeEach(() => {
			console.log = log;
		});
		afterEach(() => {
		});
		it("log with label", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.devnull("counter"),
					(err) => err ? reject(err) : resolve(undefined)
				);
			});

			assert.deepEqual(logs, [
				["counter", "{\n  \"some\": \"data1\"\n}"],
				["counter", "{\n  \"some\": \"data2\"\n}"],
				["counter", "{\n  \"some\": \"data3\"\n}"],
				["counter", "{\n  \"some\": \"data4\"\n}"],
				["counter", "{\n  \"some\": \"data5\"\n}"],
				["counter", "{\n  \"some\": \"data6\"\n}"]
			]);
		});

		it("log with true", async function () {
			let logs = [];
			console.log = function (...args) {
				logs.push(args);
			};
			Date.now = () => 1000;
			await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.devnull(true),
					(err) => err ? reject(err) : resolve(undefined)
				);
			});

			assert.deepEqual(logs, [
				["devnull", "{\n  \"some\": \"data1\"\n}"],
				["devnull", "{\n  \"some\": \"data2\"\n}"],
				["devnull", "{\n  \"some\": \"data3\"\n}"],
				["devnull", "{\n  \"some\": \"data4\"\n}"],
				["devnull", "{\n  \"some\": \"data5\"\n}"],
				["devnull", "{\n  \"some\": \"data6\"\n}"]
			]);
		});
	});

	describe("through", function () {
		beforeEach(() => {
		});
		afterEach(() => {
		});
		interface SampleData {
			some: string;
		}
		it("async no waiting", async function () {
			let results = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.throughAsync<SampleData, string>((data) => {
						return data.some;
					}),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(results, [
				"data1",
				"data2",
				"data3",
				"data4",
				"data5",
				"data6"
			]);
		});
		it("async with waiting", async function () {
			let results = await new Promise((resolve, reject) => {
				let count = 0;
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.throughAsync<SampleData, string>(async (data) => {
						count++;
						sleep((10 - count) * 10);
						return data.some;
					}),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(results, [
				"data1",
				"data2",
				"data3",
				"data4",
				"data5",
				"data6"
			]);
		});
		it("async with push", async function () {
			let results = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.throughAsync<SampleData, string>(function (data) {
						this.push(data.some + data.some);
						return undefined;
					}),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(results, [
				"data1data1",
				"data2data2",
				"data3data3",
				"data4data4",
				"data5data5",
				"data6data6"
			]);
		});

		it("async with push & return", async function () {
			let results = await new Promise((resolve, reject) => {
				streams.pipe(
					util.eventstream.readArray([{
						some: "data1"
					}, {
						some: "data2"
					}, {
						some: "data3"
					}, {
						some: "data4"
					}, {
						some: "data5"
					}, {
						some: "data6"
					}]),
					streams.throughAsync<SampleData, string>(function (data) {
						this.push(data.some + data.some);
						return data.some;
					}),
					util.eventstream.writeArray((err, results) => {
						err ? reject(err) : resolve(results);
					}),
				);
			});

			assert.deepEqual(results, [
				"data1data1",
				"data1",
				"data2data2",
				"data2",
				"data3data3",
				"data3",
				"data4data4",
				"data4",
				"data5data5",
				"data5",
				"data6data6",
				"data6"
			]);
		});
		it("async with error", async function () {
			let results;
			let error;
			try {
				results = await new Promise((resolve, reject) => {
					let count = 0;
					streams.pipe(
						util.eventstream.readArray([{
							some: "data1"
						}]),
						streams.throughAsync<SampleData, string>(async (data) => {
							count++;
							throw new Error(`Some error message: ${count}`);
						}),
						util.eventstream.writeArray((err, results) => {
							err ? reject(err) : resolve(results);
						}),
					);
				});

			} catch (err) {
				error = err;
			}
			assert.isNotNull(error);
			assert.isUndefined(results);
			assert.equal(error.message, "destroyed before end");
		});
		it("nonasync with error", async function () {
			let results;
			let error;
			try {
				results = await new Promise((resolve, reject) => {
					let count = 0;
					streams.pipe(
						util.eventstream.readArray([{
							some: "data1"
						}]),
						streams.through<SampleData, string>(async (data, cb) => {
							count++;
							cb(new Error(`Some error message: ${count}`));
						}),
						util.eventstream.writeArray((err, results) => {
							err ? reject(err) : resolve(results);
						}),
					);
				});

			} catch (err) {
				error = err;
			}
			assert.isNotNull(error);
			assert.isUndefined(results);
			assert.equal(error.message, "destroyed before end");
		});
	});

	describe("pipe", function () {
		beforeEach(() => {
		});
		afterEach(() => {
		});
		interface SampleData {
			some: string;
		}
		it("async no waiting", async function () {
			let results = [];
			let d = await streams.pipeAsync(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.throughAsync<SampleData, string>((data) => {
					return data.some;
				}),
				streams.through((data, done) => {
					results.push(data);
					done();
				}),
				streams.devnull()
			);
			console.log("Check:", d);
			assert.deepEqual(results, [
				"data1",
				"data2",
				"data3",
				"data4",
				"data5",
				"data6"
			]);
		});
		it("async with waiting", async function () {
			let results = [];
			let count = 0;
			await streams.pipeAsync(
				util.eventstream.readArray([{
					some: "data1"
				}, {
					some: "data2"
				}, {
					some: "data3"
				}, {
					some: "data4"
				}, {
					some: "data5"
				}, {
					some: "data6"
				}]),
				streams.throughAsync<SampleData, string>(async (data) => {
					count++;
					sleep((10 - count) * 10);
					return data.some;
				}),
				streams.through((data, done) => {
					results.push(data);
					done();
				}),
				streams.devnull()
			);

			assert.deepEqual(results, [
				"data1",
				"data2",
				"data3",
				"data4",
				"data5",
				"data6"
			]);
		});
	});
});
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => { setTimeout(() => resolve(), ms); });
}

