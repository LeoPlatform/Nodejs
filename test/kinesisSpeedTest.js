"use strict";
var leo = require("../index.js");
var moment = require("moment");
var async = require("async");


var stream = leo.load("KinesisSpeedTest", "KinesisSpeedTestQueue", {
	useS3: false,
	debug: true,
	autoDetectPayload: true,
	records: 0
});


let i = 0;

let queue = async.queue(function (task, callback) {
	let result = true;
	while (result) {
		i++;
		if (i % 50000 == 0) {
			console.log("Count", i)
		}
		result = stream.write({
			payload: {
				innerdata: Math.round(Math.random() * 100)

			},
			now: moment().format(),
			index: i,
			number: Math.round(Math.random() * 10000),
			v: 2,
			daolyap: {
				atadrenni: Math.round(Math.random() * 100)

			},
			won: moment().add({
				seconds: 30
			}).format(),
			xedni: i,
			rebmun: Math.round(Math.random() * 10000),
			version: 2
		});
	}
	if (!result) {
		console.log("Waiting for Drain")
		stream.once("drain", () => {
			console.log("Drain Done")
			queue.push({});
		});
	} else {
		queue.push({});
	}
	setTimeout(function () {
		callback();
	}, 1000);
}, 1);
queue.push({});