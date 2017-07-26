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
1. Install using npm

```
npm install leo-sdk
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

## Offload events off the Leo Platform
```
<?php 
require_once("vendor/autoload.php");

use LEO\Stream;

$config = [
	"enableLogging"	=> true,
	"config"	=> [
		"realtime"  => "Leo-LeoStream-??????????",
		"standard" => "Leo-BusToS3-??????????",
		"mass"	   => "leo-s3bus-??????????"
	]
];

$bot_name = "OffloaderBot";
$queue_name = "EnrichedQueueName";
$target_name = "TargetSystem";
$read_options = ['limit'=>50, 'run_time'=> "5 seconds"];

$offload_function = function ($event) {
			var_dump($event);
			
			//Do some API calling to offload the data
			
			return [
				"result"=>$result
			];
		};

$leo = new Stream($bot_name, $config);

$stream = $leo->createOffloadStream($queue_name, $target_name, $read_options, $offload_function);

$stream->end();
```

### Possible values for read_options:

* **buffer:** Number of events to read into buffer before the sdk begins processing.
* **loops:** How many iterations to execute before finishing
* **start:** Checkpoint from where you want to begin reading events
* **limit:** Number events to fetch during this execution
* **size:** size of the buffer. e.g. 5M
* **debug:** whether or not to run in debug mode. e.g. *true* or *false*
* **run_time:** max time that the script should run before shutting down and completing execution e.g. *5 seconds*


Logging
-------
The Leo SDK will pass your PHP logs up to the Leo Platform so that you can debug them using the Data Innovation Center user interface.

You do this when you instantiate a new LEO/Stream object by passing in **enableLogging** with a value of **true**.

```
$test = new Stream("Test Bot", [
	"enableLogging"=>true,
	"config"=>[
		"realtime"  => "Leo-LeoStream-??????????",
		"standard" => "Leo-BusToS3-??????????",
		"mass"	   => "leo-s3bus-??????????"
	]
]);

```
