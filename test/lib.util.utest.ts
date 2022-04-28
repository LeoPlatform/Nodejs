import RStreamsSdk from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import util from "../lib/util";
import moment from "moment";

describe('lib/util.js', function () {

	describe("dateSafe", function () {
		it('Is Invalid', async function () {
			assert.equal(util.dateSafe("2022/03/17/12/25"), "Invalid date");
		});

		it('Is Valid', async function () {
			assert.equal(util.dateSafe("2022/03/17 12:25"), "2022-03-17");
		});

		it('Is undefined', async function () {
			assert.equal(util.dateSafe(), undefined);
		});
	});

	describe("timestampSafe", function () {
		it('Is Invalid', async function () {
			assert.equal(util.timestampSafe("2022/03/17/12/25"), "Invalid date");
		});

		it('Is Valid', async function () {
			assert.equal(util.timestampSafe("2022-03-17 12:25"), moment("2022-03-17T12:25:00").format());
		});

		it('Is undefined', async function () {
			assert.equal(util.timestampSafe(), undefined);
		});
	});


	describe("ifDefined", function () {
		it('Is Valid', async function () {
			assert.equal(util.ifDefined({ a: 3 }, (o) => o.a), 3);
		});

		it('Is undefined', async function () {
			assert.equal(util.ifDefined(undefined, (o) => o.a), undefined);
		});
	});

	describe("boolSafe", function () {
		it('Is Yes', async function () {
			assert.equal(util.boolSafe(true, 1, 2, 3), 1);
		});

		it('Is No', async function () {
			assert.equal(util.boolSafe(false, 1, 2, 3), 2);
		});
		it('Is None', async function () {
			assert.equal(util.boolSafe(undefined, 1, 2, 3), 3);
		});
	});

	describe("switchSafe", function () {
		it('Is Some', async function () {
			assert.equal(util.switchSafe("some", { some: 1, default: 2, undefined: 3 }), 1);
		});

		it('Is Default', async function () {
			assert.equal(util.switchSafe("none", { some: 1, default: 2, undefined: 3 }), 2);
		});
		it('Is Undefined', async function () {
			assert.equal(util.switchSafe("none", { some: 1, undefined: 3 }), 3);
		});
	});

	describe("toUpperCase", function () {
		it('Is Uppercase', async function () {
			assert.equal(util.toUpperCase("some"), "SOME");
		});
	});

	describe("extractStringPart", function () {
		it('Is om', async function () {
			assert.equal(util.extractStringPart("some", /^.(.*).$/), "om");
		});
		it('Is empty', async function () {
			assert.equal(util.extractStringPart("some", /^a(.*).$/), "");
		});
		it('Is some', async function () {
			assert.equal(util.extractStringPart("some", /^..*.$/), "some");
		});
		it('Is empty again', async function () {
			assert.equal(util.extractStringPart(null, /^..*.$/), "");
		});

	});
});
