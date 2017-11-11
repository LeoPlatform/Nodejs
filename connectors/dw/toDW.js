"use strict";

var aws = require("aws-sdk");
var extend = require("extend");
var refUtil = require("../../lib/reference.js");
var moment = require("moment");

module.exports = function (configure) {
	configure = configure || {};
	let leo = require("../../index")(configure);
	let ls = leo.streams;

	return {
		validate: function () {},
		stream: function (postfix) {
			let eventName = "queue:dw.load" + (postfix ? postfix : "");
			return ls.through((obj, done) => {
				obj.event = eventName;
				done(null, obj);
			});
		},
		write: function (id, postfix) {
			return ls.pipeline(this.stream(postfix), leo.write(id, {
				firehose: true,
				debug: true
			}), ls.toCheckpoint({
				debug: true
			}));
		}
	}
};