"use strict";
let extend = require("extend");

module.exports = function (configure) {
	configure = configure || {};

	process.__config = process.__config || configure;
	process.__config.registry = process.__config.registry || {};
	configure.registry = extend(true, process.__config.registry, configure.registry || {});
	return {
		mongo: {
			oplogTail: require("./mongo/tail.js").stream
		},
		elasticsearch: {
			write: require("./elasticsearch/toES.js")(configure).stream
		}
	}
};