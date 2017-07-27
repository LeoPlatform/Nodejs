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
-------------

Replace the ???? values in this example script with the appropriate values from your installation.  
They can be found in your AWS console.  For more information on how to obtain these values, see [AWS Configuration](https://docs.leoplatform.io/docs/aws-configuration)

## Load events to Leo Platform
```
"use strict";
var leo = require("leo-sdk")({
	s3: "leo-s3bus-1ivp7pn7ci485",
	firehose: "Leo-BusToS3-14917F12E42HL",
	kinesis: "Leo-KinesisStream-1NT04ZIMSYUKV",
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
	console.log(event);
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

var leo = require("leo-sdk")({
	s3: "leo-s3bus-1ivp7pn7ci485",
	firehose: "Leo-BusToS3-14917F12E42HL",
	kinesis: "Leo-KinesisStream-1NT04ZIMSYUKV",
	region: "us-west-2"
});


leo.enrich({
	id: "EnrichBot",
	inQueue: "TestQueue",
	outQueue: "EnrichedQueue",
	transform: (payload, metadata, done) => {
		done(null, {
			time: Date.now(),
			number: payload.number * -1,
			newdata: "this is enriched"
		});
	}
}, (err) => {
	console.log("finished", err || "");
});

```

## Offload events off the Leo Platform
```
"use strict";
var moment = require("moment");
var leo = require("leo-sdk")({
	mass: "leo-s3bus-1r0aubze8imm5",
	standard: "Leo-BusToS3-3JQJ49ZBNP1P",
	realtime: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
});


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
```

