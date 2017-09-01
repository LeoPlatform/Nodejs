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
```

### Possible values for config:

These values are not usually necessary.  Only use these if you know what you are doing.

* **records**: Size of buffer before sending to kinesis *default:* 10
* **size**: Size in bytes (after gzipping) of the buffer before sending to kinesis *default:* 204800 - (200K)
* **time**: maximum time to wait after write call before it sends to kinesis *default:*{ seconds: 3 } **NOTE:** This is a moment.duration parseable object [moment.js](https://momentjs.com/docs/#/durations/)
* **debug**: turn off and on some extra logging
* **enableLogging:** if true, your process's log output will be sent to AWS and associated with this bot to view through the UI (not yet implemented) *default:* true
* **chunk.records:** Max number of records to include before zipping and chunking records
* **chunk.size:** Max size in bytes of records before zipping and chunking records
* **chunk.time:** Max time to wait before zipping and chunking records


## Enrich events on the Leo Platform
```
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

```

### Possible values for config:

These values are not usually necessary.  Only use these if you know what you are doing.

#### Read

* **buffer:** Maximum number events queued up and ready to process by your function
* **loops:** How many iterations to execute before finishing
* **start:** Checkpoint from where you want to begin reading events *default:* last read event exclusive
* **limit:** Number events to fetch during this execution
* **size:** maximum number of bytes to process during an execution. e.g. 5M
* **debug:** whether or not to run in debug mode and enable extra logging. e.g. *true* or *false*
* **stopTime:** timestamp of when this execution should stop retrieving events 
* **runTime:** max time that the script should run before shutting down and completing execution e.g.  e.g. moment.now()
 

**NOTE:** You should use either stopTime or runTime, not both.  You may also exclude those values and the SDK will feed you events until size, loops, or limits are hit.

#### Write

* **records**: Size of buffer before sending to kinesis *default:* 10
* **size**: Size in bytes (after gzipping) of the buffer before sending to kinesis *default:* 204800 - (200K)
* **time**: maximum time to wait after write call before it sends to kinesis *default:*{ seconds: 3 } **NOTE:** This is a moment.duration parseable object [moment.js](https://momentjs.com/docs/#/durations/)
* **debug**: turn off and on some extra logging
* **enableLogging:** if true, your process's log output will be sent to AWS and associated with this bot to view through the UI (not yet implemented) *default:* true
* **chunk.records:** Max number of records to include before zipping and chunking records
* **chunk.size:** Max size in bytes of records before zipping and chunking records
* **chunk.time:** Max time to wait before zipping and chunking records


## Offload events off the Leo Platform
```
"use strict";

//If you need to use a profile other than default
var aws = require("aws-sdk");
var awsProfile = "default";
var credentials = new aws.SharedIniFileCredentials({
	profile: "default"
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
		console.log("Each", meta.eid, meta.units);
		//payload is object if batch isn't specified, otherwise it will be array of objects
		
		//Do something with this payload like load to Elastic Search
		
		//must call done to cause a checkpoint
		done(null, true);
	}
}, (err) => {
	//this is called after all events have run through your function 
	console.log("All Done processing events", err || "");
});
```
### Notes on **batch** and **each** functions

#### Each

This function will be passed events from off of the stream.  They will come in the format of an object for each event, or as an array of objects
if there is a batch function used to combine events.


#### Batch

Sometimes when loading to an external system, you do not want to send events over one at a time. For example, loading to Redshift or Elastic Search
which load way more efficiently with larger batches.  For this purpose, you can map events through a batching function to compile into a format that
makes sense for bulk loading.

* Specify the number of records you want to include in a single batch using the **batch.size** parameter.
* Whatever you pass to the **done** function of the map will be passed to the **each** function as an array
* If you exclude the **batch** function from your call, the **each** function will receive events one at a time as an object


### Possible values for config:

#### Read

* **buffer:** Maximum number events of queued up and ready to process by your function *default:* 1000
* **loops:** How many iterations to execute before finishing *default:* 100
* **start:** Checkpoint from where you want to begin reading events.  It will begin with the next event after the one you pass. *default:* last read event.
* **limit:** Number of events to fetch during this execution *default:* no limit
* **size:** maximum number of bytes to process during an execution. e.g. 5M *default:* no limit
* **debug:** whether or not to run in debug mode and enable extra logging. e.g. *true* or *false*. *default:* false
* **stopTime:** timestamp of when this execution should stop retrieving events *default:* 240 seconds from the execution start time
* **runTime:** max time that the script should run before shutting down and completing execution e.g.  e.g. { minutes: 4 } **NOTE:** This is a moment.duration parseable object [moment.js](https://momentjs.com/docs/#/durations/)
 

**NOTE:** You should use either **stopTime** or **runTime**, not both.  You may also exclude those values and the SDK will feed you events until size, loops, or limits are hit.

## Subscribing to a Queue

If you are running in AWS using Lambda, LEO can trigger your Lambda to run when a new event enters a queue.  To do so is as easy as calling a subscribe function.  
This should be done upon deployment of your Lambda.  This function can be called as many times as you want.

```
"use strict";

//Create the leo api object with configuration to your API.
//The only configuration that you need is the domain of install
var leoapi = require("leo-sdk/api")({
	domainName: "staging.leoplatform.io"
});

var botName = "Subscribed Bot";
var queueName = "TestQueue";

var config = { };


leoapi.subscribe(botName, queueName, config)
	.then((data) => {
		console.log(data);
	})
	.catch(console.log);


```

### IMPORTANT:  It is important that you understand how subsribe affects the checkpoint of your bot.  Here is how it works:

* The first time you call subscribe, the checkpoint value will be set to **now**.  e.g. it will start processing only future events.
* If you call subscribe again for a bot and queue combination, the checkpoint is not altered from where it is currently at.
* If you pass in a checkpoint value to the subscribe function, it will set the checkpoint to that location.
* To set the checkpoint to the beginning of time, pass in a value of 0.

### Possible values for config

* **checkpoint:** Pass in a checkpoint value if you want your bot to start processing events from a specific checkpoint
* **lambdaName:** You can pass in a specific Lambda Name or ARN if it is different than the bot identifier passed as the botName param.
