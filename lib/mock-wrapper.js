"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const aws_util_1 = __importDefault(require("./aws-util"));
const reference_1 = __importDefault(require("./reference"));
const requireFn = module.require;
function createPath(dir) {
    if (!fs_1.default.existsSync(dir)) {
        const parent = path_1.default.dirname(dir);
        if (parent) {
            createPath(parent);
        }
        fs_1.default.mkdirSync(dir);
    }
}
function default_1(leoStream) {
    if (process.env.RSTREAMS_MOCK_DATA == null || leoStream.mocked) {
        return;
    }
    const registry = process;
    registry.rstreamsMock = registry.rstreamsMock || { queues: new Set() };
    leoStream.mocked = true;
    const settings = {
        queueDirectory: path_1.default.resolve(process.env.RSTREAMS_MOCK_DATA, "queue"),
        s3Directory: path_1.default.resolve(process.env.RSTREAMS_MOCK_DATA, "s3"),
        batchId: "output-data" // uuid.v4()
    };
    const fromLeo = leoStream.fromLeo.bind(leoStream);
    leoStream.fromLeo = (id, queue, config) => {
        queue = reference_1.default.ref(queue).id;
        // Look for events that were written to this queue in this process
        const runtimeQueue = process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] || "";
        // Allow for a queue to to the actual data
        if (runtimeQueue === "passthrough") {
            return fromLeo(id, queue, config);
        }
        const queueDataFileJsonl = path_1.default.resolve(settings.queueDirectory, runtimeQueue, `${queue}.jsonl`);
        const queueDataFileJson = path_1.default.resolve(settings.queueDirectory, runtimeQueue, `${queue}.json`);
        let mockStream = null;
        if (fs_1.default.existsSync(queueDataFileJsonl)) {
            mockStream = leoStream.pipeline(fs_1.default.createReadStream(queueDataFileJsonl), leoStream.parse());
        }
        else if (fs_1.default.existsSync(queueDataFileJson)) {
            mockStream = leoStream.eventstream.readArray(requireFn(queueDataFileJson));
        }
        else {
            mockStream = leoStream.eventstream.readArray([]);
        }
        mockStream.checkpoint = (callback) => callback();
        return mockStream;
    };
    leoStream.toLeo = () => {
        let records = 0;
        const timestamp = Date.now();
        const fileStreams = {};
        const mockStream = leoStream.through((writeData, callback) => {
            const queue = reference_1.default.ref(writeData.event).id;
            // Mark queue to have in memory data from this batch
            process.env[`RSTREAMS_MOCK_DATA_Q_${queue}`] = settings.batchId;
            registry.rstreamsMock.queues.add(queue);
            // Add an eid 
            const data = writeData;
            data.eid = leoStream.eventIdFromTimestamp(timestamp, "full", records);
            records++;
            if (!fileStreams[queue]) {
                const queueDataFileJsonl = path_1.default.resolve(settings.queueDirectory, settings.batchId, `${queue}.jsonl`);
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
            const cb = (err) => {
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
    leoStream.fromS3 = (file) => {
        const Bucket = path_1.default.resolve(settings.s3Directory, file.bucket);
        const Key = file.key;
        // let Range = file.range || undefined;
        const filepath = path_1.default.resolve(Bucket, Key);
        if (!fs_1.default.existsSync(filepath)) {
            throw aws_util_1.default.error(new Error(), {
                message: 'The specified key does not exist.',
                code: 'NoSuchKey'
            });
        }
        return fs_1.default.createReadStream(filepath);
    };
    leoStream.toS3 = (Bucket, File) => {
        const filepath = path_1.default.resolve(settings.s3Directory, `${Bucket}/${File}`);
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
//# sourceMappingURL=mock-wrapper.js.map