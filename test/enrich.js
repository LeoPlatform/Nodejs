"use strict";

var aws = require("aws-sdk");
var awsProfile = "default";

var credentials = new aws.SharedIniFileCredentials({
	profile: awsProfile
});
aws.config.credentials = credentials;

var leo = require("leo-sdk")({
	s3: "leo-s3bus-????????",
	firehose: "Leo-BusToS3-????????",
	kinesis: "Leo-KinesisStream-????????",
	region: "us-west-2"
});

var enrichmentBot = "EnrichBot";
var sourceQueue = "TestQueue";
var destinationQueue = "EnrichedQueue";


leo.enrich({
	id: enrichmentBot,
	inQueue: sourceQueue,
	outQueue: destinationQueue,
	transform: (payload, metadata, done) => {
		
		var event = {
			time: Date.now(),
			number: payload.number * -1,
			newdata: "this is enriched"
		};
		
		done(null, event);
	}
}, (err) => {
	console.log("finished", err || "");
});