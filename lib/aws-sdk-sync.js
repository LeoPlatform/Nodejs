"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3 = exports.SecretsManager = exports.invoke = void 0;
const child_process_1 = require("child_process");
// Build a function to call on a different process
// use `module.require` to keep webpack from overriding the function.
// This isn't run within the bundle
// It is stringified and run in a different process
function invoke(service, method, config, params) {
    let AWS = module.require.call(module, "aws-sdk");
    let hasLogged = false;
    try {
        new AWS[service](config)[method](params, (err, data) => {
            if (!hasLogged) {
                hasLogged = true;
                console.log(`RESPONSE::${JSON.stringify({ error: err, response: data })}::RESPONSE`);
            }
        });
    }
    catch (err) {
        if (err.message.match(/is not a function/)) {
            err.message = `AWS.${service}.${method} is not a function`;
        }
        else if (err.message.match(/is not a constructor/)) {
            err.message = `AWS.${service} is not a constructor`;
        }
        if (!hasLogged) {
            hasLogged = true;
            console.log(`RESPONSE::${JSON.stringify({ error: { message: err.message } })}::RESPONSE`);
        }
    }
}
exports.invoke = invoke;
function run(service, method, config, params) {
    let fn = `(${invoke.toString()})("${service}", "${method}", ${JSON.stringify(config)}, ${JSON.stringify(params)})`;
    // Spawn node with the function to run `node -e (()=>{})`
    // Using `RESPONSE::{}::RESPONSE` to denote the response in the output
    let child = (0, child_process_1.spawnSync)(process.execPath, ["-e", fn]);
    if (child.error != null) {
        // If the process had an error, throw it
        throw child.error;
    }
    else if (child.output.length > 0) {
        // Try to extract the response
        let output = child.output.join("");
        let outputJson = (child.output.join("").match(/RESPONSE::({.*})::RESPONSE/) || [])[1];
        if (outputJson == null) {
            throw new Error(`Invalid Response: ${output}`);
        }
        else {
            let parsedData = JSON.parse(outputJson);
            // Return the response or error
            if (parsedData.error != null) {
                throw Object.assign(new Error(parsedData.error.message), parsedData.error);
            }
            else {
                return parsedData.response;
            }
        }
    }
}
class Service {
    constructor(options) {
        this.options = options;
    }
    invoke(method, params) {
        return run(this.constructor.name, method, this.options, params);
    }
}
class SecretsManager extends Service {
    getSecretValue(params) {
        return this.invoke("getSecretValue", params);
    }
}
exports.SecretsManager = SecretsManager;
class S3 extends Service {
    listBuckets() {
        return this.invoke("listBuckets");
    }
}
exports.S3 = S3;
exports.default = {
    SecretsManager,
    S3
};
//# sourceMappingURL=aws-sdk-sync.js.map