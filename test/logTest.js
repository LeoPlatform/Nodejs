var leo = require("../index.js")("LoggingTest", {
  s3: "leo-s3bus-1r0aubze8imm5",
  firehose: "Leo-BusToS3-3JQJ49ZBNP1P",
  kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
  region: "us-west-2",
  logging: true
});
var moment = require("moment");

describe("local", function() {
  it("Should be retrieve a nicely formatted workflow", function(done) {
    this.timeout(60000);

    console.log("STUFF");
    leo.destroy(() => {
      console.log("BADSTUFF");
      done();
    });

  });
});