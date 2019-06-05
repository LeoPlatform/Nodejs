"use strict";
let config = require("../leoConfigure.js");
module.exports = function (configOverride, botHandler) {
	if (!botHandler) {
		botHandler = configOverride;
		configOverride = {};
	}
	Object.assign(config, configOverride);
	return function (event, context, callback) {
		context.callbackWaitsForEmptyEventLoop = false;
		if (context.identity) { // Called Directly not via Api Gateway
			event = {
				body: event.body,
				httpMethod: event.httpMethod,
				queryStringParameters: event.queryStringParameters,
				headers: {
					Cookie: event.headers && event.headers.Cookie,
				},
				requestContext: {
					requestId: context.awsRequestId,
					identity: context.identity
				}
			};
		}
		context.botId = config.name;
		for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
			process.removeListener('uncaughtException', x);
		}
		process.on('uncaughtException', function (err) {
			console.error((new Date).toUTCString() + ' uncaughtException:', err.message);
			console.error(err.stack);
			callback(null, {
				statusCode: 500,
				'Content-Type': 'application/json',
				body: JSON.stringify("Application Error")
			});
		});
		if (event.requestContext) { //new lambda proxy method
			if (event.isBase64Encoded) {
				event.body = Buffer.from(event.body, 'base64');
			} else if (event.body && typeof event.body !== "object") {
				event.body = JSON.parse(event.body);
			}
			event.params = {
				path: event.pathParameters || {},
				querystring: event.queryStringParameters || {}
			};
			Object.keys(event.params.path).map((key) => {
				event.params.path[key] = decodeURIComponent(event.params.path[key]);
			});
		}
		event.pathParameters = event.pathParameters || {};
		event.queryStringParameters = event.queryStringParameters || {};
		let promise = botHandler(event, context, function (err, data) {
			if (data && typeof data === "object" && "statusCode" in data) {
				if (config.cors && !("Access-Control-Allow-Origin" in data.headers)) {
					data.headers["Access-Control-Allow-Origin"] = config.cors;
				}
				callback(null, data);
			} else if (err === "Access Denied" || err === "Error: Access Denied") {
				callback(null, {
					statusCode: 403,
					headers: {
						'Content-Type': config.ErrorContentType || 'text/html',
						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
					},
					body: err.toString()
				});
			} else if (err) {
				console.log(err);
				if (typeof err === "object" && "statusCode" in err) {
					if (config.cors && err.headers && !("Access-Control-Allow-Origin" in err.headers)) {
						err.headers["Access-Control-Allow-Origin"] = config.cors;
					}
					callback(null, err)
				} else {
					callback(null, {
						statusCode: 500,
						headers: {
							'Content-Type': config.ErrorContentType || 'text/html',
							"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
						},
						body: err.toString()
					});
				}
			} else {
				callback(null, {
					statusCode: 200,
					headers: {
						'Content-Type': config.ContentType || 'application/json',
						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
					},
					body: JSON.stringify(data)
				});
			}
		});

		if (promise && promise.catch) {
			promise.catch(err => {
				if (err === "Access Denied" || err === "Error: Access Denied") {
					callback(null, {
						statusCode: 403,
						headers: {
							'Content-Type': config.ErrorContentType || 'text/html',
							"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
						},
						body: err.toString()
					});
				} else if (err) {
					console.log(err);
					callback(null, {
						statusCode: 500,
						headers: {
							'Content-Type': config.ErrorContentType || 'text/html',
							"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
						},
						//we caught an error they didn't send us, don't reveal it here
						body: "Unexpected Server Error"
					});
				}
			});
		}
	};
};
