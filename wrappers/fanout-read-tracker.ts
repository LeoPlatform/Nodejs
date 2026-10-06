interface ReadEntry {
	key: string;
	value: string | undefined;
}

/**
 * Tracks, for one bot/queue within one fanout instance, the furthest eid this instance can
 * safely report as its read position: everything at or before it is either not owned by this
 * instance or has already been checkpointed.
 *
 * entries[i] = { key, value }
 *   key   - an owned eid (entry 0 is the anchor: the start position, or the last checkpointed owned eid)
 *   value - the latest eid read before the next owned eid
 *
 * Entries before the checkpointed one are dropped on every checkpoint, so memory is bounded by the
 * owned events read since the last checkpoint. The checkpointed entry itself is kept as the anchor
 * so unowned events read after it keep extending its value.
 *
 * eids are compared as strings, the same way fanout's min() does.
 */
export class ReadTracker {
	entries: ReadEntry[];

	/**
	 * @param start eid this instance starts reading after (the bot's stored checkpoint)
	 */
	constructor(start?: string) {
		this.entries = [{ key: start || "", value: start }];
	}

	/**
	 * Call for every event that passes through the owner filter, in eid order.
	 * @param eid the event id
	 * @param owned true if this instance owns (will process) the event
	 */
	read(eid: string, owned: boolean): void {
		if (owned) {
			this.entries.push({ key: eid, value: eid });
		} else {
			this.entries[this.entries.length - 1].value = eid;
		}
	}

	/**
	 * Call when the bot checkpoints at eid. Keeps the entry for the largest key <= eid as the anchor
	 * and drops everything before it.
	 */
	checkpoint(eid?: string): void {
		if (!eid) {
			return;
		}
		let i = 0;
		while (i + 1 < this.entries.length && this.entries[i + 1].key <= eid) {
			i++;
		}
		if (i > 0) {
			this.entries.splice(0, i);
		}
	}

	/**
	 * The position to report to the master. Undefined if nothing is known (no start, nothing read).
	 */
	position(): string | undefined {
		return this.entries[0].value;
	}
}
