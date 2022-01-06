process.env.LEO_ENVIRONMENT = "test"
let config = require('leo-config');
config.bootstrap(require("../config/leo_config"));

import leo from "../../index"

let sdk = leo(false);

interface LeoPayload {
    working: string
}

function enricher() {
    sdk.enrich({
        id: "bentest-ts-types-leo-enricher",
        inQueue: "bentest-2-ts-types-leo-queue",
        outQueue: "enriched-bentest-2-ts-types-leo-queue",
        transform: (payload, event) => {
            return transformer(payload, event);
        },
    }, (err) => { if (err) { console.log("Handle error") } })
}

function transformer(payload: LeoPayload, event: any): any {
    console.log(`Received Payloads\n\t${JSON.stringify(payload)}`);
    console.log(`Received Event\n\t${JSON.stringify(event)}`);
    payload.working = "Enriched"
    return payload;
}

enricher();