var leo = require("../index.js")({
  s3: "leo-s3bus-1r0aubze8imm5",
  firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
  kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
  region: "us-west-2"
});
var moment = require("moment");

describe("local", function() {
  it("Should be retrieve a nicely formatted workflow", function(done) {
    this.timeout(60000);
    var stream = leo.load("TestBot", "gti.test");
    for (let i = 0; i < 10000; i++) {
      stream.write({
        now: moment().format(),
        index: i,
        number: Math.round(Math.random() * 10000)
      });
    }
    stream.end(err => {
      console.log("done writting events");
      done();
    });
  });
});