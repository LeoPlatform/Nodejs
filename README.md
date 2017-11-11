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


Install SDK
-----------
1. Install using npm.  In your project folder run the following command.

```
npm install leo-sdk --save
```

Configuration
-------------

You can now configure a profile that will be used with your sdk similar to the way the AWS SDK works.  To do this, you must execute a command line script and enter in your configuration settings.

Issue the following command from your project directory, you will be prompted for the values:

```
$ node node_modules/leo-sdk/generateProfile.js -r us-west-2 DevStream
{ region: 'us-west-2' }
[ 'Sample' ]

```

This will create a file in your home directory `~/.leo/config.json` that contains your settings.  You can setup multiple profiles just like you can do with the AWS SDK by specifying a different Stack.  


Now you can write to the new Stream

```
process.env.LEO_DEFAULT_PROFILE = "DevStream";
var leo = require("leo-sdk");
var stream = leo.load("producer", "queuename");
for (let i = 0; i < 10; i++) {
  stream.write({
    now: Date.now(),
    index: i,
    number: Math.round(Math.random() * 10000)
  });
}
stream.end(err=>{
	console.log("All done");
});
```

Next in order to read from the stream

```
process.env.LEO_DEFAULT_PROFILE = "DevStream";
var leo = require("leo-sdk");
let count=0;
leo.offload({
	id: "offload",
	queue: "queuename",
	each: (payload, meta, done) =>{
		count++;
		console.log(payload);
		console.log(meta);
	}
}, (err)=>{
	console.log("All done processing events", err);
	done();
});
```
