const { reduceCheckpoints } = require("./fanout");
const { assert } = require("chai");

describe("Fanout", () => {
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
					"notification-test-intent-to-recipient-intent": {
						read: {
							"notification-intent": {
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
					"notification-test-intent-to-recipient-intent": {
						read: {
							"notification-intent": {
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
		console.log(reduced);
	});
});
