const leo = require("@leo-sdk/core/lib/test.js");
const path = require("path");
const fs = require('fs');

module.exports = function(filename, settings, callback) {
	let testDir = path.dirname(filename);
	let fullDir = path.dirname(testDir);
	settings.mapping = fs.readFileSync(path.resolve(testDir, "code.js")).toString('utf8');
	settings.botId = require(path.resolve(fullDir, "package.json")).name;
	leo.invoke.lambda.cron(require(path.resolve(fullDir, "index.js")), callback, settings);
};
