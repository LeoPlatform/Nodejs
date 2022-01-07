process.env.LEO_ENVIRONMENT = "test"
let config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));

import leo from "../../index"

let sdk = leo(config.leosdk);

function offloader() {
    sdk.offload({
        id: "test-ts-types-offloader-leo",
        inQueue: "bentest-types-loader-queue",
        each: (payload, event) => {
            return offloadHandler(payload, event);
        }
    },
        () => { console.log("Processed event") }
    )
}


function offloadHandler(payload: any[], event: any): Boolean {
    console.log(`Processed Payloads\n\t${JSON.stringify(payload)}`);
    console.log(`Processed Event\n\t${JSON.stringify(event)}`);
    return true;
}

offloader();