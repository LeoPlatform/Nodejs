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
3. Install node - https://nodejs.org/en/

Install SDK
-----------
1. Install using npm.  In your project folder run the following command.

```
npm install leo-sdk
```

Configuration
-------------

You can now configure a profile that will be used with your sdk similar to the way the AWS SDK works.  To do this, you must execute a command line script and enter in your configuration settings.

Issue the following command from your project directory:

```
node node_modules/leo-sdk/generateProfile.js -r ${region} ${LeoSdkStack}
```

* "${region}" is your leo bus AWS region. eg. us-west-2
* "${LeoSdkStack}" is the name of your leo bus AWS stack. eg. "StagingLeo"

This will create a file in your home directory `~/.leo/config.json` that contains your settings.  You can setup multiple profiles just like you can do with the AWS SDK by specifying a different Stack.  


How to use the Leo SDK
===================================

Now you can write to the new Stream

```
var leo = require("leo-sdk");
var botId = "producerBotId";
var queueName = "queueName";
var stream = leo.load(botId, queueName);

// Write 10 events to the leo bus
for (let i = 0; i < 10; i++) {
  stream.write({
    now: Date.now(),
    index: i,
    number: Math.round(Math.random() * 10000)
  });
}
stream.end(err=>{
	console.log("All done loading events", err);
});
```

Next in order to read from the stream

```
var leo = require("leo-sdk");
var botId = "offloadBotId";
var queueName = "queueName";
leo.offload({
	id: botId,
	queue: queueName,
	each: (payload, meta, done) =>{
		console.log(payload);
		console.log(meta);
		done(null, true); // Report this event was handled
	}
}, (err)=>{
	console.log("All done processing events", err);
});
```


You can also enrich from one queue to another 

```
var leo = require("leo-sdk");

var botId = "enrichBotId";
var inQueueName = "queueName";
var outQueueName = "enrichedQueueName";
leo.enrich({
	id: botId,
	inQueue: inQueueName,
	outQueue:outQueueName,
	each: (payload, meta, done) =>{

		// Add new data to the event payload
		done(null, Object.assign({
			enriched: true,
			numberTimes2: payload.number * 2,
			enrichedNow: Date.now()
		}, payload));
	}
}, (err)=>{
	console.log("All done processing events", err);
});
```


Manual Configuration Setup
===================================

1. Create a file at ~/.leo/config.json
2. Add profile to the ~/.leo/config.json
	Values can be found under Resources in the AWS Stack

```
{
	"${LeoSdkStack}": {
		"region": "${Region}",
		"kinesis": "${LeoKinesisStream}",
		"s3": "${LeoS3}",
		"firehose": "${LeoFirehoseStream}",
		"resources": {
			"LeoStream": "${LeoStream}",
			"LeoCron": "${LeoCron}",
			"LeoEvent": "${LeoEvent}",
			"LeoSettings": "${LeoSettings}",
			"LeoSystem": "${LeoSystem}",
			"LeoS3": "${LeoS3}",
			"LeoKinesisStream": "${LeoKinesisStream}",
			"LeoFirehoseStream": "${LeoFirehoseStream}",
			"Region": "${Region}"
		}
	}
}
```