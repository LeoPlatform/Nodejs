'use strict';
var http = require("./http.js");
module.exports = function (config) {
	return {
		save: function (data) {
			if (typeof data === "string") {
				var id = data;
				data = arguments[1];
				data.id = id;
			}
			return http.post(config.domainName + "/botmon/api/bot/save", data);
		},
		get: function (id) {
			return http.get(config.domainName + "/botmon/api/bot/" + id);
		},
		list: function () {
			return http.get(config.domainName + "/botmon/api/bot");
		}
	}
};