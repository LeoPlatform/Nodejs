process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('leo-config');
config.bootstrap(require("../config/leo_config"));

import leo from "../../index"

const EVENTS = 10;

let sdk = leo(false);

interface LeoPayload {
    working: string
    count: number
}

function loadEvents() {

    let stream = sdk.load("bentest-types-loader", "bentest-types-loader-queue", { useS3: true });

    for (let i = 0; i < EVENTS; i++) {

        let payload: LeoPayload = {
            working: "working",
            count: i
        }

        stream.write(payload)
    }

    stream.end();
}

loadEvents();