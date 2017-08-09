"use strict";

//If you need to use a profile other than default
var aws = require("aws-sdk");
var awsProfile = "default";
var credentials = new aws.SharedIniFileCredentials({
	profile: "omadi"
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

var offloaderBot = "OffloaderBot";
var sourceQueue = "EnrichedQueue";

//These are optional parameters, see the docs for possible values
var config = {};

//create a loader stream
leo.offload({
	id: offloaderBot,
	inQueue: sourceQueue,
	config: config,
	batch: {
		//number of events to include in this batch
		size: 10000,
		map: (payload, meta, done) => {
			//transform events to be included in this batch
			console.log("Batch Map", payload)
			done(null, payload);
		}
	}, 
	each: (payload, meta, done) => {
		//payload is object if batch isn't specified, otherwise it will be array of objects
		console.log("Each", meta.eid, meta.units);
		
		//Do something with this payload like load to Elastic Search
		
		//must call done to cause a checkpoint
		done(null, true);
	}
}, (err) => {
	//this is called after all events have run through your function 
	console.log("All Done processing events", err || "");
});
