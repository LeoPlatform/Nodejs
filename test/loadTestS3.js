const leo = require("../index.js");
var moment = require("moment");

describe("local", function() {
	it.only("Should work with S3", function(done) {
		this.timeout(60000);
		var stream = leo.load("S3TestBot", "s3.test", {
			useS3: true
		});
		for (let i = 0; i < 1000000; i++) {
			stream.write({
				now: moment().format(),
				index: i,
				number: Math.round(Math.random() * 10000)
			});
		}
		stream.end(err => {
			console.log("done writting events");
			done();
		});
	});
});