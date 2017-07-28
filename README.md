LeoPlatform/Nodejs
===================

Leo Nodejs SDK

A Nodejs interface to interact with the Leo Platform

Documentation: https://docs.leoplatform.io

How to install the Leo SDK
===================================

Pre-Requisites
--------------
1. Install the aws-cli toolkit - Instructions for this are found at http://docs.aws.amazon.com/cli/latest/userguide/installing.html
2. Configure the aws-cli tools - Instructions are found at http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html

Your access key and secret key can be obtained in your AWS console. If you were not sent your keys when you signed up, contact Leo support for your access keys if you are running a managed instance.

Install SDK
-----------
1. Install using npm.  In your project folder run the following command.

```
npm install leo-sdk --save
```

Example Usage
=============

Replace the ???? values in this example script with the appropriate values from your installation.  
They can be found in Leo console.  For more information on how to obtain these values, see [AWS Configuration](https://docs.leoplatform.io/docs/aws-configuration)

## Load events to Leo Platform
```
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

var loaderBot = "LoaderBot";
var queueName = "TestQueue";


var stream = leo.load(loaderBot, queueName);
for (var i = 0; i < 100; i++) {
	var event = {
		now: Date.now(),
		index: i,
		number: Math.round(Math.random() * 10000)
	};
	stream.write(event);
}
stream.end(err => {
	err && console.log("Error:", err);
	console.log("done writing events");
});
```

## Enrich events on the Leo Platform
```
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

```

## Offload events off the Leo Platform
```
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

```

