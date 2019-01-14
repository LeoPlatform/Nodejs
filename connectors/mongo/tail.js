"use strict";
var mongodb = require("mongodb");
var ObjectId = mongodb.ObjectID;
var Timestamp = mongodb.Timestamp;

var moment = require("moment");
var ls = require("../../lib/streams");
var PassThrough = require('stream').PassThrough;
var refUtil = require("../../lib/reference.js");

var extend = require("extend");

var compiler = require("../../lib/compile");
var opNames = {
	d: "delete",
	u: "update",
	i: "insert",
	c: "command"
};

module.exports = {
	streams: ls,
	stream: function(settings) {
		settings = extend(true, {}, settings);
		settings.server = settings.server || "localhost"
		var pass = new PassThrough({
			objectMode: true
		});

		let delayedTimeout = null;
		let sendTimeout = null;

		let attempts = 0;

		function reconnect(delay) {
			clearTimeout(delayedTimeout);
			clearTimeout(sendTimeout);
			if (!destroyCalled) {
				attempts++;
				delay = (delay === null || delay === undefined) ? 2000 : delay
				delayedTimeout = setTimeout(connect, delay);
			}
		}

		function compile() {
			let code = settings.code || settings.mapper || settings.mappings || "return $;";
			//console.log(code)
			settings.__code = compiler.compile(code, (exports, module) => {
				exports.filter = compiler.callbackify(exports.filter, 1);
			});
		}

		function connect() {
			clearTimeout(delayedTimeout);
			clearTimeout(sendTimeout);
			Promise.all([
				mongodb.MongoClient.connect(`mongodb://${settings.server}/local?readPreference=secondary&slaveOk=true'`),
				mongodb.MongoClient.connect(`mongodb://${settings.server}/${settings.db}?readPreference=secondary&slaveOk=true'`)
			]).then(dbs => {
				attempts = 0;
				pass.dbs = dbs;
				let localdb = dbs[0];
				let db = pass.database = dbs[1];
				let collection = pass.collection = db.collection(settings.collection);

				let checkpoint = getCheckpoint(settings);
				let cp = (checkpoint === null || checkpoint === undefined) ? new Timestamp(0, moment().unix()) : Timestamp.fromString(checkpoint.toString());
				let query = {
					ns: collection.namespace,
					ts: {
						$gt: cp
					}
				};
				console.log(JSON.stringify(query, null, 2));
				let oplogstream = localdb.collection("oplog.rs").find(query, {
					tailable: true,
					awaitData: true,
					oplogReplay: true,
					noCursorTimeout: true,
					numberOfRetries: Number.MAX_VALUE
				}).stream();
				pass.oplogstream = oplogstream;

				oplogstream.on("data", (data) => {
					let result = pass.write(data);
					if (!result) {
						oplogstream.pause();
						pass.once("drain", () => {
							oplogstream.resume();
						});
					}

					return result;
				})
				oplogstream.on("error", err => {
					console.log("Error:", err);
					!destroyCalled && reconnect();
				});
				oplogstream.on("close", () => {
					console.log("Closed Stream");
					!destroyCalled && reconnect();
				});
				oplogstream.on("exit", err => {
					console.log("Exited:", err);
					!destroyCalled && reconnect();
				});
			}).catch(err => {
				console.log("Error:", err)
				reconnect();
			});
		}

		compile();
		connect();

		let stream = ls.pipe(pass,
			ls.through((data, done) => {
				if (!settings.__code.filter) {
					done(null, data);
				} else {
					settings.__code.filter.call(data, data, (err, passes) => done(err, passes ? data : undefined));
				}
			}), ls.batch({
				count: settings.maxSendCount || 300,
				time: settings.maxSendDelay || 500
			}), ls.through(function(group, done) {

				let self = this;
				let idField = settings.id_column || "_id";
				var getObjects = function(data) {
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
						return (c.o._id || c.o2._id);
					});

					var deletes = Object.keys(history).map(id => history[id]).filter(o => o.op == "d") || [];

					var projection = (settings.code && settings.code.projection || []).reduce((out, f) => {
						out[f] = 1;
						return out;
					}, {});
					return ls.pipe(pass.collection.find({
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

				getObjects(group.payload).pipe(ls.through(function(data, done) {
					let wrapper = {
						correlation_id: {
							source: settings.source,
							start: data.ts.toString()
						},
						event_source_timestamp: ts2ms(data.ts),
						timestamp: Date.now()
					}
					settings.__code.handler.call({
						collection: pass.collection,
						database: pass.database,
						settings: settings
					}, data, (err, response) => {
						if (err) {
							done(err);
						} else {
							if (Array.isArray(response)) {
								response.map(r => self.push(Object.assign({}, wrapper, {
									payload: r
								})));
							} else {
								self.push(Object.assign({}, wrapper, {
									payload: response
								}));
							}
							done();
						}
					});
				}, (cb) => {
					settings.checkpoint = group.payload[group.payload.length - 1].ts;
					done();
					cb();
				}));
			}));

		let oldDestroy = stream.destroy;
		let destroyCalled = false;
		stream.destroy = function() {
			destroyCalled = true;
			clearTimeout(delayedTimeout);
			clearTimeout(sendTimeout);
			pass.oplogstream && pass.oplogstream.close();
			pass.dbs && pass.dbs.map(db => db.close());
			pass.oplogstream = undefined;
			pass.dbs = undefined;
			pass.database = undefined;
			if (settings.__code.destroy) {
				settings.__code.destroy();
			}
			oldDestroy && oldDestroy.call(stream);
		};
		stream.update = function(newSettings) {
			if (newSettings) {
				//let checkpoint = getCheckpoint(settings);
				//let newCheckpoint = getCheckpoint(newSettings);
				let restart = settings.server != newSettings.server ||
					settings.db != newSettings.db ||
					settings.collection != newSettings.collection;
				let recompile = settings.code != newSettings.code || settings.mapper != newSettings.mapper;

				extend(true, settings, newSettings);

				if (recompile) {
					console.log("Compiling Code")
					compile();
				}
				if (restart) {
					stream.destroy();
					reconnect();
				}
			}
		}
		return stream;
	}
};
var ts2ms = exports.ts2ms = function(_ts) {
	return _ts.high_ * 1000 + _ts.low_;
};

function getCheckpoint(settings) {
	let ref = refUtil.ref(settings.source);
	let read = settings.checkpoint || settings.__cron && settings.__cron.checkpoints && settings.__cron.checkpoints.read || {};
	return (read[ref] || read[ref.id] || {}).checkpoint;
}
