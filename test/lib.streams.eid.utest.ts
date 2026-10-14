import { assert } from "chai";
import streams from "../lib/streams";

describe("lib/streams.js event ids", function () {
	const cases: [number, string, number | null, string][] = [
		[1647297513618, "full", null, "z/2022/03/14/22/38/1647297513618"],
		[1641022663000, "full", 35, "z/2022/01/01/07/37/1641022663000-0000035"],
		[0, "year", null, "z/1970/"],
		[1, "month", null, "z/1970/01/"],
		[946684800000, "date", null, "z/2000/01/01/"],
		[1709251199999, "hour", null, "z/2024/02/29/23/"],
		[1735689600000, "minute", null, "z/2025/01/01/00/00/"],
		[1767225599999, "second", null, "z/2025/12/31/23/59/1767225599000"],
		[1700000000000, "millisecond", null, "z/2023/11/14/22/13/1700000000000"],
		[1234567890123, "millisecond", 12, "z/2009/02/13/23/31/1234567890123-0000012"],
		[1583020800000, "full", null, "z/2020/03/01/00/00/1583020800000"],
		[1678886400000, "full", 35, "z/2023/03/15/13/20/1678886400000-0000035"],
		[1704067199000, "year", null, "z/2023/"],
		[1893456000000, "month", null, "z/2030/01/"],
		[1650907126722, "date", null, "z/2022/04/25/"],
		[1477958400000, "hour", null, "z/2016/11/01/00/"],
		[1456790400000, "minute", null, "z/2016/03/01/00/00/"],
		[1609459200000, "second", null, "z/2021/01/01/00/00/1609459200000"],
		[1620000000000, "millisecond", null, "z/2021/05/03/00/00/1620000000000"],
		[1999999999999, "millisecond", 12, "z/2033/05/18/03/33/1999999999999-0000012"]
	];

	describe("eventIdFromTimestamp", function () {
		cases.forEach(([timestamp, granularity, record, expected], i) => {
			it(`eventIdFromTimestamp case ${i + 1}: ${timestamp} ${granularity}${record == null ? "" : " record " + record}`, function () {
				assert.equal(streams.eventIdFromTimestamp(timestamp, granularity as any, record as any), expected);
			});
		});

		it("eventIdFromTimestamp defaults to full granularity", function () {
			assert.equal(streams.eventIdFromTimestamp(1647297513618), "z/2022/03/14/22/38/1647297513618");
		});

		it("eventIdFromTimestamp falls back to full for an unknown granularity", function () {
			assert.equal(streams.eventIdFromTimestamp(1647297513618, "decade" as any), "z/2022/03/14/22/38/1647297513618");
		});

		it("eventIdFromTimestamp ignores the record for coarse granularities", function () {
			assert.equal(streams.eventIdFromTimestamp(1647297513618, "hour", 5 as any), "z/2022/03/14/22/");
			assert.equal(streams.eventIdFromTimestamp(1647297513618, "second", 5 as any), "z/2022/03/14/22/38/1647297513000");
		});

		it("eventIdFromTimestamp pads the record to seven digits and truncates beyond that", function () {
			assert.equal(streams.eventIdFromTimestamp(1647297513618, "full", 0 as any), "z/2022/03/14/22/38/1647297513618-0000000");
			assert.equal(streams.eventIdFromTimestamp(1647297513618, "full", 123456789 as any), "z/2022/03/14/22/38/1647297513618-3456789");
		});
	});

	describe("eventIdToTimestamp", function () {
		it("eventIdToTimestamp reads the millisecond timestamp from a full event id", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/22/38/1647297513618-0000035"), 1647297513618);
		});

		it("eventIdToTimestamp reads the timestamp when there is no record suffix", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/22/38/1647297513618"), 1647297513618);
		});

		it("eventIdToTimestamp uses the minute prefix when the timestamp part is empty", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/22/38/"), Date.UTC(2022, 2, 14, 22, 38));
		});

		it("eventIdToTimestamp uses the hour prefix", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/22/"), Date.UTC(2022, 2, 14, 22));
		});

		it("eventIdToTimestamp uses the date prefix", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/"), Date.UTC(2022, 2, 14));
		});

		it("eventIdToTimestamp uses the month prefix", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/"), Date.UTC(2022, 2, 1));
		});

		it("eventIdToTimestamp uses the year prefix", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/"), Date.UTC(2022, 0, 1));
		});

		it("eventIdToTimestamp treats a timestamp part of 10000 or less as not a timestamp", function () {
			assert.equal(streams.eventIdToTimestamp("z/2022/03/14/22/38/5"), Date.UTC(2022, 2, 14, 22, 38));
		});

		it("eventIdToTimestamp round trips every case that carries a millisecond timestamp", function () {
			cases.filter(([, g]) => g === "full" || g === "millisecond").forEach(([timestamp, granularity, record]) => {
				const eid = streams.eventIdFromTimestamp(timestamp, granularity as any, record as any);
				assert.equal(streams.eventIdToTimestamp(eid), timestamp);
			});
		});

		it("eventIdToTimestamp round trips second granularity to the whole second", function () {
			const eid = streams.eventIdFromTimestamp(1767225599999, "second");
			assert.equal(streams.eventIdToTimestamp(eid), 1767225599000);
		});

		it("eventIdToTimestamp throws for a non-string id", function () {
			assert.throws(() => streams.eventIdToTimestamp(123 as any), "Invalid Event Id.  Should be a string.");
		});

		it("eventIdToTimestamp throws when the id does not start with z", function () {
			assert.throws(() => streams.eventIdToTimestamp("x/2022/03/14/22/38/1647297513618"), "Unable to get timestamp for Event Id: x/2022/03/14/22/38/1647297513618");
		});

		it("eventIdToTimestamp throws when no usable parts remain", function () {
			assert.throws(() => streams.eventIdToTimestamp("z/"), "Unable to get timestamp for Event Id: z/");
		});
	});
});
