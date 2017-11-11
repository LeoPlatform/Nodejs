"use strict";
var moment = require("moment");
var api = require("../api.js")({
	domainName: "micro.leoinsights.com"
});

describe("subscribe", function () {
	it("Should be retrieve a nicely formatted workflow", function (done) {
		this.timeout(60000);
		api.subscribe("my_test_bot", "subscribe_queue").then((data) => {
			console.log(data);
			done();
		}).catch(done);
	});
});