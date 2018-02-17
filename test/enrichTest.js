var leo = require("../index.js");

var moment = require("moment");

describe("local", function() {
	it("Should be retrieve a nicely formatted workflow", function(done) {
		this.timeout(60000);
		leo.enrich({
			debug: true,
			id: "ckzSDK2",
			inQueue: "gti.test",
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