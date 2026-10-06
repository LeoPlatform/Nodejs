import { assert } from "chai";
import { ReadTracker } from "./fanout-read-tracker";

const eid = (n: number | string, ms = 1790773397549) => `z/2026/09/30/13/03/${ms}-${String(n).padStart(7, "0")}`;
// the incident: 0922/0923 were written at 13:03:09, the batch (398-411) at 13:03:17
const early = (n: number) => eid(n, 1790773389433);

describe("Fanout ReadTracker", () => {
	it("reports the start position if nothing was read", () => {
		assert.equal(new ReadTracker(eid(922)).position(), eid(922));
	});

	it("reports nothing if there is no start and nothing was read", () => {
		assert.isUndefined(new ReadTracker().position());
	});

	it("reports the last read eid if no owned events were read", () => {
		const t = new ReadTracker(eid(922));
		[923, 924, 925].forEach(n => t.read(eid(n), false));
		assert.equal(t.position(), eid(925));
	});

	it("does not claim an owned event that was read but never checkpointed", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), false);
		t.read(eid(924), true);
		t.read(eid(925), false);
		assert.equal(t.position(), eid(923));
	});

	it("reports through the unowned events read after the checkpointed owned event", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), true);
		[924, 925, 926].forEach(n => t.read(eid(n), false));
		t.checkpoint(eid(923));
		assert.equal(t.position(), eid(926));
		// and keeps extending as more unowned events arrive, with no further checkpoint calls
		t.read(eid(927), false);
		assert.equal(t.position(), eid(927));
	});

	it("freezes the value at the next owned event", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), true);
		t.read(eid(924), false);
		t.read(eid(925), true);
		t.read(eid(926), false);
		t.checkpoint(eid(923));
		assert.equal(t.position(), eid(924));
		t.checkpoint(eid(925));
		assert.equal(t.position(), eid(926));
	});

	it("holds at the last checkpoint when the run stops with owned events still unflushed", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), true);
		t.read(eid(924), false);
		t.read(eid(925), true);
		t.read(eid(926), true);
		t.read(eid(927), false);
		t.checkpoint(eid(923));
		assert.equal(t.position(), eid(924));
	});

	it("uses the largest key <= the checkpoint when it is not an exact key", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), true);
		t.read(eid(925), true);
		t.read(eid(927), true);
		t.checkpoint(eid(926));
		assert.equal(t.position(), eid(925));
	});

	it("ignores a checkpoint older than the anchor", () => {
		const t = new ReadTracker(eid(922));
		t.read(eid(923), true);
		t.checkpoint(eid(923));
		t.read(eid(924), false);
		t.checkpoint(eid(900));
		assert.equal(t.position(), eid(924));
	});

	it("matches the 13:03 incident: workers that read only an unowned event vote 0923", () => {
		const owners: { [seq: number]: number } = { 398: 1, 399: 2, 400: 3, 401: 0, 402: 1, 403: 2, 404: 3, 405: 0, 406: 1, 407: 2, 408: 3, 409: 0, 410: 2, 411: 3 };
		// the workers ran before the batch landed and only saw 0923, which partition 0 owns
		const worker = new ReadTracker(early(922));
		worker.read(early(923), false);
		assert.equal(worker.position(), early(923));
		// the master ran after the batch landed
		const master = new ReadTracker(early(922));
		master.read(early(923), true);
		Object.keys(owners).forEach(n => master.read(eid(n), owners[Number(n)] === 0));
		master.checkpoint(eid(409));
		assert.equal(master.position(), eid(411));
		// the master's position is past the worker's, so the min stays at 0923 and the batch is re-read
		assert.isTrue(worker.position()! < master.position()!);
	});

	it("keeps memory bounded by the owned events since the last checkpoint", () => {
		const t = new ReadTracker(eid(0));
		let max = 0;
		for (let n = 1; n <= 1000000; n++) {
			t.read(eid(n), n % 4 === 0);
			if (n % 4000 === 0) {
				t.checkpoint(eid(n));
			}
			max = Math.max(max, t.entries.length);
		}
		assert.isBelow(max, 1100);
		assert.equal(t.position(), eid(1000000));
	});
});
