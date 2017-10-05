var leo = require("../index.js")({
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
});
var moment = require("moment");
var refUtil = require("../lib/reference");



//leo.streams.toLeo = (id, opts) => leo.streams.through((obj, done) => {
//	done(null, obj)
//});
//leo.streams.toCheckpoint = leo.streams.devnull;

//describe("local", function () {
//	it("Should be retrieve a nicely formatted workflow", function (done) {
//		this.timeout(60000);
var start = moment.now();
var stream = leo.load("AutoSwitch", "AutoSwitch.test", {
	debug: true
});
stream.on("error", console.log)
var count = 10;
for (let i = 0; i < count; i++) {
	stream.write({
		now: moment().format(),
		index: i,
		number: Math.round(Math.random() * 10000)
	});
}
console.log("Done with loop")
//stream.end(err => {
//	console.log("done writting events", count / (moment.now() - start));
//done();
//});
//	});
//});