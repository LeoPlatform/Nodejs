var leo = require("../index.js");
var moment = require("moment");

describe("local", function() {
	it("Should be retrieve a nicely formatted workflow", function(done) {
		this.timeout(60000);
		let count = 0;
		leo.offload({
			id: "ckzSDK_offload",
			queue: "V2FirehoseQueue",
			// batch: {
			// 	size: 2,
			// 	map: (payload, meta, done) => {
			// 		//console.log("My Batch Map", payload)
			// 		done(null, payload);
			// 	}
			// }, // object or number 
			each: (payload, meta, done) => {
				count++;
				console.log(count);
				done(null, true);
			},
			debug: true
		}, (err) => {
			console.log("All Done processing events", err);
			done();
		});
	});
});