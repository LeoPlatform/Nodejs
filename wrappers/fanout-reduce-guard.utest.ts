import { assert } from "chai";

const { reduceCheckpoints } = require("./fanout");

const eid = (n: number, ms = 1790773397549) => `z/2026/09/30/13/03/${ms}-${String(n).padStart(7, "0")}`;
// 0923 was written at 13:03:09, the batch (398-411) at 13:03:17
const early = (n: number) => eid(n, 1790773389433);
const report = (iid: number, checkpoint?: string) => ({
	iid,
	checkpoints: checkpoint ? {
		bot: { read: { q: { records: 1, checkpoint } }, write: {} }
	} : {}
});

describe("Fanout reduceCheckpoints silent instances", () => {
	it("takes the min when every instance reports", () => {
		const result = reduceCheckpoints([report(3, early(923)), report(2, early(923)), report(1, early(923)), report(0, eid(411))]);
		assert.equal(result[0].bot.read.q.eid, early(923));
	});

	it("throws if an instance did not report a queue another instance reported", () => {
		assert.throws(
			() => reduceCheckpoints([report(1), report(0, eid(409))]),
			Error,
			"fanout instance(s) [1] did not report a read position for bot/q"
		);
	});

	it("does not throw for silent instances when strictCheckpoints is false", () => {
		const result = reduceCheckpoints([report(1), report(0, eid(409))], { strictCheckpoints: false });
		assert.equal(result[0].bot.read.q.eid, eid(409));
	});

	it("does not throw when nobody reported (nothing was read)", () => {
		assert.deepEqual(reduceCheckpoints([report(1), report(0)]), [{}]);
	});

	it("merges a queue only a later response reported (fixes checkpointData.read typo)", () => {
		const first = { iid: 1, checkpoints: { bot: { read: { a: { checkpoint: eid(5) } }, write: {} } } };
		const second = { iid: 0, checkpoints: { bot: { read: { a: { checkpoint: eid(7) }, b: { checkpoint: eid(9) } }, write: {} } } };
		assert.throws(() => reduceCheckpoints([first, second]), Error, "did not report a read position for bot/b");
		const result = reduceCheckpoints([first, second], { strictCheckpoints: false });
		assert.equal(result[0].bot.read.b.eid, eid(9));
	});
});
