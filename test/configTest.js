"use strict";

const c = {
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
};
var leo = require("../index.js")(c);
var moment = require("moment");
var async = require("async");


console.log("has this changed", c);

var stream = leo.load("ConfigLoadTest", "configLoadTestQueue", {
	useS3: true,
	debug: false,
	autoDetectPayload: false
});


//for (let i = 0; i < 100; i++) {
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
	stream.once("drain", () => {
		queue.push({});
	});
	callback();
});
queue.push({});



// while (true) {
// 	if (!waiting) {
// 		console.log("writting", i)
// 		let result = stream.write({
// 			payload: {
// 				innerdata: Math.round(Math.random() * 100)
// 			},
// 			now: moment().format(),
// 			index: i,
// 			number: Math.round(Math.random() * 10000),
// 			v: 2
// 		});
// 		i++;
// 		if (!result) {
// 			waiting = true;
// 			stream.once("drain", () => {
// 				waiting = false;
// 			});
// 		}
// 	}
// }
// stream.end(err => {
// 	console.log("done writting events");
// });