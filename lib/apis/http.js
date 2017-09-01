'use strict';

var http = require("http");
var https = require("https");
var URL = require("url");
var extend = require("extend");

module.exports = {
	post: function (url, data, opts) {
		var api = http;
		if (url.match(/^https/)) {
			api = https;
		}

		opts = Object.assign(URL.parse(url), extend(true, {
			method: "POST",
			headers: {
				'Content-Type': 'application/json',
			},
			timeout: 1000 * 10
		}, opts));

		return new Promise((resolve, reject) => {
			console.log(opts.method.toUpperCase(), ":", url);
			var req = api.request(opts, (res) => {
				var result = "";
				res.on("data", (chunk) => result += chunk);
				res.on("end", () => {
					try {
						var r = result === "" ? undefined : JSON.parse(result);
						resolve(r)
					} catch (err) {
						reject({
							response: result,
							message: err.message
						});
					}
				});
			}).on("error", (err) => {
				reject({
					message: err.message
				});
			});

			if (data != undefined) {
				req.write(JSON.stringify(data));
			}
			req.end();
		});
	},

	get: function (url, data, opts) {
		var api = http;
		if (url.match(/^https/)) {
			api = https;
		}

		return new Promise((resolve, reject) => {
			console.log("GET:", url);
			var req = api.get(url, (res) => {
				var result = "";
				res.on("data", (chunk) => result += chunk);
				res.on("end", () => {
					try {
						var r = result === "" ? undefined : JSON.parse(result);
						resolve(r)
					} catch (err) {
						reject({
							response: result,
							message: err.message
						});
					}
				});
			}).on("error", (err) => {
				reject({
					message: err.message
				});
			});
		});
	}
}