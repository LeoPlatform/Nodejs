'use strict';

const moment = require('moment');
const logger = require('leo-logger');

module.exports = {
	/**
	 * Validate that the value is a valid string
	 * @param value
	 * @param maxLength {int}
	 * @returns {boolean}
	 */
	isValidString: function (value, maxLength) {
		if (typeof value !== 'string') {
			return false;
		} else if (value.length > maxLength) {
			return false;
		}

		return true;
	},

	/**
	 * Validate that the value is a valid enum. The value must be in the values array
	 * @param value
	 * @param values {array}
	 * @returns {boolean}
	 */
	isValidEnum: function (value, values) {
		return values.indexOf(value) !== -1;
	},

	/**
	 * Validate that the value is a valid timestamp
	 * @param value
	 * @returns {boolean}
	 */
	isValidTimestamp: function (value) {
		return moment(value).format() !== 'Invalid date';
	},

	/**
	 * Validate that the value is a valid datetime
	 * @param value
	 * @returns {boolean}
	 */
	isValidDatetime: function (value) {
		// check if it's a valid string. Most datetimes would use 35 chars max if the month is a full name. Give a little extra buffer.
		return this.isValidString(value, 40) && moment(value).format() !== 'Invalid date';
	},

	/**
	 * Validate that that value is a valid integer
	 * @param value
	 * @returns {boolean}
	 */
	isValidInteger: function (value) {
		if (typeof value !== 'number') {
			return false;
		} else if (value > 2147483647) { // above this, we're going into bigint territory
			return false;
		} else if (value < -2147483648) {
			return false;
		}

		return true;
	},

	/**
	 * Validate that the passed in value is a valid bigint
	 * @param value
	 * @param maxSize {default: 9223372036854775807, which is the max bigint size for databases}
	 * @returns {boolean}
	 */
	isValidBigint: function (value, maxSize = '9223372036854775807') {
		if (typeof value !== 'number' && !value.match(/^\-?\d{0,19}$/)) {
			logger.error('Invalid bigint', value);
			return false;
		} else if (value.length === maxSize.length) {
			let maxBigIntArray = maxSize.split('');
			let bigIntArray = value.split('');

			// step through each character.
			// If it is lower than the max, the int is fine.
			// If it's higher, it's invalid.
			// If it's the same, move to the next character and check.
			for (let i = 0; i < maxSize.length; i++) {
				if (parseInt(bigIntArray[i]) > parseInt(maxBigIntArray[i])) {
					logger.error('BigInt is too large', value);
					return false;
				} else if (parseInt(bigIntArray[i]) < parseInt(maxBigIntArray[i])) {
					// this number is less than the max, so it’s a valid bigint
					return true;
				}
				// validate the next number
			}
		}

		// all validation passed
		return true;
	},

	/**
	 * Validate that the value is a valid float
	 * @param value
	 * @returns {boolean}
	 */
	isValidFloat: function (value) {
		return parseFloat(value) == value;
	},
};
