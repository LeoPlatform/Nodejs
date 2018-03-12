const leo = require("../index.js");

const ls = leo.streams;

describe("Streams", function() {
	it("Should support through commands", function(done) {
		console.log("HOWDY");
		let initialStream = ls.through((obj, done) => {
			console.log("INITIAL GOT ", obj);
			done(null, obj);
		});

		let secondStream = ls.through((obj, done) => {
			console.log("SECOND GOT ", obj);
			done(null, obj);
		});


		let writeStream = ls.writeWrapped({
			cmdFlush: (obj, done) => {
				console.log("GOT FLUSH COMMAND", obj);
				done(null);
			},
			cmd: (obj, done) => {
				console.log("GOT A DIFFERENT COMMAND", obj);
				done(null);
			}
		}, (obj, done) => {
			console.log("WRITE GOT ", obj);
			done(null, obj);
		});


		ls.pipe(initialStream, ls.log("initial"), secondStream, ls.log("second"), writeStream, (err) => {
			console.log("ALL DONE", err);
			done();
		});

		initialStream.write({
			HOWDY: 'steve'
		});
		initialStream.write({
			__cmd: 'flush'
		});
		initialStream.write({
			__cmd: 'random'
		});
		initialStream.end();
	});



	it.only("should cause chunk eventstream to flush early", function(done) {
		let initialStream = ls.through((obj, done) => {
			console.log("INITIAL GOT ", obj);
			done(null, obj);
		});

		ls.pipe(initialStream, ls.toLeo("testbot"), ls.log("before cmd"), ls.cmd({
			checkpoint: (obj, done) => {
				console.log("Got checkpoint", obj);
				done(null);
			}
		}), ls.devnull("afterCmd"), (err) => {
			done(err);
		});
		initialStream.write({
			id: 'testbot',
			event: 'test',
			payload: {
				Hi: 'steve',
			},
			correlation_id: {
				source: 'sommesource',
				start: 'howdy'
			}
		});
		initialStream.write({
			id: 'testbot',
			event: 'test',
			payload: {
				Hi: 'steve',
			},
			correlation_id: {
				source: 'sommesource',
				start: 'howdy2'
			}
		});
		initialStream.write({
			__cmd: 'flush'
		});
		setTimeout(() => {
			initialStream.end();
		}, 1000);
	});
});
