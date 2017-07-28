"use strict";

var aws = require("aws-sdk");
var awsProfile = "default";

var credentials = new aws.SharedIniFileCredentials({
	profile: "omadi"
});
aws.config.credentials = credentials;

var leo = require("leo-sdk")({
	s3: "leo-s3bus-????????",
	firehose: "Leo-BusToS3-????????",
	kinesis: "Leo-KinesisStream-????????",
	region: "us-west-2"
});


var offloaderBot = "OffloaderBot";
var sourceQueue = "EnrichedQueue";

leo.offload({
	id: offloaderBot,
	queue: sourceQueue,
	batch: {
		size: 10000,
		map: (payload, meta, done) => {
			console.log("Batch Map", payload)
			done(null, payload);
		}
	}, // object or number 
	each: (payload, meta, done) => {
		console.log("Each", meta.eid, meta.units);
		//Do something with this payload like load to Elastic Search
		done(null, true);
	}
}, (err) => {
	console.log("All Done processing events", err || "");
});
