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
1. Create or add to your composer.json

```
{
    "repositories": [
        {
            "type": "vcs",
            "url": "https://github.com/LeoPlatform/PHP.git"
        }
    ],
    "require": {
        "leoplatform/php": "dev-master"
    }
}
```

2. Use Composer to install the SDK.  (https://getcomposer.org/doc/01-basic-usage.md)

```
$ curl -sS https://getcomposer.org/installer | php
$ php composer.phar install
```

Or if you already have composer installed:

```
$ composer install
```

Autoload
---------------------

The Leo PHP SDK uses Composer's autoload functionality to include classes that are needed.  Including the following code into any php file in your project will automatically load the Leo SDK.

```
require_once("vendor/autoload.php");
```

Example Usage
-------------

Replace the ???? values in this example script with the appropriate values from your installation.  
They can be found in your AWS console.  For more information on how to obtain these values, see [AWS Configuration](https://docs.leoplatform.io/docs/aws-configuration)

## Load events to Leo Platform
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
$bot_name = "LoaderBot";
$queue_name = "TestQueue";

$leo = new Stream($bot_name, $config);

$stream_options = [];
$checkpoint_function = function ($checkpointData) {
	//This function is called with every checkpoint
	var_dump($checkpointData);
};

$stream = $leo->createLoadStream($stream_options, $checkpoint_function);

for($i = 0; $i < 10000; $i++) {
	$event = [
		"id"=>"testing-$i",
		"data"=>"some test data",
		"other data"=>"some more data"
	];
	$meta = ["source"=>null, "start"=>$i];
	
	$stream->write($queue_name, $event, $meta);
}
$stream->end();
```

### Possible values for config:

* **enableLogging:** if true, your php log output will be sent to AWS and associated with this bot to view through the UI
* **version:** which platform version should be used, *default* = 'latest'
* **server:** identifier of the location where this code is being run.  Used for debug purposes
* **uploader:** One of 4 values. *kinesis*, *firehose*, *mass*, *auto*.  
* **config.region:** AWS region where your Leo platform is installed
* **config.realtime:** stream identifier for the Leo realtime stream
* **config.standard:** stream identifier for the Leo standard stream
* **config.mass:** stream identifier for the Leo mass stream
	

## Enrich events on the Leo Platform
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

$bot_name = "EnrichmentBot";
$queue_name = "TestQueue";
$enriched_queue_name = "EnrichedQueueName";
$read_options = ['limit'=>50, 'run_time'=> "5 seconds"];

$transform_function = function ($event) {
			var_dump($event);
			$event["newdata"] = "this is some new data";
			return [
				"modified"=>$event
			];
		};

$leo = new Stream($bot_name, $config);

$stream = $leo->createEnrichStream($queue_name, $enriched_queue_name, $read_options, $transform_function);

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
