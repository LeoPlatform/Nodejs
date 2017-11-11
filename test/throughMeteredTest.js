var stream = require("../lib/streams.js");

describe("local", function() {
  it("Should able to meter through and emit when meter hits", function(done) {
    this.timeout(20 * 1000);


    var buffer = [];
    var throughMetered = stream.pipeline(stream.throughMetered({
        time: {
          seconds: 1
        }
      },
      (obj, done) => {
        //Should fail if we are in the middle of a emit because buffer would be null
        buffer.push(obj);
        done(null, {
          records: 1,
          size: 100,
          obj: obj
        });
      },
      (done) => {
        buffer = null;
        //add artificial delay so that the next write happens in this time
        setTimeout(() => {
          buffer = [];
          done();
        }, 400);
      }
    ), stream.devnull());

    throughMetered.write({
      i: 1
    });
    setTimeout(() => {
      throughMetered.write({
        i: 2
      });
      setTimeout(() => {
        throughMetered.write({
          i: 3
        });
        throughMetered.end(done);
      }, 1 * 1000 + 40);
    }, 1 * 1000 + 40);
  });
});