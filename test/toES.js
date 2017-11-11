"use strict";

var configure = {
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-FirehoseStream-189A8WXE76MFS",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
};
var leo = require("../index.js")(configure);
var ls = leo.streams;
var moment = require("moment");
var connectors = require("../connectors")(configure);

var id = "mongo2esTest";
var queue = "MongoOpLoadTest";
var systemId = "system:V2_Elasticsearch_System"
console.log(connectors.elasticsearch)
ls.pipe(
	leo.read(id, queue),
	ls.process(id, (payload, event, done) => {
		if (payload.op == "delete") {
			return done(null, {
				id: payload._id,
				index: "entities",
				type: "junk",
				delete: true
			});
		}

		done(null, {
			id: payload._id,
			index: "entities",
			type: "junk",
			doc: {
				id: payload._id,
				mid: payload.obj.mid,
				msg: payload.obj.Cool && payload.obj.Cool.toString(),
				lastUpdated: moment(event.timestamp).format()
			}
		})
	}, "esTestOutQueue"),
	connectors.elasticsearch.write({
		host: "search-sample-emzwhx5hewqhar53bzi2n25n2i.us-west-2.es.amazonaws.com",
		system: systemId
	}),
	leo.write(id),
	ls.toCheckpoint()
	//ls.devnull()
);