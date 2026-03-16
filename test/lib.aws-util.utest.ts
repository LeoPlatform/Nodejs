import { expect, assert } from "chai";
import { copy, error, date } from "../lib/aws-util";

describe('lib/aws-util.ts', function () {

	describe("copy", function () {
		it('should return null for null input', function () {
			assert.equal(copy(null), null);
		});

		it('should return undefined for undefined input', function () {
			assert.equal(copy(undefined), undefined);
		});

		it('should create a shallow copy of an object', function () {
			const original = { a: 1, b: 2 };
			const copied = copy(original);
			expect(copied).to.deep.equal(original);
			expect(copied).to.not.equal(original);
		});

		it('should copy all properties', function () {
			const original = { name: 'test', value: 42, flag: true };
			const copied = copy(original);
			expect(copied.name).to.equal('test');
			expect(copied.value).to.equal(42);
			expect(copied.flag).to.equal(true);
		});

		it('should handle empty object', function () {
			const original = {};
			const copied = copy(original);
			expect(copied).to.deep.equal({});
			expect(copied).to.not.equal(original);
		});
	});

	describe("error", function () {
		it('should set message from string options', function () {
			const err: any = new Error();
			const result = error(err, 'test message');
			expect(result.message).to.equal('test message');
		});

		it('should set message from object options', function () {
			const err: any = new Error();
			const result = error(err, { message: 'object message' });
			expect(result.message).to.equal('object message');
		});

		it('should set code from options', function () {
			const err: any = new Error();
			const result = error(err, { code: 'TEST_CODE' });
			expect(result.code).to.equal('TEST_CODE');
		});

		it('should set name from options.name', function () {
			const err: any = new Error();
			const result = error(err, { name: 'CustomError' });
			expect(result.name).to.equal('CustomError');
		});

		it('should use code as name if name not provided', function () {
			const err: any = new Error();
			const result = error(err, { code: 'ERROR_CODE' });
			expect(result.name).to.equal('ERROR_CODE');
		});

		it('should set stack from options', function () {
			const err: any = new Error();
			const customStack = 'custom stack trace';
			const result = error(err, { stack: customStack });
			expect(result.stack).to.equal(customStack);
		});

		it('should set time to current date', function () {
			const err: any = new Error();
			const before = new Date();
			const result = error(err, 'test');
			const after = new Date();
			expect(result.time.getTime()).to.be.at.least(before.getTime());
			expect(result.time.getTime()).to.be.at.most(after.getTime());
		});

		it('should preserve original error when overwriting message', function () {
			const err: any = new Error('original message');
			const result = error(err, 'new message');
			expect(result.originalError).to.not.be.undefined;
			expect(result.originalError.message).to.equal('original message');
		});

		it('should preserve original error with object options containing message', function () {
			const err: any = new Error('original message');
			const result = error(err, { message: 'new message' });
			expect(result.originalError).to.not.be.undefined;
			expect(result.originalError.message).to.equal('original message');
		});

		it('should handle null options', function () {
			const err: any = new Error('test');
			const result = error(err, null);
			expect(result.message).to.equal('test');
		});

		it('should handle error with empty message', function () {
			const err: any = new Error();
			err.message = '';
			const result = error(err, { code: 'TEST' });
			expect(result.message).to.equal(null);
		});

		it('should default name to Error when no options provided', function () {
			const err: any = {};
			const result = error(err, null);
			expect(result.name).to.equal('Error');
		});

		it('should update err with all options properties', function () {
			const err: any = new Error();
			const result = error(err, { 
				message: 'test',
				code: 'CODE',
				customProp: 'custom'
			});
			expect(result.customProp).to.equal('custom');
		});
	});

	describe("date", function () {
		describe("getDate", function () {
			it('should return a Date object', function () {
				const result = date.getDate();
				expect(result).to.be.instanceOf(Date);
			});

			it('should return current time', function () {
				const before = Date.now();
				const result = date.getDate();
				const after = Date.now();
				expect(result.getTime()).to.be.at.least(before);
				expect(result.getTime()).to.be.at.most(after);
			});
		});
	});
});
