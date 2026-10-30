"use strict";

var moment = require("moment");
const fs = require("fs");
const path = require("path");

var DATE_FORMAT = "YYYY-MM-DD";
module.exports = {
	// aws-sdk v3 clients can't be reconfigured after creation, and configuration.update()
	// deep-merges credentials into the existing object, so compare by value, not identity.
	awsClientSettings: function(region, credentials) {
		return {
			region: region,
			credentials: credentials && typeof credentials === "object"
				? [credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken].join(":")
				: credentials
		};
	},

	sameAwsClientSettings: function(a, b) {
		return a.region === b.region && a.credentials === b.credentials;
	},

	dateSafe: function(date) {
		return date ? moment(date).format(DATE_FORMAT) : undefined;
	},

	timestampSafe: function(date) {
		return date ? moment(date).format() : undefined;
	},

	ifDefined: function(value, func) {
		if (value !== undefined) {
			return func(value);
		}
		return undefined;
	},

	boolSafe: function(value, yes, no, none) {
		if (value !== undefined) {
			return value ? yes : no;
		}
		return none;
	},

	switchSafe: function(value, values) {
		return values[value] || values.default || values.undefined;
	},
	findParentFiles: function(dir, filename) {
		var paths = [];
		do {
			paths.push(dir);

			var lastDir = dir;
			dir = path.resolve(dir, "../");
		} while (dir != lastDir);

		var matches = [];
		paths.forEach(function(dir) {
			var file = path.resolve(dir, filename);
			if (fs.existsSync(file)) {

				matches.push(file);
			}
		});
		return matches;
	},
	toUpperCase: function(value) {
		return value.toUpperCase();
	},
	/**
	 * Extract a portion of a string
	 * @param regex
	 */
	extractStringPart(value, regex) {
		if (value) {
			let returnValue = value.match(regex);

			if (returnValue) {
				return returnValue[1] || returnValue[0];
			}
		}

		return '';
	}
};
