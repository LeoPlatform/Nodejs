const { reduceCheckpoints, callCheckpointOnResponses } = require("./fanout");
const { assert } = require("chai");
// const sinon = require('sinon');

describe("Fanout", () => {
	describe("reduceCheckpoints", () => {
		it("Finds errors", () => {
			const checkpoints = [
				{
					error: {},
					checkpoints: {},
					iid: 1,
				},
				{
					error: {},
					checkpoints: {},
					iid: 0,
				},
			];
			assert.throws(
				() => {
					reduceCheckpoints(checkpoints);
				},
				Error,
				"errors from sub lambdas"
			);
		});
		it("Get's oldest checkpoint", () => {
			const checkpoints = [
				{
					checkpoints: {
						"test_bot_name_A": {
							read: {
								"test_queue_A": {
									records: 20,
									checkpoint: "z/2020/08/26/15/51/1598457060002-0000002",
									source_timestamp: 1598457055384,
									started_timestamp: 1598457064215,
									ended_timestamp: 1598457064215,
									eid: "z/2020/08/26/15/51/1598457060002-0000002",
								},
							},
							write: {},
						},
					},
					data: {
						eid: "z/2020/08/26/15/51/1598457060002-0000002",
						units: 1,
						source_timestamp: 1598457055384,
						started_timestamp: 1598457065636,
						ended_timestamp: 1598457065636,
						start_eid: "z/2020/08/26/15/51/1598457060002-0000002",
					},
					iid: 1,
				},
				{
					checkpoints: {
						"test_bot_name_A": {
							read: {
								"test_queue_A": {
									records: 20,
									checkpoint: "z/2020/08/26/15/51/1598457060002-0000002",
									source_timestamp: 1598457055384,
									started_timestamp: 1598457064215,
									ended_timestamp: 1598457064215,
									eid: "z/2020/08/26/15/51/1598457060002-0000002",
								},
							},
							write: {},
						},
					},
					data: {
						eid: "z/2020/08/26/15/51/1598457060002-0000002",
						units: 1,
						source_timestamp: 1598457055384,
						started_timestamp: 1598457064215,
						ended_timestamp: 1598457064215,
						start_eid: "z/2020/08/26/15/51/1598457060002-0000002",
					},
					iid: 0,
				},
			];
			const reduced = reduceCheckpoints(checkpoints);
			assert.deepEqual(reduced[0], {
				"test_bot_name_A": {
					read: {
						"test_queue_A": {
							records: 20,
							checkpoint: "z/2020/08/26/15/51/1598457060002-0000002",
							source_timestamp: 1598457055384,
							started_timestamp: 1598457064215,
							ended_timestamp: 1598457064215,
							eid: "z/2020/08/26/15/51/1598457060002-0000002",
						},
					},
					write: {},
				},
			});
		});
		it("Get's oldest checkpoint read and write", () => {
			const checkpoints = [
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
									eid: "z/2020/06/27/17/00/1593277245077-0000045",
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 235299,
									checkpoint: "z/2020/06/27/17/10/1593277825481-0000018",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920806,
									ended_timestamp: 1597708920806,
								},
							},
						},
					},
					iid: 6,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
									eid: "z/2020/06/27/17/00/1593277245077-0000045",
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
								},
							},
						},
					},
					iid: 5,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 252268,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000024",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920925,
									ended_timestamp: 1597708920925,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 252268,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000024",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920925,
									ended_timestamp: 1597708920925,
								},
							},
						},
					},
					iid: 4,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 254239,
									checkpoint: "z/2020/06/28/17/00/1593363642818-0000195",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920991,
									ended_timestamp: 1597708920991,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 254239,
									checkpoint: "z/2020/06/28/17/00/1593363642818-0000195",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920991,
									ended_timestamp: 1597708920991,
								},
							},
						},
					},
					iid: 3,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 252929,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000685",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920859,
									ended_timestamp: 1597708920859,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 252929,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000685",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920859,
									ended_timestamp: 1597708920859,
								},
							},
						},
					},
					iid: 2,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 241938,
									checkpoint: "z/2020/06/27/17/10/1593277835491-0000506",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920767,
									ended_timestamp: 1597708920767,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 241938,
									checkpoint: "z/2020/06/27/17/10/1593277835491-0000506",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920767,
									ended_timestamp: 1597708920767,
								},
							},
						},
					},
					iid: 1,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 245037,
									checkpoint: "z/2020/06/27/17/10/1593277840481-0000995",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708922769,
									ended_timestamp: 1597708922769,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 245037,
									checkpoint: "z/2020/06/27/17/10/1593277840481-0000995",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708922769,
									ended_timestamp: 1597708922769,
								},
							},
						},
					},
					iid: 0,
				},
			];
			const reduced = reduceCheckpoints(checkpoints);
			assert.deepEqual(reduced[0], {
				"test_bot_name_B": {
					read: {
						"test_queue_B": {
							records: 231916,
							checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
							source_timestamp: 1592237878001,
							started_timestamp: 1597708920961,
							ended_timestamp: 1597708920961,
							eid: "z/2020/06/27/17/00/1593277245077-0000045",
						},
					},
					write: {
						"system:dynamodb.test-write-db": {
							records: 235299,
							checkpoint: "z/2020/06/27/17/10/1593277825481-0000018",
							source_timestamp: 1592237878001,
							started_timestamp: 1597708920806,
							ended_timestamp: 1597708920806,
						},
					},
				},
			});
		});
	});
	describe("callCheckpointOnResponses", () => {
		it("works", (done) => {
			const responses = [
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
									eid: "z/2020/06/27/17/00/1593277245077-0000045",
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 235299,
									checkpoint: "z/2020/06/27/17/10/1593277825481-0000018",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920806,
									ended_timestamp: 1597708920806,
								},
							},
						},
					},
					iid: 6,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
									eid: "z/2020/06/27/17/00/1593277245077-0000045",
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 231916,
									checkpoint: "z/2020/06/27/17/00/1593277245077-0000045",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920961,
									ended_timestamp: 1597708920961,
								},
							},
						},
					},
					iid: 5,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 252268,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000024",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920925,
									ended_timestamp: 1597708920925,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 252268,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000024",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920925,
									ended_timestamp: 1597708920925,
								},
							},
						},
					},
					iid: 4,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 254239,
									checkpoint: "z/2020/06/28/17/00/1593363642818-0000195",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920991,
									ended_timestamp: 1597708920991,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 254239,
									checkpoint: "z/2020/06/28/17/00/1593363642818-0000195",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920991,
									ended_timestamp: 1597708920991,
								},
							},
						},
					},
					iid: 3,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 252929,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000685",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920859,
									ended_timestamp: 1597708920859,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 252929,
									checkpoint: "z/2020/06/28/17/00/1593363641146-0000685",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920859,
									ended_timestamp: 1597708920859,
								},
							},
						},
					},
					iid: 2,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 241938,
									checkpoint: "z/2020/06/27/17/10/1593277835491-0000506",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920767,
									ended_timestamp: 1597708920767,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 241938,
									checkpoint: "z/2020/06/27/17/10/1593277835491-0000506",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708920767,
									ended_timestamp: 1597708920767,
								},
							},
						},
					},
					iid: 1,
				},
				{
					checkpoints: {
						"test_bot_name_B": {
							read: {
								"test_queue_B": {
									records: 245037,
									checkpoint: "z/2020/06/27/17/10/1593277840481-0000995",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708922769,
									ended_timestamp: 1597708922769,
								},
							},
							write: {
								"system:dynamodb.test-write-db": {
									records: 245037,
									checkpoint: "z/2020/06/27/17/10/1593277840481-0000995",
									source_timestamp: 1592237878001,
									started_timestamp: 1597708922769,
									ended_timestamp: 1597708922769,
								},
							},
						},
					},
					iid: 0,
				},
			];

			const checkpointParams = [];
			const leoBotCheckpoint = function(botId, queue, params, done){
				checkpointParams.push(params);
				done();
			};

			const callCheckpoints = callCheckpointOnResponses(leoBotCheckpoint, (err) => {
				if (err) return done(err);
				assert.equal(checkpointParams.length, 2);
				assert.equal(checkpointParams[0].type, 'read');
				assert.equal(checkpointParams[1].type, 'write');
				assert.equal(checkpointParams[0].checkpoint, 'z/2020/06/27/17/00/1593277245077-0000045');
				assert.equal(checkpointParams[1].checkpoint, 'z/2020/06/27/17/10/1593277825481-0000018');
				done();
			});

			callCheckpoints(responses);

		});
	});
});
