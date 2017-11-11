"use strict";

let homeDir = require('os').homedir();
let path = require("path");
let fs = require("fs");
let configPath = path.resolve(`${homeDir}/.leo`, "config.json");

module.exports = {};
if (fs.existsSync(configPath)) {
	module.exports = require(configPath);
}