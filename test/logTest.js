var leo = require("../index.js")("LoggingTest", {
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2",
	logging: true
});
var moment = require("moment");


// Test can't be run via mocha because it uses the before 'beforeExit' event which isn't emitted with mocha

// describe("logs", function () {
//   it("uploads to aws", function (done) {
//     this.timeout(60000);


// console.log("STUFF");
// console.log("Doing Work");
// setTimeout(function () {
//   throw new Error("Something bad happened");
// }, 5000);


//     done();
//   });
// });