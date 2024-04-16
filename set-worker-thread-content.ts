const { readFileSync, writeFileSync } = require("fs");
const { gzipSync } = require("zlib");

let parseTaskModuleContent = readFileSync("./lib/stream/helper/parse-task-module.js").toString("utf8");
let downloadTaskModuleContent = readFileSync("./lib/stream/helper/download-task-module.js").toString("utf8");
let data = {
	parseTaskModuleContent, downloadTaskModuleContent
};

writeFileSync(
	"./lib/stream/helper/worker-thread-content.js",
	`module.exports = "${gzipSync(JSON.stringify(data)).toString("base64")}";`
);
