var leo = require("../index.js");
var moment = require("moment");

describe("local", function() {
  it("Should be retrieve a nicely formatted workflow", function(done) {
    this.timeout(60000);
    var stream = leo.load("TestBot", "gti.test", {
      debug: true,
      records: 3000,
      time: {
        milliseconds: 100
      },
      chunk: {
        debug: true,
        records: 20,
        time: {
          milliseconds: 500
        }
      }
    });
    var cnt = 10;
    for (let i = 0; i < cnt; i++) {
      stream.write({
        now: moment().format(),
        index: i,
        number: Math.round(Math.random() * 10000)
      });
    }
    setTimeout(function() {

      stream.write({
        now: moment().format(),
        index: cnt,
        number: Math.round(Math.random() * 10000)
      });

      stream.end(err => {
        console.log("done writting events");
        done();
      });
    }, 700);

  });
});