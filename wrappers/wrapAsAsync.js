"use strict";

/**
 * Converts a callback-style Lambda handler into an async handler that returns a Promise.
 * Newer Node.js Lambda runtimes (nodejs20.x+) no longer support the callback pattern,
 * so all exported handlers must be async.
 *
 * @param {function(event, context, callback)} handler - A callback-style Lambda handler
 * @returns {function(event, context): Promise} An async Lambda handler
 */
module.exports = function wrapAsAsync(handler) {
	return async function(event, context) {
		return new Promise((resolve, reject) => {
			handler(event, context, function(err, result) {
				if (err) reject(err);
				else resolve(result);
			});
		});
	};
};
