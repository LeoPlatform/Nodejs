const leo = require("../index.js");
var moment = require("moment");

describe("local", function() {
  it("Sends events onto the bus via Firehose", function(done) {
    this.timeout(60000);
    var stream = leo.load("V2FirehoseTest", "V2FirehoseQueue", {
      firehose: true,
      debug: true
    });
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