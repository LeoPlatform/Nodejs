"use strict";
let extend = require("extend");
let file = require("./leo-sdk-config.js");
module.exports = function (data) {
	let validate = true;
	if (typeof data === "boolean") {
		validate = data;
		data = undefined;
	}

	let configuration = {
		update: function (newConfig) {
			let config;
			if (!newConfig || typeof newConfig === "string") {
				let profile = newConfig || process.env.LEO_DEFAULT_PROFILE || "default";
				if (!process.env.LEO_DEFAULT_PROFILE && profile != "default") {
					process.env.LEO_DEFAULT_PROFILE = profile;
				}
				config = file[profile];
				if (!config && validate) {
					throw new Error(`Profile "${profile}" does not exist!`);
				}
			} else {
				config = newConfig;
			}
			update(this, config);
			return this;
		},
		validate: function () {
			let errors = [];
			if (!this.aws.region) {
				errors.push("region")
			}
			if (!this.stream) {
				errors.push("kinesis")
			}
			if (!this.bus.s3) {
				errors.push("s3")
			}
			if (!this.bus.firehose) {
				errors.push("firehose")
			}
			if (errors.length > 0) {
				throw new Error("Invalid Settings: Missing " + errors.join(", "));
			}
		},
		setProfile: function (profile) {
			return this.update(profile);
		}
	};
	configuration.update(data);


	if (validate) {
		configuration.validate();
	}

	return configuration;
};


function update(config, newConfig) {
	newConfig = extend(true, {}, newConfig);
	config.bus = config.bus || {};
	config.aws = config.aws || {};
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
		newConfig.region = aws.region || 'us-west-2';
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
	newConfig.update = u;
}