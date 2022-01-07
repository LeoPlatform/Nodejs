process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));

import leo from "../../index"

const EVENTS = 10;

let sdk = leo(config.leosdk);

interface LeoPayload {
    working: string
    count: number
}

async function loadEvents() {

    let stream = sdk.load("bentest-types-loader", "bentest-types-loader-queue", { useS3: true });

    for (let i = 0; i < EVENTS; i++) {

        let payload: LeoPayload = {
            working: "working",
            count: i
        }

        if (!stream.write(payload)) {
            //drain stream if there's backpressure
            await new Promise((res) => {
                stream.once("drain", res)
            })
        }

    }

    stream.end();
}

loadEvents();