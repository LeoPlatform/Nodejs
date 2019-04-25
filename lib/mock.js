let leosdk = require("../index");
let es = require("event-stream");
const { gunzipSync } = require("zlib");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");

const overrideLeoFunctions = (data = {}, leo=leosdk) => {
	leo.mocked = true;
	if (Array.isArray(data)) {
		data = {
			queues: data
		};
	}
	data = Object.assign({
		toS3:true,
		write:true,
		read:true,
		cron:true,
		queues: {},
		checkpoints: {}
	}, data);
	readQueueObjectArray = data.queues;
	leo.configuration.validate = () => true;

	//define various overrides of Leo functions
	if (data.read){
		leo.read = leo.streams.fromLeo = (id, queue) => {
			if (Array.isArray(readQueueObjectArray)) {
				return es.readArray(readQueueObjectArray)
			} else if (isReadableStream(readQueueObjectArray)){
				return readQueueObjectArray;
			} else if (isReadableStream(readQueueObjectArray[queue])){
				return 	readQueueObjectArray[queue];
			} else {
				return es.readArray(readQueueObjectArray[queue] || []);
			}
		};
	}

	if (data.write){
		leo.write = leo.streams.toLeo = () => {
			leo.write.events = [];
			return leo.streams.through((data, callback) => {
				leo.write.events.push(data);
				callback();
			});
		};
	}

	if (data.toS3){
		leo.streams.toS3 = (Bucket, File) => {
			let filepath = path.resolve("/tmp/", `${Bucket}/${File}`);
			createPath(path.dirname(filepath));
			return leo.streams.pipeline(
				leo.streams.through((o, done) => {
					done(null, o);
				}),
				leo.streams.through((o, done) => {
					leo.streams.toS3.events.push(o);
					done(o);
				}),
				fs.createWriteStream(filepath)
			);
		}
		leo.streams.toS3.events = [];
	}

	if (data.cron){
		leo.bot.checkLock = (...args) => args[args.length - 1]();
		leo.bot.reportComplete = (...args) => args[args.length - 1]();
		leo.bot.createLock = (...args) => args[args.length - 1]();
		leo.bot.removeLock = (...args) => args[args.length - 1]();
	}
	leo.bot.getCheckpoint = (queue) => data.checkpoints[queue];
	leo.streams.toCheckpoint = () => leo.streams.devnull();
	return leo;
};

module.exports = overrideLeoFunctions;

function isReadableStream(test) {
	return test instanceof EventEmitter && typeof test.read === 'function'
}

function isWritableStream(test) {
	return test instanceof EventEmitter && typeof test.write === 'function' && typeof test.end === 'function'
}

function createPath (dir) {
	if (!fs.existsSync(dir)) {
		var parent = path.dirname(dir);
		if (parent) {
			createPath(parent);
		}
		fs.mkdirSync(dir);
	}
}
