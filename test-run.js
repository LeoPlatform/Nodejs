"use strict";
var moment = require("moment");
var leo = require("leo-sdk")({
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
});

var toRun = "load";

if (toRun == "load") {

	var stream = leo.load("ckzSDKLoad", "ckzOutQueue2");
	for (let i = 0; i < 10000; i++) {
		stream.write({
			now: moment().format(),
			index: i,
			number: Math.round(Math.random() * 10000)
		});
	}
	stream.end(err => {
		console.log("done writing events");
	});

} else if (toRun == "enrich") {

	leo.enrich({
		id: "ckzSDK2",
		inQueue: "ckzOutQueue2",
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
	});

} else if (toRun == "offload") {

	leo.offload({
		id: "ckzSDK_offload",
		queue: "ckzOutQueue3",
		batch: {
			size: 10000,
			map: (payload, meta, done) => {
				//console.log("My Batch Map", payload)
				done(null, payload);
			}
		}, // object or number 
		each: (payload, meta, done) => {
			console.log("Each", meta.eid, meta.units);
			done(null, true);
		}
	}, (err) => {
		console.log("All Done processing events", err);
	});

} else {
	console.log("set toRun to either 'load', 'enrich', or 'offload'")
}