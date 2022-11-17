'use strict';

var path = require("path");
var fs = require("fs");
var extend = require('extend');
// eslint-disable-next-line no-undef
let requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
var async = require("async");
var currentOpts = {};

var defaults = {};

function apply(config, override, path, triggers, depth) {
	// console.log(depth, path, triggers)
	if (override.global) {
		// console.log(depth, "Global Appled")
		//extend(true, config, override.global);
		apply(config, override.global, path, triggers, depth + "  ");
	}

	{
		var obj = Object.keys(override).filter(k =>
			!k.startsWith("name:") && !k.startsWith("cond:") && !k.startsWith("group:") && !k.startsWith("env:") && !k.startsWith("region:") && k !== "global"
		).reduce((o, k) => {
			o[k] = override[k];
			return o;
		}, {});
		// console.log("Adding Leaf Values", path, JSON.stringify(obj));
		extend(true, config, obj);
	}

	if (path && path.length > 0 && path[0] in override) {
		var nPath = [].concat(path);
		var p = nPath.shift();
		// console.log(depth, "Path:", p);
		apply(config, override[p], nPath, triggers, depth + "  ");
	}

	for (let k in triggers) {
		let t = triggers[k];
		if (t in override) {
			// console.log(depth, "Path:", t)
			apply(config, override[t], path, triggers, depth + "  ");
		}
	}
}

function unpath(path, obj) {
	return path.split('.').reduce((o, i) => o[i], obj);
}

function getRegexGroups(text, regex, flags) {
	var e = [],
		f = null,
		g = null,
		h = null;
	var a = new RegExp(regex, flags);
	var c = text;
	for (; !f && (g = a.exec(c));) {
		if (a.global && h === a.lastIndex) {
			f = "infinite";
			break;
		}
		if (g.end = (h = g.index + g[0].length) - 1, g.input = null, e.push(g), !a.global)
			break;
	}
	return e;
}

function fill(node, config, path) {
	path = path ? path + "." : "";
	for (var key in node) {
		var child = node[key];
		var file;

		if (child && typeof child == "string" && child.match(/^\\?!.+/)) {
			var table = child.match(/^\!(?:TABLE|T):(.*?)(?::(.*?):(.*?)(?::(.*))?)?$/);
			if (table) {
				var last = null;
				var opts = (table[4] || "").split(/:/g).reduce((sum, curr, index) => {
					if (!last) {
						last = curr;
					} else {
						sum[last.toLowerCase()] = curr;
						last = null;
					}
					return sum;
				}, {});
				var tableData = {
					table: table[1],
					id: {
						field: table[2],
						value: table[3]
					},
					target: path + key,
					options: opts
				};
				var refs = config.registry._tableReferences;
				if (!refs) {
					refs = config.registry._tableReferences = {};
				}
				if (!(tableData.table in refs)) {
					refs[tableData.table] = [];
				}
				refs[tableData.table].push(tableData);
				val = undefined;
			} else {
				var ref = child.replace(/^\\?!/, "");
				var val = config.variables[ref.toLowerCase()];
				if ((typeof val == "undefined" || val == null) && !currentOpts["ignore-missing-variables"]) {
					throw `Reference Variable "${ref}" is required`;
				}
			}
			if (child.match(/^\\!/)) {
				val = `!${ref}`;
			}
			node[key] = val;
		} else if (child && typeof child == "string" && (file = child.match(/^file:\/\/(.*)/))) {
			var val = child;
			if (fs.existsSync(file[1])) {
				val = fs.readFileSync(file[1], {
					encoding: "utf-8"
				});
			} else {
				throw `Reference File "${file[1]}" is missing`;
			}
			node[key] = val;
		} else if (typeof (child) == "string") {

			// var groups = getRegexGroups(child, "\\${(.*?)}", "g");
			// for (var g in groups) {
			// 	var group = groups[g];
			// 	var ref = unpath(group[1], config);
			// 	if (groups.length > 1) {
			// 		child = child.replace(group[0], ref);
			// 	} else {
			// 		child = ref;
			// 	}
			// }
			node[key] = child;

		} else {
			fill(node[key], config, path + key);
		}
	}
	return config;
}

