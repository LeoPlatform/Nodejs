var leo = require("../index.js")({
	s3: "leo-s3bus-1r0aubze8imm5",
	firehose: "Leo-FirehoseStream-189A8WXE76MFS",
	kinesis: "Leo-KinesisStream-ATNV3XQO0YHV",
	region: "us-west-2"
});
var moment = require("moment");

describe("local", function () {
	it("Should be retrieve a nicely formatted workflow", function (done) {
		this.timeout(60000);
		var id = "ckz_manual_checkpoint";
		var cp = leo.streams.toManualCheckpoint(id, {
			debug: true
		});
		leo.streams.pipe(
			leo.read("ckz_manual_checkpoint", "queue:CZ_Starwars_out"),
			cp,
			(err) => {
				console.log("All Done processing events", err);
				cp.finish((err) => {
					console.log("Finished Checkpointing", err || undefined);
					done();
				});
			}
		);
	});
});