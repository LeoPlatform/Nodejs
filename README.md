LeoPlatform/Nodejs
===================

Leo Nodejs SDK

A Nodejs interface to interact with the Leo Platform

Quick Start Guide: https://github.com/LeoPlatform/Leo

Documentation: https://docs.leoplatform.io

How to install the Leo SDK
===================================

Pre-Requisites
--------------
1. Install the aws-cli toolkit - Instructions for this are found at http://docs.aws.amazon.com/cli/latest/userguide/installing.html
2. Configure the aws-cli tools - Instructions are found at http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html
3. Install node - https://nodejs.org/en/
4. Create a Leo Bus Stack - https://github.com/LeoPlatform/Leo#install-the-leo-platform-stack

Install SDK
-----------
1. Install using npm. In your project folder run the following command.

```
npm install leo-sdk
```

Configuration
-------------
To load data onto the bus on AWS, you need to have a valid leo_config.js file. If you don't have one already, the easiest
way to create one is to create a [quickstart project](https://github.com/LeoPlatform/Leo#step-3-create-a-quickstart-project)
and let the system configure the AWS settings for you.

How to use the Leo SDK
===================================

Note: If you're using the SDK within a microservice, we bootstrap the config for you, otherwise you'll have to specify the
path to your leo_config.js.

Bash example:
```bash
export leo_config_bootstrap_path='/path/to/leo_config.js'
```
Javascript example:
```javascript
process.env.leo_config_bootstrap_path = '/path/to/leo_config.js';
```

Next, you'll have to make sure your NODE_ENV matches the environment configured in leo_config.js.

Now you can write to the new Stream:

```javascript
let leo = require("leo-sdk");
let botId = "producerBotId";
let queueName = "queueName";
let stream = leo.load(botId, queueName);

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

```javascript
let leo = require("leo-sdk");
let botId = "offloadBotId";
let queueName = "queueName";
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

```javascript
let leo = require("leo-sdk");

let botId = "enrichBotId";
let inQueueName = "queueName";
let outQueueName = "enrichedQueueName";
leo.enrich({
    id: botId,
    inQueue: inQueueName,
    outQueue:outQueueName,
    // optional batch parameter:
    batch: 50, // batch every 50 records, or:
    // optional batch as object with optional parameters:
    batch: {
        count: 50, // batch every 50 records, or:
        bytes: 500, // batch every 500 bytes, or:
        time: 1000, // batch every 1000 milliseconds (1 second)
    },
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

# Support
Want to hire an expert, or need technical support? Reach out to the Leo team: https://leoinsights.com/contact
