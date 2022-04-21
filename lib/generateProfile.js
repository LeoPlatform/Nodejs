"use strict";

let homeDir = require('os').homedir();
let path = require("path");
let fs = require("fs");
let extend = require("extend");
var aws = require("./leo-aws");
var async = require('async');
var crypto = require("crypto");
var moment = require("moment");


module.exports = function(stack, options, dir = null, callback) {
	let configPath;
	if (dir == null) {
		dir = homeDir;
		configPath = path.resolve(dir, ".leo/config.json");
	} else {
		configPath = path.resolve(dir, "leo_config.json");
	}
	let configDir = path.dirname(configPath);

	var credentials;
	if (options.awsprofile) {
		console.log("USING AWS PROFILE", options.awsprofile);
		credentials = new aws.SharedIniFileCredentials({
			profile: options.awsprofile
		});
	}

	var cloudformation = new aws.CloudFormation({
		region: options.region,
		credentials: credentials
	});

	cloudformation.listStackResources({
		StackName: stack
	}, function(err, data) {
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
		callback(null);
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

};
