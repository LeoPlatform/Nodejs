process.env.LEO_ENVIRONMENT = "test"
let config = require('leo-config');
config.bootstrap(require("../config/leo_config"));

import leo from "../../index"

let sdk = leo(false);

/* 
    Put should be used to write a single event to a queue
*/

function putEvent() {
    sdk.put("test-ts-types-leo-2", "bentest-2-ts-types-leo-queue", { "Working": "Yes" }, null)
}

putEvent();