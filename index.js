let extend = require("extend");
let build = require('./lib/build-config.js').build;
var ls = require("./lib/stream/leo-stream");

module.exports = function (data) {
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

	if (data.region && !aws.region) {
		aws.region = data.region;
	}

	delete data.kinesis;
	delete data.s3;
	delete data.fireshose;
	delete data.region;

	var config = extend(true, build(process.cwd()), data);
	var leoStream = ls(config);
	return {
		load: leoStream.load,
		offload: leoStream.offload,
		enrich: leoStream.enrich,
		streams: leoStream
	};
};