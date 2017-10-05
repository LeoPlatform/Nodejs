var leo = require("../index.js")({
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
});
var moment = require("moment");

describe("local", function() {
	it("Should be retrieve a nicely formatted workflow", function(done) {
		this.timeout(60000);
		leo.enrich({
			id: "ckzSDK2",
			inQueue: "ckzOutQueue2",
			outQueue: "ckzOutQueue3",
			transform: (payload, metadata, done) => {
				done(null, {
					time: moment().format(),
					number: Math.round(Math.random() * 10000),
					parent: payload
				});
			}
		}, (err) => {
			console.log("finished", err || "");
			done(err);
		});
	});
});