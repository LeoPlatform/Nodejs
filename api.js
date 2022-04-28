"use strict";
var util = require('util');
var extend = require("extend");
var moment = require("moment");

module.exports = function (data) {
	data = Object.assign({}, data);
	var bus = data.bus = data.bus || {};
	var aws = data.aws = data.aws || {};

	if (data.kinesis && !data.stream) {
		data.stream = data.kinesis;
	}

	if (data.s3 && !bus.s3) {
		bus.s3 = data.s3;
	}

	if (data.firehose && !bus.firehose) {
		bus.firehose = data.firehose;
	}

	if (!data.region) {
		data.region = aws.region || 'us-west-2';
	}

	if (data.region && !aws.region) {
		aws.region = data.region;
	}

	delete data.kinesis;
	delete data.s3;
	delete data.fireshose;
	delete data.region;


	if (!data.domainName) {
		throw new Error("Field 'domainName' is required");
	} else if (!data.domainName.match(/^https?:\/\//)) {
		data.domainName = "https://" + data.domainName;
	}

	return {
		subscribe: function (id, queue, data) {
			if (!id || !queue) {
				return Promise.reject("'id' and 'queue' are required");
			}

			return this.bot.get(id).then(bot => {
				data = Object.assign({}, data, {
					id: id,
					triggers: Array.isArray(queue) ? queue : [queue],
					lambda: extend(true, (bot || {}).lambda, {
						settings: [{
							source: queue
						}]
					})
				});
				if (!bot && !data.lambdaName) {
					data.lambdaName = id;
				}

				if (!bot) {
					var timestamp = moment.utc();
					data.checkpoint = 'z' + timestamp.format('/YYYY/MM/DD/HH/mm/ss/');
				}

				if (data.checkpoint && !data.checkpoint.match(/^z/)) {
					var c = data.checkpoint.match(/^\//) ? "" : "/";
					data.checkpoint = "z" + c + data.checkpoint;
				}

				return this.bot.save(data);
			});
		},

		bot: require("./lib/apis/bot_api.js")(data)

	};
};
