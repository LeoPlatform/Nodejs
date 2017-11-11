'use strict'
var async = require("async");
var moment = require("moment");
var mongodb = require("mongodb");
var refUtil = require("../../lib/reference.js");
var compiler = require("../../lib/compile");
var leo = require("../../index");
var ls = leo.streams;
var dynamodb = require("../../lib/dynamodb")(leo.configuration);
var Timestamp = mongodb.Timestamp;
var ObjectId = mongodb.ObjectID;

var opNames = {
	d: "delete",
	u: "update",
	i: "insert",
	c: "command"
};

dynamodb.scan = function (table, filter, callback) {
	dynamodb.docClient.scan({
		TableName: table,
		"ReturnConsumedCapacity": 'TOTAL'
	}, function (err, data) {
		if (err) {
			console.log(err);
			callback(err);
		} else {
			callback(null, data.Items);
		}
	});
};

function compile(settings) {
	let code = settings.code || settings.mapper || settings.mappings || "return $;";
	settings.__code = compiler.compile(code, (exports, module) => {
		exports.filter = compiler.callbackify(exports.filter, 1);
	});
}

function findNewBots(callback) {
	//clearTimeout(timeout);
	var id = process.argv[2]; // filter id for cron entries.
	console.log("Looking for Managed Bots", id);

	var botregex = process.argv[3] && new RegExp(`^${process.argv[3]}`, "i");
	dynamodb.scan("Leo_cron", {}, (err, items) => {
		var bots = {};
		var tasks = items.filter(c => {
			return (!botregex || c.id.match(botregex)) && c.system && refUtil.ref(c.system.id, "system").id == id && c.lambda && c.lambda.settings && c.lambda.settings[0] && c.lambda.settings[0].collection
		}).map(cron => {
			bots[cron.id] = cron;
			return cron;
		});

		async.each(tasks, (bot, done) => {
			var settings = getSettings(bot);
			var queue = (refUtil.ref(bot.lambda.settings[0].loadQueue) || refUtil.ref(bot.system.id)).queue();
			settings.source = queue;
			settings.destination = refUtil.ref(settings.destination).queue();

			compile(settings);
			console.log(`Bot: ${settings.botId}: ${settings.source} => ${settings.destination}`);

			connect(settings, (err, connection) => {
				if (err) {
					return done(err);
				}
				var objectId = (settings.id_column && settings.id_column != "_id") ? a => {
					return typeof a === "string" && a.match(/[0-9.]+/) ? parseFloat(a) : a;
				} : ObjectId;

				leo.enrich({
					id: settings.botId,
					inQueue: settings.source,
					outQueue: settings.destination,
					transform: function (obj, event, done) {
						let self = this;
						console.log("Transform:", obj);
						async.eachOfSeries(obj.files, (file, i, done) => {
							console.log("File:", file);
							ls.pipe(ls.fromS3(file), ls.split(), ls.through((obj, done) => {
								let chg = {
									op: file.action == "delete" ? "d" : "u",
									ts: new Timestamp(0, moment().unix()),
									o: {
										_id: objectId(obj),
									}
								};
								done(null, chg);
							}), ls.batch({
								count: settings.maxSendCount || 300,
								time: settings.maxSendDelay || 500
							}), ls.through(function (group, done) {
								let idField = settings.id_column || "_id";
								let toId = idField == "_id" ? ObjectId : a => a;
								var getObjects = function (data) {
									var history = {};
									let changes = data.filter(c => (c.o._id !== undefined || (c.o2 && c.o2._id !== undefined))).map(c => {
										var id = c.o._id || c.o2._id;
										if (!(id in history)) {
											history[id] = {
												id: id,
												op: c.op,
												ts: c.ts,
												changes: []
											};
										}
										history[id].op = c.op;
										history[id].ts = c.ts;

										history[id].changes.push({
											op: c.op,
											o: c.op == "u" ? c.o : undefined,
											ts: c.ts
										});
										return toId(c.o._id || c.o2._id);
									});

									var deletes = Object.keys(history).map(id => history[id]).filter(o => o.op == "d") || [];

									var projection = (settings.code && settings.code.projection || []).reduce((out, f) => {
										out[f] = 1;
										return out;
									}, {});
									settings.debug && console.log("Query:", idField, changes, projection)
									return ls.pipe(connection.collection.find({
										[idField]: {
											$in: changes
										}
									}, projection).stream(), ls.through((obj, done) => {
										var id = obj[idField];
										let d = history[id] || {};
										let op = d.op;
										var _id = obj._id;
										done(null, {
											op: opNames[op] || op,
											obj: obj,
											_id: _id,
											ts: d.ts,
											changes: d.changes
										});
									}, function flush(done) {
										deletes.length && console.log("Pushing deletes", deletes.length);
										deletes.forEach(d => {
											this.push({
												op: "delete",
												obj: d.id,
												_id: d.id,
												ts: d.ts,
												changes: d.changes
											});
										});
										done();
									}));
								};

								//console.log("group", group);
								getObjects(group.payload).pipe(ls.through(function (data, done) {
									let wrapper = {
										correlation_id: {
											source: settings.source.toString(),
											start: data.ts.toString()
										},
										event_source_timestamp: ts2ms(data.ts),
										timestamp: Date.now()
									}
									settings.__code.handler.call(connection, data, (err, response) => {
										if (err) {
											done(err);
										} else {
											if (Array.isArray(response)) {
												response.map(r => self.push(r));
											} else {
												self.push(response);
											}
											done();
										}
									});
								}, (cb) => {
									done();
									cb();
								}));
							}), /*ls.log(),*/ ls.devnull(), function (err) {
								console.log("File Done", err || "");
								done(err);
							});
						}, (err, result) => {
							err && console.log("Error on file async", err)
							done(err);
						});
					},
					debug: !!settings.debug
				}, function (err) {
					err && console.log("Error:", err);
					console.log("Completed:", settings.botId);
					callback(err);
				});

			});

		}, (err, results) => {
			console.log("All done", err, results)
			if (callback) {
				callback();
			}
		});
	});
	return this;
}

function getSettings(cron) {
	return Object.assign({}, cron.lambda.settings[0], {
		botId: cron.id,
		"__cron": {
			"id": cron.id,
			"iid": 0,
			"name": null,
			"ts": 0,
			"checkpoints": cron.checkpoints,
			"botName": cron.name,
			"instances": cron.instances,
			"ignoreLock": true
		}
	});
}

function connect(cronSettings, callback) {
	mongodb.MongoClient.connect(`mongodb://${cronSettings.server}/${cronSettings.db}?readPreference=secondary&slaveOk=true'`, function (err, db) {
		if (err) {
			return callback(err);
		}
		db.collection(cronSettings.collection, function (err, collection) {
			if (err) {
				return callback(err);
			}
			console.log("We are connected", collection.namespace);
			callback(null, {
				collection: collection,
				database: db
			});
		})
	});
}

var ts2ms = exports.ts2ms = function (_ts) {
	return _ts.high_ * 1000 + _ts.low_;
};

findNewBots((err) => {
	// Force the job to end
	if (err) {
		console.log("Error", err)
	}
	process.exit();
});