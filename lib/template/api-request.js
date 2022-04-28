var http = require("http");
var https = require("https");
var URL = require("url");
var extend = require("extend");
var async = require("async");
var moment = require("moment");
var streams = require("../streams");

module.exports = function (opts) {
	if (typeof opts.batch == "number") {
		opts.batch = {
			count: opts.batch
		};
	}
	opts = extend(true, {
		batch: {
			count: 40,
			time: {
				seconds: 10
			}
		},
		retries: 3,
		backoff: function (retryCount) {
			return {
				seconds: Math.pow(2, retryCount)
			};
		}
	}, opts);

	return streams.pipeline(
		streams.batch(opts.batch),
		streams.through(function (event, done) {
			var responses = [];
			var track = {
				lastKey: -1,
				count: 0
			};

			let payload = event.payload;

			if (!Array.isArray(payload)) {
				payload = meta;
			}

			let tryEmit = (callback) => {
				var start = track.lastKey + 1;
				for (var i = start; i < responses.length; i++) {
					var kn = responses[i];
					if (kn == undefined) {
						break;
					}
					this.push(Object.assign({}, payload[i], {
						payload: kn
					}));
					track.lastKey = i;
					delete responses[i];
				}
				callback();
			};

			let api = opts.api || doAPI;
			async.eachOfLimit(payload, payload.length, (event, key, singleDone) => {

				let errorCount = 0;

				function makeRequest() {
					api.call({
						event: event,
						api: doAPI
					}, opts.url, Object.assign({}, event.payload), {
						headers: opts.headers
					}, opts.request).then(response => {
						responses[key] = response;
						tryEmit(singleDone);
					}).catch(err => {
						errorCount++;
						if (errorCount <= opts.retries) {
							let backoff = moment.duration(opts.backoff(errorCount));
							console.log(event.eid, "Backing Off", backoff.toString());
							setTimeout(makeRequest, Math.min(2147483647, backoff.asMilliseconds())); // Max value allowed by setTimeout 
						} else {
							console.log(event.eid, "No more retires");
							singleDone(err);
						}
					});
				}

				makeRequest();
			}, (err, result) => {
				if (err) {
					console.log("Error with batch", err);
					done(err);
				} else {
					tryEmit(done);
				}
			});

		})
	);
};


function doAPI(url, data, opts) {
	var api = http;
	if (url.match(/^https/)) {
		api = https;
	}

	opts = Object.assign(URL.parse(url), extend(true, {
		method: "POST",
		headers: {
			'Content-Type': 'application/json',
		},
		timeout: 1000 * 60 * 4
	}, opts));

	//console.log("Sending Request", url)
	return new Promise((resolve, reject) => {
		var req = api.request(opts, (res) => {
			var result = "";
			res.on("data", (chunk) => result += chunk);
			res.on("end", () => {
				try {
					var r = JSON.parse(result);
					resolve(r);
				} catch (err) {
					//console.log("Rejecting", err)
					reject({
						response: result,
						message: err.message
					});
				}
			});
		}).on("error", (err) => {
			//console.log("Rejecting", err)
			reject({
				message: err.message
			});
		});

		if (opts.method === "POST" && data != undefined) {
			req.write(JSON.stringify(data));
		}
		req.end();
	});

}
