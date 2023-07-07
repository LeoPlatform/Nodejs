"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trace = void 0;
const async_1 = __importDefault(require("async"));
const moment_1 = __importDefault(require("moment"));
const reference_1 = __importDefault(require("./reference"));
const logger = require('leo-logger')('event-trace');
async function trace(sdk, statsTableName, options) {
    let ls = sdk.streams;
    let dynamodb = sdk.aws.dynamodb;
    let queue = reference_1.default.ref(options.queue).toString();
    let id = options.eid;
    if (options.children) {
        let children = options.children; //.split(/,/);
        let results = {};
        logger.debug("With children", queue, prevId(id));
        return await new Promise((resolve, reject) => {
            ls.pipe(ls.fromLeo("test", queue, {
                start: prevId(id),
                limit: 1,
            }), ls.write(function (readEvent, done) {
                let event = readEvent;
                let correlation = {
                    start: event.eid || event.kinesis_number,
                    timestamp: (0, moment_1.default)(event.timestamp),
                    source: reference_1.default.ref(event.event).id
                };
                async_1.default.doWhilst((done) => {
                    let [bot_id, queue_id] = children.splice(0, 2).map((n, i) => reference_1.default.ref(n, i == 0 && "bot"));
                    searchCorrelationId(sdk, statsTableName, queue_id, bot_id, correlation, (err, event) => {
                        if (err) {
                            logger.log("Error Searching for Correlation Id", err);
                            return done(err);
                        }
                        if (event) {
                            results[bot_id.toString()] = {
                                checkpoint: event.eid || event.kinesis_number,
                                lag: event.timestamp - event.event_source_timestamp,
                            };
                            results[queue_id.toString()] = {
                                payload: event.payload,
                                lag: event.timestamp - event.event_source_timestamp,
                                checkpoint: event.eid || event.kinesis_number
                            };
                            correlation = {
                                start: event.eid || event.kinesis_number,
                                timestamp: (0, moment_1.default)(event.timestamp),
                                source: reference_1.default.ref(event.event).id
                            };
                        }
                        else {
                            results[bot_id.toString()] = results[bot_id.toString()] || {};
                            results[queue_id.toString()] = results[queue_id.toString()] || {};
                        }
                        done();
                    });
                }, () => {
                    return children.length > 0;
                }, (err) => {
                    done(err);
                });
            }), function (err) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(results);
                }
            });
        });
    }
    else {
        let bots = {};
        let queues = {};
        let botLookup = {};
        return new Promise((resolve, reject) => {
            dynamodb.query({
                TableName: sdk.configuration.resources.LeoCron,
                "ReturnConsumedCapacity": 'TOTAL'
            }, {
                method: "scan",
                mb: 10
            }).then((data) => {
                let crons = data.Items;
                crons.forEach((cron) => {
                    var _a, _b;
                    let botId = reference_1.default.refId(cron.id, "bot");
                    if (cron.checkpoints) {
                        botLookup[botId] = reference_1.default.fixBotReferences(cron, {
                            checkpoints: true
                        });
                        Object.keys(((_a = cron === null || cron === void 0 ? void 0 : cron.checkpoints) === null || _a === void 0 ? void 0 : _a.read) || {}).forEach((key) => {
                            let queue = reference_1.default.refId(key);
                            if (!(queue in queues)) {
                                queues[queue] = {
                                    parents: [],
                                    children: []
                                };
                            }
                            queues[queue].children.push(botId);
                            if (!(botId in bots)) {
                                bots[botId] = {
                                    parents: [],
                                    children: []
                                };
                            }
                            bots[botId].parents.push(queue);
                        });
                        Object.keys(((_b = cron === null || cron === void 0 ? void 0 : cron.checkpoints) === null || _b === void 0 ? void 0 : _b.write) || {}).forEach((key) => {
                            let queue = reference_1.default.refId(key);
                            if (!(queue in queues)) {
                                queues[queue] = {
                                    parents: [],
                                    children: []
                                };
                            }
                            queues[queue].parents.push(botId);
                            if (!(botId in bots)) {
                                bots[botId] = {
                                    parents: [],
                                    children: []
                                };
                            }
                            bots[botId].children.push(queue);
                        });
                    }
                });
                let parents = [];
                let current = {
                    queue: queue,
                    id: id
                };
                let seen = {};
                let targetEvent = null;
                async_1.default.doWhilst((done) => {
                    logger.debug("doWhilst", current.queue, current.id, prevId(current.id));
                    let gotEvent = false;
                    ls.pipe(ls.fromLeo("test", current.queue, {
                        start: prevId(current.id),
                        limit: 1,
                    }), ls.write(function (readEvent, done) {
                        var _a;
                        let event = readEvent;
                        gotEvent = true;
                        let botId = reference_1.default.refId(event.id, "bot");
                        if (seen[botId]) {
                            current = null;
                            done();
                            return;
                        }
                        seen[botId] = 1;
                        if (!targetEvent) {
                            targetEvent = event;
                        }
                        let b = {
                            id: botId,
                            server_id: botId,
                            type: "bot",
                            label: (_a = (botLookup[botId] || {}).name) !== null && _a !== void 0 ? _a : botId
                        };
                        let eRef = reference_1.default.ref(event.event);
                        event.id = eRef.refId(); //util.botRefId(event.id);
                        event.event = eRef.refId();
                        event.server_id = event.id;
                        event.type = "queue";
                        event.label = eRef.id;
                        event.lag = (0, moment_1.default)(event.timestamp).diff(event.event_source_timestamp);
                        event.kinesis_number = event.eid || event.kinesis_number;
                        parents.unshift(event);
                        parents.unshift(b);
                        if (event.correlation_id && event.correlation_id.start != undefined) {
                            current = {
                                id: event.correlation_id.start,
                                queue: reference_1.default.ref(event.correlation_id.source).toString()
                            };
                        }
                        else {
                            current = null;
                        }
                        done();
                    }), function (err) {
                        if (!gotEvent) {
                            current = null;
                        }
                        done(err);
                    });
                }, () => {
                    return current !== null;
                }, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    let seen = {};
                    function children(queue, id, force = false) {
                        if (seen[queue]) {
                            return {};
                        }
                        seen[queue] = 1;
                        let kids = {};
                        queues[queue].children.forEach((bot) => {
                            var _a;
                            let checkpoint = ((botLookup[bot] || {}).checkpoints && botLookup[bot].checkpoints.read[queue]) || {};
                            let lag = checkpoint.source_timestamp ? (0, moment_1.default)(checkpoint.source_timestamp).diff(targetEvent.event_source_timestamp) : null;
                            let has_processed = checkpoint.checkpoint > id || false;
                            kids[bot] = {
                                id: bot,
                                server_id: bot,
                                type: 'bot',
                                label: (_a = (botLookup[bot] || {}).name) !== null && _a !== void 0 ? _a : bot,
                                has_processed: has_processed,
                                lag: !has_processed ? lag : 0,
                                checkpoint: checkpoint,
                                children: {}
                            };
                            if (force || has_processed) {
                                bots[bot].children.map((q_id) => {
                                    kids[bot].children[q_id] = {
                                        id: q_id,
                                        label: q_id,
                                        server_id: q_id,
                                        lag: null,
                                        type: 'queue',
                                        event: null,
                                        children: children(q_id, id, force || has_processed)
                                    };
                                });
                            }
                        });
                        return kids;
                    }
                    resolve({
                        parents: parents.slice(0, -1),
                        event: targetEvent,
                        children: children(queue, id)
                    });
                });
            }).catch(reject);
        });
    }
}
exports.trace = trace;
function prevId(id) {
    return id.slice(0, -1) + (id.slice(-1) == "0" ? ' ' : id.slice(-1) - 1);
}
function searchCorrelationId(sdk, statsTableName, queue_id, bot_id, correlation, callback) {
    let dynamodb = sdk.aws.dynamodb;
    let ls = sdk.streams;
    logger.debug("Search Correlation Id:", bot_id.refId());
    dynamodb.docClient.query({
        TableName: statsTableName,
        KeyConditionExpression: "#id = :id and #bucket >= :bucket",
        ExpressionAttributeNames: {
            "#bucket": "bucket",
            "#id": "id"
        },
        Limit: 14 * 24,
        ExpressionAttributeValues: {
            ":bucket": statsBuckets.data.hour.transform(correlation.timestamp.clone()),
            ":id": bot_id.refId()
        },
        "ReturnConsumedCapacity": 'TOTAL'
    }, (err, result) => {
        if (err) {
            callback(err);
            return;
        }
        let found = null;
        let source = reference_1.default.ref(correlation.source).queue().refId();
        for (let i = 0; i < result.Items.length; i++) {
            let stat = result.Items[i];
            logger.debug(stat.bucket, stat.current.read[source] && stat.current.read[source].checkpoint, correlation.start);
            if (stat.current.read[source] && stat.current.read[source].checkpoint >= correlation.start) {
                found = stat;
                break;
            }
        }
        if (!found) {
            return callback();
        }
        let timestamp = (0, moment_1.default)(found.time);
        dynamodb.docClient.query({
            TableName: statsTableName,
            KeyConditionExpression: "#id = :id and #bucket >= :bucket",
            ExpressionAttributeNames: {
                "#bucket": "bucket",
                "#id": "id"
            },
            Limit: 60,
            ExpressionAttributeValues: {
                ":bucket": statsBuckets.data.minute_1.transform(timestamp),
                ":id": bot_id.refId()
            },
            "ReturnConsumedCapacity": 'TOTAL'
        }, (err, result) => {
            if (err) {
                return callback(err);
            }
            let found = null;
            for (let i = 0; i < result.Items.length; i++) {
                let stat = result.Items[i];
                logger.debug(stat.bucket, stat.current.read[source] && stat.current.read[source].checkpoint, correlation.start);
                if (stat.current.read[source] && stat.current.read[source].checkpoint >= correlation.start) {
                    found = stat;
                    break;
                }
            }
            if (!found) {
                //return callback();
            }
            let timestamp = (0, moment_1.default)(found.time);
            if (correlation.timestamp > timestamp) {
                timestamp = correlation.timestamp;
            }
            found = null;
            let start = timestamp.format("[z/]YYYY/MM/DD/HH/mm/ss");
            let shouldContinue = true;
            logger.debug("Searching Events", queue_id.refId(), start);
            ls.pipe(ls.fromLeo("test", queue_id, {
                start: start,
                maxOverride: timestamp.clone().add(1, "m").format("[z/]YYYY/MM/DD/HH/mm/ss"),
                fast_s3_read: true
            }), ls.write(function (readEvent, done) {
                let e = readEvent;
                if (!shouldContinue) {
                    logger.debug("Should stop");
                    return done();
                }
                e.kinesis_number = e.eid || e.kinesis_number;
                if ((e.correlation_id.end && correlation.start <= e.correlation_id.end && correlation.start >= e.correlation_id.start) ||
                    e.correlation_id.start == correlation.start) {
                    found = e;
                    shouldContinue = false;
                    done();
                }
                else {
                    done();
                }
            }), (err) => {
                callback(err, found);
            });
        });
    });
}
const bucketsData = {
    "minute_1": {
        period: "minute",
        prefix: "minute_",
        transform: function (timestamp) {
            return "minute_" + timestamp.clone().utc().startOf("minute").format("YYYY-MM-DD HH:mm");
        },
        value: function (timestamp) {
            return timestamp.clone().utc().startOf("minute");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract((amount || 1), "minutes");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add((amount || 1), "minutes");
        },
        parent: "minute_5",
        duration: {
            m: 1
        },
        defaultContainer: "minute",
        defaultContainerInterval: 6 * 5
    },
    "minute_5": {
        period: "minute_5",
        prefix: "minute_5_",
        transform: function (timestamp) {
            let offset = (timestamp.utc().minute() + 5) % 5;
            return "minute_5_" + timestamp.clone().utc().subtract(offset, "minutes").startOf("minute").format("YYYY-MM-DD HH:mm");
        },
        value: function (timestamp) {
            let offset = (timestamp.utc().minute() + 5) % 5;
            return timestamp.clone().utc().subtract(offset, "minutes").startOf("minute");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract(5 * (amount || 1), "minutes");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add(5 * (amount || 1), "minutes");
        },
        parent: "minute_15",
        duration: {
            m: 5
        },
        defaultContainer: "minute",
        defaultContainerInterval: 6 * 15
    },
    "minute_15": {
        period: "minute_15",
        prefix: "minute_15_",
        transform: function (timestamp) {
            let offset = (timestamp.utc().minute() + 15) % 15;
            return "minute_15_" + timestamp.clone().utc().subtract(offset, "minutes").startOf("minute").format("YYYY-MM-DD HH:mm");
        },
        value: function (timestamp) {
            let offset = (timestamp.utc().minute() + 15) % 15;
            return timestamp.clone().utc().subtract(offset, "minutes").startOf("minute");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract(15 * (amount || 1), "minutes");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add(15 * (amount || 1), "minutes");
        },
        parent: "hour",
        duration: {
            m: 15
        },
        defaultContainer: "hour",
        defaultContainerInterval: 6
    },
    "hour": {
        period: "hour",
        prefix: "hour_",
        transform: function (timestamp) {
            return "hour_" + timestamp.clone().utc().startOf("hour").format("YYYY-MM-DD HH");
        },
        value: function (timestamp) {
            return timestamp.clone().utc().startOf("hour");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract((amount || 1), "hour");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add((amount || 1), "hour");
        },
        parent: "day",
        duration: {
            h: 1
        },
        defaultContainer: "hour",
        defaultContainerInterval: 30
    },
    "day": {
        period: "day",
        prefix: "day_",
        transform: function (timestamp) {
            return "day_" + timestamp.clone().utc().startOf("day").format("YYYY-MM-DD");
        },
        value: function (timestamp) {
            return timestamp.clone().utc().startOf("day");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract((amount || 1), "day");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add((amount || 1), "day");
        },
        parent: "week",
        duration: {
            d: 1
        },
        defaultContainer: "day",
        defaultContainerInterval: 30
    },
    "week": {
        period: "week",
        prefix: "week_",
        transform: function (timestamp) {
            return "week_" + timestamp.clone().utc().startOf("week").format("YYYY-MM-DD");
        },
        value: function (timestamp) {
            return timestamp.clone().utc().startOf("week");
        },
        prev: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().subtract((amount || 1), "week");
        },
        next: function (timestamp, amount) {
            return (0, moment_1.default)(timestamp).utc().add((amount || 1), "week");
        },
        parent: null,
        duration: {
            w: 1
        },
        defaultContainer: "week",
        defaultContainerInterval: 30
    }
};
const ranges = {
    "minute": {
        period: "minute_1",
        count: 1,
        startOf: (timestamp) => timestamp.clone().startOf("minute")
    },
    "minute_1": {
        period: "minute_1",
        count: 1,
        startOf: (timestamp) => timestamp.clone().startOf("minute")
    },
    "minute_5": {
        period: "minute_1",
        count: 5,
        startOf: (timestamp) => {
            let offset = (timestamp.utc().minute() + 5) % 5;
            return timestamp.clone().subtract(offset, "minutes").startOf("minute");
        }
    },
    "minute_15": {
        period: "minute_1",
        count: 15,
        startOf: (timestamp) => {
            let offset = (timestamp.minute() + 15) % 15;
            return timestamp.clone().subtract(offset, "minutes").startOf("minute");
        }
    },
    "hour": {
        period: "hour",
        count: 1,
        startOf: (timestamp) => timestamp.clone().startOf("hour"),
        rolling: {
            period: "minute_15",
            count: 4
        }
    },
    "hour_6": {
        period: "hour",
        count: 6,
        startOf: (timestamp) => timestamp.clone().startOf("hour"),
    },
    "day": {
        period: "hour",
        count: 24,
        startOf: (timestamp) => timestamp.clone().startOf("day")
    },
    "week": {
        period: "hour",
        count: 168,
        startOf: (timestamp) => timestamp.clone().startOf("week")
    }
};
const statsBuckets = {
    data: bucketsData,
    ranges: ranges
};
//# sourceMappingURL=event-trace.js.map