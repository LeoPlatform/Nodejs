var AWS = require('aws-sdk');
var https = require("https");

module.exports = function (configure = {}) {
	var docClient = new AWS.DynamoDB.DocumentClient({
		region: configure.region || (configure.aws && configure.aws.region),
		maxRetries: 2,
		convertEmptyValues: true,
		// logger: process.stdout,
		httpOptions: {
			agent: new https.Agent({
				ciphers: 'ALL',
				secureProtocol: 'TLSv1_method',
				// keepAlive: true
			})
		}
	});
	return {
		docClient: docClient,

		get: function (table, id, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			docClient.get({
				TableName: table,
				Key: {
					[opts.id || 'id']: id
				},
				ConsistentRead: true,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function (err, data) {
				if (err) {
					console.log(err);
					callback(err);
				} else {
					callback(null, data.Item);
				}
			});
		},

		put: function (table, id, item, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			item[opts.id || 'id'] = id;
			docClient.put({
				TableName: table,
				Key: {
					[opts.id || 'id']: id
				},
				Item: item,
				"ReturnConsumedCapacity": 'TOTAL'
			}, function (err) {
				if (err) {
					console.log(err);
					callback(err);
				} else {
					callback(null, "Success");
				}
			});
		},

		merge: function (table, id, obj, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			this.get(table, id, opts, (err, data) => {
				if (err) {
					return callback(err);
				}
				var data = extend(true, data, obj);
				this.put(table, id, data, opts, callback)
			});
		},

		update: function (table, key, set, opts, callback) {
			if (!callback) {
				callback = opts;
				opts = {};
			}
			var sets = [];
			var names = {};
			var attributes = {};

			for (var k in set) {
				if (set[k] != undefined) {
					var fieldName = k.replace(/[^a-z]+/ig, "_");
					var fieldOpts = opts.fields && opts.fields[k] || {};
					if (fieldOpts.once) {
						sets.push(`#${fieldName} = if_not_exists(#${fieldName}, :${fieldName})`);
					} else {
						sets.push(`#${fieldName} = :${fieldName}`);
					}
					names[`#${fieldName}`] = k;
					attributes[`:${fieldName}`] = set[k];
				}
			}

			if (Object.keys(attributes) == 0) {
				attributes = undefined;
			}
			if (Object.keys(names) == 0) {
				names = undefined;
			}

			var command = {
				TableName: table,
				Key: key,
				UpdateExpression: sets.length ? 'set ' + sets.join(", ") : undefined,
				ExpressionAttributeNames: names,
				ExpressionAttributeValues: attributes,
				"ReturnConsumedCapacity": 'TOTAL'
			};
			if (opts.ReturnValues) {
				command.ReturnValues = opts.ReturnValues;
			}
			docClient.update(command, callback);
		}
	};
}