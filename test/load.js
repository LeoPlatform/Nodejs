"use strict";

//If you need to use a profile other than default
var aws = require("aws-sdk");
var awsProfile = "default";
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

var loaderBot = "LoaderBot";
var queueName = "TestQueue";

//These are optional parameters, see the docs for possible values
var config = {};

//create a loader stream
var stream = leo.load(loaderBot, queueName, config);
for (var i = 0; i < 100; i++) {
	var event = {
		now: Date.now(),
		index: i,
		number: Math.round(Math.random() * 10000)
	};
	//write an event to the stream
	stream.write(event);
}
// Must end the stream to finish sending the events
stream.end(err => {
	err && console.log("Error:", err);
	console.log("done writing events");
});