module.exports = {
	configure: function(config) {
		console.log(process.cwd(), currentOpts);
		return require("../leoConfigure.js");
	},
	"build": function build(rootDir, opts) {

		if (opts) {
			currentOpts = Object.assign(currentOpts, opts);
		}

		var config = {
			variables: [],
			settings: {},
			"test": {
				"user": 'default',
				"users": {
					"default": {
						identity: {
							"sourceIp": "127.0.0.1"
						}
					}
				},
				"request": {

				}
			},
			"ui": {
				"version": null,
				"static": {}
			},
			registry: {

			},
			auth: {
				loadUser: true
			}
		};

		var paths = [];
		do {
			paths.push(rootDir);

			var lastDir = rootDir;
			rootDir = path.resolve(rootDir, "../");
		} while (rootDir != lastDir);

		var overrideFiles = [];
		var systemDirectory = null;
		var microserviceDirectory = null;

		var configs = {
			system: {},
			microservice: {},
			bot: {}
		};
		paths.slice(0).reverse().forEach(function(dir) {
			const packageExists = fs.existsSync(dir + "/package.json");
			if (packageExists) {
				var packageFile = path.resolve(dir, "package.json");
				var pkg = requireFn(packageFile);
				if (pkg.config && pkg.config.leo) {
					var typeDefaults = {};
					// var typeDefaults = defaults[pkg.config.leo.type];
					// if (!typeDefaults) {
					// 	try {
					// 		var p = require(`@leo-sdk/core/templates/${pkg.config.leo.type}/defaults.json`);
					// 		typeDefaults = defaults[pkg.config.leo.type] = p || {};
					// 	} catch (e) {
					// 		typeDefaults = defaults[pkg.config.leo.type] = {};
					// 	}
					// }

					extend(true, config, typeDefaults, pkg.config.leo);
					["version", "description", "name"].forEach(function(key) {
						config[key] = pkg.config.leo[key] || pkg[key];
					});
					configs[config.type] = pkg.config.leo;
					overrideFiles.push(pkg.config.leo);
					if (config.type == "system") {
						systemDirectory = dir;
					} else if (config.type == "microservice") {
						microserviceDirectory = dir;
					}
				}
			}
		});

		var env = process.env.LEO_ENV == "undefined" ? null : process.env.LEO_ENV || null;
		var region = process.env.LEO_REGION == "undefined" ? null : process.env.LEO_REGION || null;
		var parseOrder = ["environment", "region"];

		var systemFile = systemDirectory ? path.resolve(systemDirectory, "config/system.json") : {};
		var systemConfig;
		var overrides = {};
		// console.log("System Config:",systemFile)
		if (fs.existsSync(systemFile)) {
			systemConfig = requireFn(systemFile);
			env = env || systemConfig["default-environment"] || "local";
			var regions = systemConfig["default-regions"] || {};
			region = region || regions[env] || regions["default"];
			parseOrder = systemConfig["parse-order"] || parseOrder;
			overrides["system"] = systemConfig;
		}
		env = (env || "local").toLowerCase();
		region = (region || "us-west-2").toLowerCase();
		//no system directory.  for case when you are running create system
		if (!systemDirectory) return Object.assign({
			_meta: {
				region,
				microserviceDir: microserviceDirectory,
				variablesDir: variableDir,
				env
			}
		}, config);

		var tmp = {
			"environment": "env:" + env,
			"region": "region:" + region
		};
		var one = tmp[parseOrder[0]];
		var two = tmp[parseOrder[1]];

		if (env == "local") {
			overrideFiles.push({
				type: "system",
				postfix: "-local"
			});
			overrideFiles.push({
				name: configs.microservice.name,
				postfix: "-local"
			});
		}

		let triggers = [one, two];
		for (var i = 2; i < process.argv.length; i++) {
			var o = process.argv[i];
			var n;
			if (n = o.match("--d(.*)")) {
				triggers.push("cond:" + n[1] + "=" + process.argv[i + 1]);
				console.log(n[1] + "=" + process.argv[i + 1]);
			}
		}
		triggers.push("name:" + config.name);

		// These Values are not allowed to be overriden
		var notOverridable = {
			"type": config.type,
			"name": config.name,
			"ui": {
				"version": config.version
			}
		};

		var filelookups = {};
		if (fs.existsSync(path.resolve(systemDirectory, `config/`))) {
			fs.readdirSync(path.resolve(systemDirectory, `config/`)).forEach(function(file) {
				file = file.replace(/\.json$/, "");
				filelookups[file.toLowerCase()] = file;
			});
		}
		overrideFiles.forEach(function(c) {
			var name = c.type == "system" ? "system" : configs.microservice.name;
			var postfix = c.postfix || "";
			name = name + postfix;
			name = filelookups[name.toLowerCase()] || name;
			var override = overrides[name];

			if (!override) {
				var file = path.resolve(systemDirectory, `config/${name}.json`);

				if (fs.existsSync(file)) {
					override = requireFn(file);
				} else {
					override = {};
				}
				overrides[name] = override;
				// console.log(file)
			}

			var objPath = c.type == "system" ? [] : (c.group || "").split(/_/g).filter(e => !!e).map(e => "group:" + e);
			// console.log(c.name, objPath, env, region)
			var meta = {
				version: override.version,
				"default-regions": override["default-regions"],
				"default-environment": override["default-environment"],
				"parse-order": override["parse-order"]
			};

			delete override.version;
			delete override["default-regions"];
			delete override["default-environment"];
			delete override["parse-order"];

			apply(config, override, objPath.length ? objPath : null, triggers, "");
			Object.assign(override, meta);
		});
		var variableDir = path.resolve(systemDirectory, `config/variables`);

		var vDir = `${variableDir}/${region}_${env == "local" ? "dev" : env}`;
		var variables = {};
		if (fs.existsSync(vDir)) {
			fs.readdirSync(vDir).forEach((file) => {
				let vPath = path.resolve(vDir, file);
				if (fs.existsSync(vPath) && file.match(/\.json$/)) {
					let name = file.replace(/\.json$/, "").toLowerCase();
					var d = JSON.parse(fs.readFileSync(vPath, {
						encoding: "utf-8"
					}));
					Object.keys(d).forEach(k => {
						variables[`${name}.${k}`] = d[k];
					});
				}
			});
		}
		config.variables = variables;

		fill(config, config);
		//console.log("*************************")
		//console.log(JSON.stringify(config, true,2));

		config._meta = {
			env,
			region,
			configDir: path.resolve(systemDirectory, "config/"),
			variablesDir: variableDir,
			microserviceDir: microserviceDirectory,
			systemDir: systemDirectory
		};

		extend(true, config, notOverridable);
		if (!config.aws) {
			config.aws = {};
		}
		if (!config.timezone) {
			config.timezone = "UTC";
		}

		config.ui.timezone = config.timezone;

		// if (config.static){
		//     config.ui.static = config.static
		// }
		process.env.LEO_ENV = config._meta.env;
		process.env.LEO_REGION = process.env.AWS_DEFAULT_REGION = config.aws.region = config._meta.region;
		return config;

	},
	"fill": function(obj, repo, docClient) {
		if (docClient) {
			return module.exports.fillWithTableReferences(obj, repo, docClient);
		} else {
			fill(obj, repo);
			return obj;
		}
	},
	fillWithTableReferences: function(obj, repo, docClient) {
		fill(obj, repo);
		return module.exports.addTableReferences(obj, repo.registry._tableReferences, docClient);
	},
	addTableReferences: function(obj, tables, docClient) {
		var keys = Object.keys(tables || {});
		if (docClient && keys.length) {
			return new Promise((resolve, reject) => {

				docClient.batchGet({
					RequestItems: keys.reduce((obj, key) => {
						var refs = tables[key];
						obj[key] = {
							Keys: refs.map(ref => {
								return {
									[ref.id.field]: ref.id.value
								};
							})
						};
						return obj;
					}, {})
				}, (err, data) => {

					//console.log(err, JSON.stringify(data, null, 2))
					if (err) {
						reject(err);
					} else {
						var lookup = {};

						keys.forEach(key => {
							var values = data.Responses[key] || [];
							tables[key].forEach(ref => {
								var v = values.filter(v => v[ref.id.field] == ref.id.value)[0];
								if (ref.options.path) {
									v = ref.options.path.split(".").reduce((obj, key) => obj && obj[key], v);
								}
								var target = ref.target.split(".");
								var targetName = target.pop();
								var parent = target.reduce((obj, key) => obj && obj[key], obj);
								console.log("path", target, targetName, parent, v);
								if (parent != undefined) {
									parent[targetName] = v;
								}
							});

						});
						resolve(obj);
					}
				});
			});
		} else {
			return Promise.resolve(obj);
		}

	}
};
