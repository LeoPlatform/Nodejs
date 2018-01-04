process.env.LEO_DEFAULT_PROFILE = "leo";
var leo = require("../index.js");
var api = require("../lib/template/api-request.js");

var moment = require("moment");

const logger = require("../lib/logger");
logger.configure("all", {
	log: true
})

describe("local", function () {
	it("Should be retrieve a nicely formatted workflow", function (done) {
		this.timeout(60000);

		let ID = "api-request-bot";
		let inQueue = "Q1";
		let outQueue = "api-request-out";

		leo.streams.pipe(
			leo.read(ID, inQueue),
			leo.streams.process(ID, (payload, event, done) => {
				done(null, {
					q: `select * from weather.forecast where woeid in (select woeid from geo.places(1) where text="nome, ak")`
				});
			}, outQueue),
			api({
				url: "https://query.yahooapis.com/v1/public/yql",
				request: {
					method: "GET"
				},
				batch: 10,
				api: function (url, data, opts) {
					// This is only need to append data to the url for a GET query
					// this field is not needed for a POST
					return this.api(`${url}?q=${encodeURIComponent(data.q)}&format=json`, null, opts);
				},
				retries: 3, // Default is 3
				offset: function (retryCount) {
					return {
						seconds: Math.pow(2, retryCount)
					}
				} // Default is 2^retryCount seconds
			}),
			leo.write(ID),
			leo.checkpoint(),
			(err) => {
				console.log("finished", err || "");
				done(err);
			}
		)
	});
});