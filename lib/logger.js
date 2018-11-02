"use strict";
let settings = [];
const merge = require("lodash").merge;

let namespaceSettings = {};

function generateSettings(namespace, force) {
	let isNew = false;
	if (!(namespace in namespaceSettings)) {
		namespaceSettings[namespace] = {
			namespace: namespace,
			config: {},
		};
		isNew = true;
	}
	let s = namespaceSettings[namespace];
	if (isNew || force) {
		s.config = {};
		settings.forEach(setting => {
			if (namespace.match(setting.regex)) {
				s.config = merge(s.config, setting.config);
			}
		})
	}
	return s;
}

module.exports = function(namespace) {
	let mySettings = generateSettings(namespace);

	function log(type, method, ...args) {
		if (type != "time") {
			args = [namespace].concat(args)
		}
		//only show it if there is actually an error
		if (type !== "error" || (args.length > 1 || args[0])) {
			let config = mySettings.config[type];

			mySettings.config.printTimestamp && type !== 'time' && args.unshift(`[${(new Date()).toUTCString()}]`) //add timestamp to logs
			if (config && config.trace) {
				console[method].apply(console, args);
				var stack = new Error().stack;
				console.log(stack.split(/\n\s+at\s(?=\w)/m)[2]);
			} else if (config === true || mySettings.config.all) {
				console[method].apply(console, args);
			}
		}
	}
	let subLogger = {};

	let logger = {
		sub: (n) => {
			if (!(n in subLogger)) {
				subLogger[n] = module.exports(namespace + "." + n);
			}
			return subLogger[n];
		},
		info: log.bind(log, 'info', 'log'),
		json: function() {
			for (let i = 0; i < arguments.length; i++) {
				log("info", "log", JSON.stringify(arguments[i], null, 2));
			}
		},
		time: log.bind(log, 'time', 'time'),
		timeEnd: log.bind(log, 'time', 'timeEnd'),
		log: log.bind(log, 'info', 'log'),
		debug: log.bind(log, 'debug', 'log'),
		error: log.bind(log, 'error', 'error'),
		configure: function(s, config) {
			if (s === true) {
				settings.push({
					regex: /.*/,
					config: {
						all: true
					}
				});
			} else {
				settings.push({
					regex: typeof s === "string" ? new RegExp(s) : s,
					config: config || {
						all: true
					}
				});
			}
			Object.keys(namespaceSettings).forEach(namespace => generateSettings(namespace, true));
		}
	}
	return logger;
}

Object.assign(module.exports, module.exports('global'));
module.exports.configure(/.*/, {
	error: true
});

if (process.env.LEO_LOGGER) {
	if (process.env.LEO_LOGGER == "true") {
		module.exports.configure(true);
	} else {
		let parts = process.env.LEO_LOGGER.split("/")
		let regex;
		let config;
		let lookup = {
			a: "all",
			t: "time",
			i: "info",
			d: "debug",
			e: "error",
			s: "info",
			v: "debug",
			T: "printTimestamp"
		};
		if (parts.length == 1) {
			regex = new RegExp(parts[0]);
		} else if (parts.length > 2) {
			regex = new RegExp(parts[1])
			let flags = parts[2];
			config = {
				all: flags.length == 0
			};
			for (var i = 0; i < flags.length; i++) {
				if (flags[i] in lookup) {
					config[lookup[flags[i]]] = true;
				}
			}
		}
		module.exports.configure(regex, config);
	}
}
