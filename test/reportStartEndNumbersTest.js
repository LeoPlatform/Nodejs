var leo = require("../index.js");
var moment = require("moment");

describe("local", function () {
	it("Should be Report numbers and lag", function (done) {
		this.timeout(60000);
		var id = "ckz_report";
		var queue = "ckz_report_queue_write"

		var start = Date.now();
		var started = start;
		//leo.bot.start({
		//	id: id
		//}).then(() => {
		//	setTimeout(() => {

		leo.bot.checkpoint(id, "system:dw.mysql", {
			eid: moment().format(),
			records: 100,
			started_timestamp: started,
			ended_timestamp: moment.now(),
			source_timestamp: started,
			type: 'write'
		}, () => {
			console.log("Calling End")
			//leo.bot.end(null, () => {
			done();
			//});
		});

		// leo.bot.checkpoint(id, queue, {
		// 	eid: "" + Date.now(),
		// 	source_timestamp: start,
		// 	started_timestamp: start,
		// 	ended_timestamp: Date.now(),
		// 	records: 100,
		// 	type: "write",
		// 	//force: true
		// }, () => {
		// 	console.log("Calling End")
		// 	leo.bot.end(null, () => {
		// 		done();
		// 	});
		// });
		//	}, 1);
		//});
	});
});