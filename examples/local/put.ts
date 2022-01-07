process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));

import leo from "../../index"

let sdk = leo(config.leosdk);

/* 
    Put should be used to write a single event to a queue.
    If you need to write multiple events from a file or some other input source, see (loadWithFileRead.ts) or (load.ts)
*/

function putEvent() {
    sdk.put("test-ts-types-leo-sandbox", "test-ts-types-leo-sandbox-queue", { "Working": "Yes" }, null)
}

putEvent();