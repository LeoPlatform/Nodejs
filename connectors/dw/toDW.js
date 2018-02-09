"use strict";

var extend = require("extend");
var refUtil = require("../../lib/reference.js");
var moment = require("moment");

module.exports = function (configure) {
	configure = configure || {};
	let leo = require("../../index")(configure);
	let ls = leo.streams;

	return {
		validate: function () {},
		stream: function (suffix) {
			let eventName = "queue:dw.load" + (suffix ? suffix : "");
			return ls.through((obj, done) => {
				if (!obj.payload){
					obj = {payload:obj};
				}
				obj.event = eventName;
				done(null, obj);
			});
		},
		write: function (id, suffix) {
			return ls.pipeline(this.stream(suffix), ls.through((event, done)=>{
				event.id = id;
				done(null, event)
			}), leo.write(id, {
				firehose: true,
				debug: true
			}), ls.toCheckpoint({
				debug: true
			}));
		},
		run: function (id, source, transform, opts, callback) {
			if (typeof opts === "function") {
				callback = opts;
				opts = {};
			}

			opts = Object.assign({
				debug: false
			}, opts);

			return ls.pipe(
				leo.read(id, source, {
					debug: opts.debug
				}),
				ls.process(id, transform),
				this.write(id, opts.suffix),
				callback
			);
		}
	}
};