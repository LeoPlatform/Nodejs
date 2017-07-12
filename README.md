LeoPlatform/Nodejs
===================

Leo Nodejs SDK

A nodejs interface to interact with the Leo Platform

Documentation: https://docs.leoplatform.io

How to install the Leo SDK
===================================

NPM
--------
The Leo SDK uses NPM for installation (https://npmjs.com)

```
Instructions to install npm
$ blah
```

Example Usage
-------------

Load events to Leo Platform
```
"use strict";
process.env.TZ = 'America/Denver';

var leo = require("@leo-sdk/core");
var stream = leo.createStreamWrite("SOMETEST");

for($i = 0; $i < 1000000; $i++) {
	stream.write("neworder-mass", 
  	{
    	"id": "testing-{$i}",
			"data": "some order data",
      "other data": "some more data"
    }, 
    {
			"source": null,
      "start": $i
    }
  );	
}


stream.end(function (err) {
	if(err) {
  	console.log("Error writing");
  } else {
  	console.log("Successful write");
  }
});

```

???????? Read events from a queue ?????????
```

var leo = require("@leo-sdk/core");
var stream = leo.createStreamRead("SOMETEST");
```

Logging
-------
The Leo SDK will pass your Nodejs logs up to the Leo Platform so that you can debug them using the Data Innovation Center user interface.

```

```


How to Run the Unit Tests
-------------------------

```
Instructions to install mocha
```

The unit tests are in the `/tests` directory.

All Tests
---------

```
$ npm test 
```

Test Groups
-----------
```
$ npm test 
```

Single Test 
-----------
```
$ npm test tests/unit/<file_name.js>
```

Developer Information
---------------------

The Leo Nodejs SDK uses npm's packaging blah blah
