"use strict";
let extend = require("extend");
let file = require("./leo-sdk-config.js");
module.exports = function(data) {
	let doValidation = true;
	if (typeof data === "boolean") {
		doValidation = data;
		data = undefined;
	}
	let updateListeners = [];
	let configuration = {
		onUpdate: (callback) => {
			updateListeners.push(callback);
		},
		update: function(newConfig) {
			let config;
			newConfig = newConfig || global.leosdk;
			if (newConfig != null && (newConfig.LeoKinesisStream || newConfig.LeoS3 || newConfig.LeoFirehoseStream)) {
				newConfig = {
					region: newConfig.Region,
					resources: newConfig,
					firehose: newConfig.LeoFirehoseStream,
					kinesis: newConfig.LeoKinesisStream,
					s3: newConfig.LeoS3
				};
			}

			var resources = {
				resources: process.env.Resources && JSON.parse(process.env.Resources) || {}
			};
			if ("leosdk" in process.env) {
				resources = JSON.parse(process.env["leosdk"]);
			}
			let profile = (typeof newConfig === "string" ? newConfig : null) || process.env.LEO_DEFAULT_PROFILE || "default";


			if (!file[profile] && profile != "default" && doValidation) {
				throw new Error(`Profile "${profile}" does not exist!`);
			}
			config = extend(true, {}, file[profile] || {}, resources, typeof newConfig === "object" ? newConfig : {});
			update(this, config);
			updateListeners.map(hook => hook(this));
			return this;
		},
		validate: function() {
			let errors = [];
			if (!this.aws.region) {
				errors.push("region");
			}
			if (!this.stream) {
				errors.push("kinesis");
			}
			if (!this.bus.s3) {
				errors.push("s3");
			}
			if (!this.bus.firehose) {
				errors.push("firehose");
			}
			if (errors.length > 0) {
				throw new Error("Invalid Settings: Missing " + errors.join(", "));
			}
		},
		setProfile: function(profile) {
			return this.update(profile);
		}
	};
	configuration.update(data);


	if (doValidation) {
		configuration.validate();
	}

	return configuration;
};


function update(config, newConfig) {
	newConfig = extend(true, {}, newConfig);
	config.bus = config.bus || {};
	config.aws = config.aws || {};
	config._meta = config._meta || {};
	var bus = newConfig.bus = newConfig.bus || {};
	var aws = newConfig.aws = newConfig.aws || {};

	if (newConfig.kinesis && !newConfig.stream) {
		newConfig.stream = newConfig.kinesis;
	}

	if (newConfig.s3 && !bus.s3) {
		bus.s3 = newConfig.s3;
	}

	if (newConfig.firehose && !bus.firehose) {
		bus.firehose = newConfig.firehose;
	}

	if (!newConfig.region) {
		newConfig.region = aws.region || (newConfig.resources && newConfig.resources.Region) || 'us-west-2';
	}

	if (newConfig.region && !aws.region) {
		aws.region = newConfig.region;
	}

	if (newConfig.profile && !aws.profile) {
		aws.profile = newConfig.profile;
	}

	let u = newConfig.update;
	delete newConfig.update;
	extend(true, config, newConfig);
	config._meta.region = config.aws.region;

	newConfig.update = u;
}
