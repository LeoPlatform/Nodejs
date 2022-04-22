"use strict";
module.exports = function(rr, event, context, callback) {
	let exports = {};
	let module = {};
	module.exports = exports;
	require = (function(rr, require) {
		return function(file) {
			var m = rr[file];
			if (!m) {
				try {
					m = require(file);
				} catch (err) {
					throw err;
				}
			}
			return m;
		};
	})(rr, require);
	eval(event.mappings || event.mapping);
	return exports;
};
