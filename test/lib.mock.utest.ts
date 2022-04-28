import RStreamsSdk from "../index";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import util from "../lib/util";
import moment from "moment";

describe('lib/mock.js', function () {

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
});
