LeoPlatform/Nodejs
===================

Leo Nodejs SDK

A php interface to interact with the Leo Platform

Documentation: https://docs.leoinsights.com

How to install the Leo SDK
===================================

Composer
--------
The Leo SDK uses Composer for installation (https://getcomposer.org/doc/01-basic-usage.md)

```
$ curl -sS https://getcomposer.org/installer | php
$ php composer.phar install
```

Example Usage
-------------

Load events to Leo Platform
```
$leo = new Leo(<oauth_token>, <oauth_token_secret>, <args>);

$stream = $leo->createBufferedWriteStream("SOMETEST", [], function ($checkpointData) {
	var_dump($checkpointData);
});
for($i = 0; $i < 1000000; $i++) {
	$stream->write("neworder-mass",[
		"id"=>"testing-$i",
		"data"=>"some order data",
		"other data"=>"some more data"
	], ["source"=>null, "start"=>$i]);
}


$stream->end();
```

???????? Read events from a queue ?????????
```
$leo = new Leo(<oauth_token>, <oauth_token_secret>, <args>);

$stream = $leo->createBufferedReadStream("SOMETEST", [], function ($checkpointData) {
	var_dump($checkpointData);
});
```

Logging
-------
The Leo SDK will pass your Nodejs logs up to the Leo Platform so that you can debug them using the Data Innovation Center user interface.

```
$args = array (
  'logging' => true
);

$leo = new Leo(<oauth_token>, <oauth_token_secret>, $args);
```


How to Run the Unit Tests
-------------------------

```
Instructions to install phpunit
```

The unit tests are in the `/tests` directory.

All Tests
---------

```
$ phpunit 
```

Test Groups
-----------
```
$ phpunit --group <groupName> 
```

Single Test 
-----------
```
$ phpunit tests/unit/<file_name.php>
```

Developer Information
---------------------

The Leo Nodejs SDK uses npm's packaging blah blah
