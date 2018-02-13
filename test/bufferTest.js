const ls = require("../").streams;
const async = require("async");

const PassThrough = require("stream").PassThrough;

describe("streams", function() {
	describe("buffer", function() {
		this.timeout(1000 * 60);
		it("should flush on timer", (done) => {
			let pass = new PassThrough({
				objectMode: true
			});
			ls.pipe(pass, ls.buffer({
				time: {
					seconds: 1
				},
				writeStream: true
			}, (obj, done) => {
				i++;
				done(null, obj)
			}, (done) => {
				console.log("I saw ", i, " events");
				i = 0;
				done();
			}), (err) => {
				console.log("There was an error: ", err);
				console.log("all done");
				done();
			});
			let i = 0;

			let x = 0;
			async.doWhilst((done) => {
				if (!pass.write({
						someobject: true
					})) {
					pass.once('drain', () => {
						setTimeout(done, 200);
					})
				} else {
					setTimeout(done, 200);
				}
			}, () => {
				return ++x < 23;
			}, (err) => {
				console.log(err);
				pass.emit("error", "this is an error");
				console.log("waiting 5 seconds");
				pass.end();
			}, 1000 * 5);
		});
	});
});