process.env.LEO_ENVIRONMENT = "test"
process.env.LEO_LOGGER = "/.*/ei" //TODO document
let config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));
import * as fs from 'fs';
import leo from "../../index";

const stream = leo(config.leosdk).streams

stream.pipe(
    fs.createReadStream("examples/local/lib/orders.jsonl"),
    stream.parse(),
    stream.load("ts-order-loader-test", "ts-new-order-queue-test")
)