"use strict";
let homeDir = require('os').homedir();
let path = require("path");
let fs = require("fs");
let extend = require("extend");
let async = require("async");
const readline = require('readline');

let configPath = path.resolve(`${homeDir}/.leo`, "config.json");
let configDir = path.dirname(configPath);
let parsed = parse();

let options = parsed.options;
let commands = parsed.commands;

if (commands[0] == "show") {
	let p = options.leoprofile || "default";
	console.log(`\nProfile: ${p}`);
	console.log(JSON.stringify(get()[p] || {}, null, 2));
	return;
}


let questions = [{
	field: "leoprofile",
	question: "Leo profile to configure? [Enter for default]",
	default: "default"
}, {
	field: "region",
	question: "AWS Region? [Enter to skip]"
}, {
	field: "kinesis",
	question: "Kinesis stream? [Enter to skip]"
}, {
	field: "s3",
	question: "S3 stream? [Enter to skip]"
}, {
	field: "firehose",
	question: "Firehose stream? [Enter to skip]"
}, {
	field: "profile",
	question: "AWS Profile? [Enter to skip]"
}, ];

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});
async.eachSeries(questions, (data, done) => {
	if (!options[data.field]) {
		rl.question(data.question + " ", (input) => {
			let transform = data.transform || (a => a);
			options[data.field] = input != "" ? transform(input) : data.default;
			done();
		});
	} else {
		done();
	}
}, () => {
	rl.close();

	let config = get();

	var leoprofile = options.leoprofile || "default";
	delete options.leoprofile;
	extend(true, config, {
		[leoprofile]: options
	});
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log(`\nLeo profile "${leoprofile}" updated!`);
});


function get() {
	createPath(configDir);
	let config = {
		default: {}
	};

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
			commands.push(arg);
		}
	}

	return {
		options,
		commands
	};
}
