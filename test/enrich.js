"use strict";

var aws = require("aws-sdk");
var awsProfile = "default";

//If you need to use a profile other than default
var credentials = new aws.SharedIniFileCredentials({
	profile: awsProfile
});
aws.config.credentials = credentials;

//Create the leo object with configuration to your AWS resources.
//These values are required.  See docs for how to obtain them
var leo = require("leo-sdk")({
	s3: "leo-s3bus-????????",
	firehose: "Leo-BusToS3-????????",
	kinesis: "Leo-KinesisStream-????????",
	region: "us-west-2"
});

var enrichmentBot = "EnrichBot";
var sourceQueue = "TestQueue";
var destinationQueue = "EnrichedQueue";

//These are optional parameters, see the docs for possible values
var config = { };

//create an enrich stream
leo.enrich({
	id: enrichmentBot,
	inQueue: sourceQueue,
	outQueue: destinationQueue,
	config: config,
	transform: (payload, metadata, done) => {
		//payload is the event data
		//meta is info about the event, timestamps, checkpointId, etc.
		
		//perform any kind of transformation, lookup to external dbs, or services, etc.
		var event = {
			time: Date.now(),
			number: payload.number * -1,
			newdata: "this is enriched"
		};
		
		//done function must be called in order to complete enrichment
		done(null, event);
	}
}, (err) => {
	//this is called after all events have run through your function and been sent back to the Leo platform
	console.log("finished", err || "");
});