process.env.LEO_ENVIRONMENT = "test"
let config = require('leo-config');
config.bootstrap(require("../config/leo_config"));

import leo from "../../index"

const EVENTS = 10;

let sdk = leo(false);

function loadEvents() {

    let stream = sdk.load("bentest-types-loader", "bentest-types-loader-queue", { useS3: true });

    for (let i = 0; i < EVENTS; i++) {
        stream.write({ "payload": { "SoemthingHere": true }, "count": i })
    }

    stream.end();
}

loadEvents();