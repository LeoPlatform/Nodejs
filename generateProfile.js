"use strict";
let homeDir = require('os').homedir();
let path = require("path");
let fs = require("fs");
let extend = require("extend");
var aws = require("./lib/leo-aws");
var async = require('async');
var crypto = require("crypto");
var moment = require("moment");

let configPath = path.resolve(`${homeDir}/.leo`, "config.json");
let configDir = path.dirname(configPath);
let parsed = parse();

let options = parsed.options;
let commands = parsed.commands;

//console.log(options);
//console.log(commands);

if (commands[0] == "show") {
	let p = options.leoprofile || "default";
	console.log(`\nProfile: ${p}`);
	console.log(JSON.stringify(get()[p] || {}, null, 2));
	return;
}

var cloudformation = new aws.CloudFormation({
	region: options.region
});


let stack = commands[0];
cloudformation.listStackResources({
	StackName: stack
}, function (err, data) {
	if (err) {
		console.log(err);
		return;
	}
	if (data.NextToken) {
		console.log("We need to deal with next token");
	}
	var resources = {};
	data.StackResourceSummaries.map((resource) => {
		resources[resource.LogicalResourceId] = {
			type: resource.ResourceType,
			id: resource.PhysicalResourceId,
			name: resource.LogicalResourceId
		};
	});

	let config = get();
	let profile = config[options.leoprofile || stack] = Object.assign({
		region: options.region,
		resources: {
			"Region": options.region
		},
		profile: options.awsprofile || undefined
	}, config[options.leoprofile || stack] || {});
	Object.keys(resources).forEach((id) => {
		if (id == "LeoKinesisStream") {
			profile.kinesis = resources[id].id;
		} else if (id == "LeoFirehoseStream") {
			profile.firehose = resources[id].id;
		} else if (id == "LeoS3") {
			profile.s3 = resources[id].id;
		}
		if (resources[id].type.match(/Table|Bucket|DeliveryStream|Stream/)) {
			profile.resources[id] = resources[id].id;
		}
	});

	//if (!config.default) {
	//	config.default = profile;
	//}
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log("Profile Saved");
});

function get() {
	createPath(configDir);
	let config = {};

	if (fs.existsSync(configPath)) {
		config = require(configPath) || {};
	}
	return config;
}

function createPath(dir) {
	if (!fs.existsSync(dir)) {
		var parent = path.dirname(dir);
		if (parent) {
			createPath(parent);
		}
		fs.mkdirSync(dir);
	}
}

function parse() {
	let optionsMap = {
		p: {
			name: "leoprofile",
			consume: 1
		},
		profile: {
			name: "leoprofile",
			consume: 1
		},
		kinesis: {
			name: "kinesis",
			consume: 1
		},
		s3: {
			name: "s3",
			consume: 1
		},
		firehose: {
			name: "firehose",
			consume: 1
		},
		r: {
			name: "region",
			consume: 1
		},
		region: {
			name: "region",
			consume: 1
		},
		s: {
			name: "stack",
			consume: 1
		},
		stack: {
			name: "stack",
			consume: 1
		},
		"aws-profile": {
			name: "awsprofile",
			consume: 1
		},
		awsprofile: {
			name: "awsprofile",
			consume: 1
		},
		"a": {
			name: "awsprofile",
			consume: 1
		}
	};
	let options = {};
	let commands = [];
	let regex = /^-(.)$|^--(.*)$/;
	let args = [].concat(process.argv.concat(process.execArgv));
	for (let i = 0; i < args.length; i++) {
		let arg = args[i];
		var o = arg.match(regex);
		if (arg != "--" && o) {
			var c = optionsMap[o[1] || o[2]] || {
				name: o[1],
				consume: 0
			};
			var key = c.name;

			if (c.consume == 0) {
				options[key] = true;
			} else {
				if (!(args[i + c.consume] || "").match(regex)) {
					options[key] = args[i + c.consume];
					i += c.consume;
				}
			}
		} else if (i > 1) {
			commands.push(arg)
		}
	}

	return {
		options,
		commands
	};
}