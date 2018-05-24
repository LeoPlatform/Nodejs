var os = require("os");
var path = require("path");
var fs = require("fs");
var AWS = require("./leo-aws");
var https = require("https");
var moment = require("moment");
var uuid = require("uuid");

const accessor = {};

module.exports = function (id, opts) {

	opts = Object.assign({
		version: 'latest'
	}, opts);
	var startTime = Date.now();


	//console.log(opts);
	var client = new AWS.CloudWatchLogs({
		region: opts.aws.region,
		httpOptions: {
			agent: new https.Agent({
				ciphers: 'ALL',
				secureProtocol: 'TLSv1_method',
				keepAlive: true
			})
		},
		credentials: opts.credentials
	});

	var configFile = path.resolve(os.tmpdir(), `leolog_${id.toString()}.json`);
	var config = null;


	var logGroupName = `/aws/lambda/${id}`;

	var requestId = uuid.v1();

	function addMessage(message) {
		if (message == "\n") {
			return;
		}
		logs.push({
			timestamp: Date.now(),
			message: moment().toISOString() + `	${requestId}	${message}`
		});
	}

	var oldStdOut = process.stdout.write;
	var oldStdErr = process.stderr.write;
	process.stdout.write = function (string, encoding, fd) {
		oldStdOut.apply(process.stdout, arguments);
		addMessage(string);
	};

	process.stderr.write = function (string, encoding, fd) {
		oldStdErr.apply(process.stderr, arguments);
		addMessage(string);
	};



	var logs = [];
	addMessage(`START RequestId: ${requestId} Version: ${opts.version}`);

	function createLogStream(callback) {
		var logStreamName = moment().format("YYYY/MM/DD/") + `${opts.version}/${os.hostname()}/` + Date.now();
		client.createLogGroup({
			logGroupName: logGroupName
		}, (err, data) => {
			if (err && err.code != "ResourceAlreadyExistsException") {
				callback(err);
			} else {
				config = {
					logGroupName: logGroupName,
					logStreamName: logStreamName
				};
				client.createLogStream(config, (err, data) => {
					config.sequenceNumber = undefined;
					fs.writeFile(configFile, JSON.stringify(config, null, 2), (err, data) => {
						callback(err, config);
					});
				});
			}
		});
	}

	function getLogStream(callback) {
		if (config) {
			callback(null, config);
		} else {
			fs.exists(configFile, (exists) => {
				console.log(exists);
				if (!exists) {
					console.log("creating log stream", configFile);
					createLogStream(callback);
				} else {
					console.log("reading log stream", configFile);
					fs.readFile(configFile, (err, data) => {
						config = JSON.parse(data);
						callback(err, config);
					});
				}
			});
		}
	}

	function sendEvents(callback) {
		console.log("sending events");
		getLogStream((err, config) => {
			console.log(config);
			if (err) {
				callback(err);
			} else {
				client.putLogEvents({
					logEvents: logs.slice(0),
					logGroupName: config.logGroupName,
					logStreamName: config.logStreamName,
					sequenceToken: config.sequenceNumber
				}, (err, data) => {
					console.log(err, data);
					if (err) {
						callback(err);
					} else {
						console.log(data);
						config.sequenceNumber = data.nextSequenceToken;
						fs.writeFile(configFile, JSON.stringify(config, null, 2), callback);
					}
				});
				logs = [];
			}

		});
	}

	var logger = {
		sendEvents,
		end: function (callback) {
			process.stdout.write = oldStdOut;
			process.stderr.write = oldStdErr;

			var memory = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(0);

			addMessage(`REPORT RequestId: ${requestId}	Duration: ${Date.now() - startTime} ms	Billed Duration: 0 ms Memory Size: ${memory} MB	Max Memory Used: ${memory} MB`);

			sendEvents(callback);

		}
	};

	process.once("beforeExit", () => {
		logger.end((err) => {
			if (err) {
				console.log("Error uploading logs to aws:", err);
			}
			console.log("Finished uploading logs", config.logGroupName);
		});
	});
	process.on("uncaughtException", (err) => {
		// "beforeExit" is not called on uncaught exceptions
		// By catching and logging the error it adds to the event loop and causes "beforeExit" to fire
		console.error(err);
	});
	accessor.logger = logger;
	return logger;
};

module.exports.accessor = accessor;
