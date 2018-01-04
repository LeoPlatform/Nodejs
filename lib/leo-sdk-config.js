"use strict";

let homeDir = require('os').homedir();
let path = require("path");
let fs = require("fs");
let configPath = path.resolve(`${homeDir}/.leo`, "config.json");
let config = require("../leoConfigure.js");

module.exports = {};
if (fs.existsSync(configPath)) {
	var sdkConfigData = {};
	sdkConfigData = require(configPath);

	if (config.profiles) {
		let profiles = config.profiles;
		let tmp = {};
		config.profiles.map((p => {
			tmp[p] = sdkConfigData[p];
		}))
		sdkConfigData = tmp;
		sdkConfigData.default = sdkConfigData.default || sdkConfigData[config.defaultProfile] || sdkConfigData[config.profiles[0]];
	}
	sdkConfigData.default = sdkConfigData.default || sdkConfigData[config.defaultProfile] || sdkConfigData[Object.keys(sdkConfigData)[0]];
	module.exports = sdkConfigData;
}