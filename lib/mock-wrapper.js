"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const aws_util_1 = __importDefault(require("./aws-util"));
//import uuid from "uuid";
const reference_1 = __importDefault(require("./reference"));
const parserUtil = __importStar(require("./stream/helper/parser-util"));
const requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
function default_1(leoStream) {
    if (process.env.RSTREAMS_MOCK_DATA == null || leoStream.mocked) {
        return;
    }
    let registry = process;
    registry.rstreamsMock = registry.rstreamsMock || { queues: new Set() };
    leoStream.mocked = true;
    let settings = {
        queueDirectory: path_1.default.resolve(process.env.RSTREAMS_MOCK_DATA, "queue"),
        s3Directory: path_1.default.resolve(process.env.RSTREAMS_MOCK_DATA, "s3"),
        batchId: "output-data" //uuid.v4()
    };
    let fromLeo = leoStream.fromLeo.bind(leoStream);
    leoStream.fromLeo = (id, queue, config) => {
        queue = reference_1.default.ref(queue).id;
        // Look for events that were written to this queue in this process
        let runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] || "";
        // Allow for a queue to to the actual data
        if (runtimeQueue === "passthrough") {
            return fromLeo(id, queue, config);
        }
        let queueDataFileJsonl = path_1.default.resolve(settings.queueDirectory, runtimeQueue, `${queue}.jsonl`);
        let queueDataFileJson = path_1.default.resolve(settings.queueDirectory, runtimeQueue, `${queue}.json`);
        let mockStream;
        let JSONparse = parserUtil.createParser({
            parser: config === null || config === void 0 ? void 0 : config.parser,
            opts: {
                ...config === null || config === void 0 ? void 0 : config.parserOpts
            }
        });
        if (fs_1.default.existsSync(queueDataFileJsonl)) {
            mockStream = leoStream.pipeline(fs_1.default.createReadStream(queueDataFileJsonl), leoStream.split((value) => JSONparse(value)));
        }
        else if (fs_1.default.existsSync(queueDataFileJson)) {
            mockStream = leoStream.pipeline(
            // They may be using a custom parser so we need to convert the json to a string and use the parser
            leoStream.eventstream.readArray(requireFn(queueDataFileJson).map(l => JSON.stringify(l))), leoStream.split((value) => JSONparse(value)));
        }
        else {
            mockStream = leoStream.eventstream.readArray([]);
        }
        mockStream.checkpoint = (callback) => callback();
        return mockStream;
    };
    let oldLoad = leoStream.load.bind(leoStream);
    leoStream.load = (id, queue, opts) => {
        if (opts && opts.useS3) {
            delete opts.useS3;
        }
        return oldLoad(id, queue, opts);
    };
    leoStream.toLeo = (botId, config) => {
        let records = 0;
        let timestamp = Date.now();
        let fileStreams = {};
        let mockStream = leoStream.through((writeData, callback) => {
            // No queue.  Just a command event so we can skip it
            if (!writeData || !writeData.event) {
                return callback();
            }
            let queue = reference_1.default.ref(writeData.event).id;
            // Mark queue to have in memory data from this batch
            process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] = settings.batchId;
            registry.rstreamsMock.queues.add(queue);
            // Add an eid 
            let data = writeData;
            data.eid = leoStream.eventIdFromTimestamp(timestamp, "full", records);
            records++;
            if (!fileStreams[queue]) {
                let queueDataFileJsonl = path_1.default.resolve(settings.queueDirectory, settings.batchId, `${queue}.jsonl`);
                createPath(path_1.default.dirname(queueDataFileJsonl));
                fileStreams[queue] = leoStream.pipeline(leoStream.stringify(), fs_1.default.createWriteStream(queueDataFileJsonl));
            }
            if (!fileStreams[queue].write(data)) {
                fileStreams[queue].once("drain", () => callback());
            }
            else {
                callback();
            }
        }, (done) => {
            let count = Object.keys(fileStreams).length;
            if (count === 0) {
                done();
                return;
            }
            let called = false;
            let cb = (err) => {
                count--;
                if (!called && (count === 0 || err)) {
                    called = true;
                    done(err);
                }
            };
            Object.values(fileStreams).forEach((s) => {
                s.end(cb);
            });
        });
        return mockStream;
    };
    let fromS3 = leoStream.fromS3.bind(leoStream);
    leoStream.fromS3 = (file) => {
        var _a;
        let runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${(_a = file.key.split("/")[1]) !== null && _a !== void 0 ? _a : ""}`] || "";
        // Allow for a queue to to the actual data
        if (runtimeQueue === "passthrough") {
            return fromS3(file);
        }
        let Bucket = path_1.default.resolve(settings.s3Directory, file.bucket);
        let Key = file.key;
        // let Range = file.range || undefined;
        let filepath = path_1.default.resolve(Bucket, Key);
        if (!fs_1.default.existsSync(filepath)) {
            throw aws_util_1.default.error(new Error(), {
                message: 'The specified key does not exist.',
                code: 'NoSuchKey'
            });
        }
        return fs_1.default.createReadStream(filepath);
    };
    leoStream.toS3 = (Bucket, File) => {
        let filepath = path_1.default.resolve(settings.s3Directory, `${Bucket}/${File}`);
        createPath(path_1.default.dirname(filepath));
        return fs_1.default.createWriteStream(filepath);
    };
    leoStream.cron.checkLock = (cron, runid, remainingTime, callback) => callback(null);
    leoStream.cron.reportComplete = (cron, runid, status, log, opts, callback) => callback(null);
    leoStream.cron.createLock = (id, runid, maxDuration, callback) => callback(null);
    leoStream.cron.removeLock = (id, runid, callback) => callback(null);
    leoStream.toCheckpoint = () => leoStream.devnull();
}
exports.default = default_1;
function createPath(dir) {
    if (!fs_1.default.existsSync(dir)) {
        let parent = path_1.default.dirname(dir);
        if (parent) {
            createPath(parent);
        }
        fs_1.default.mkdirSync(dir);
    }
}
//# sourceMappingURL=mock-wrapper.js.map