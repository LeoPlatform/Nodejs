"use strict";

var moment = require("moment");
var DATE_FORMAT = "YYYY-MM-DD";
module.exports = {
	dateSafe: function (date) {
		return date ? moment(date).format(DATE_FORMAT) : undefined;
	},

	timestampSafe: function (date) {
		return date ? moment(date).format() : undefined;
	},

	ifDefined: function (value, func) {
		if (value !== undefined) {
			return func(value);
		}
		return undefined;
	},

	boolSafe: function (value, yes, no, none) {
		if (value !== undefined) {
			return value ? yes : no;
		}
		return none;
	},

	switchSafe: function (value, values) {
		return values[value] || values.default || values.undefined;
	}
};