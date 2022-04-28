"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.date = exports.error = exports.copy = void 0;
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const abort = {};
function update(obj1, obj2) {
    each(obj2, function iterator(key, item) {
        obj1[key] = item;
    });
    return obj1;
}
function each(object, iterFunction) {
    for (var key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
            var ret = iterFunction.call(this, key, object[key]);
            if (ret === abort)
                break;
        }
    }
}
function copy(object) {
    if (object === null || object === undefined)
        return object;
    var dupe = {};
    for (var key in object) {
        dupe[key] = object[key];
    }
    return dupe;
}
exports.copy = copy;
function error(err, options) {
    var originalError = null;
    if (typeof err.message === 'string' && err.message !== '') {
        if (typeof options === 'string' || (options && options.message)) {
            originalError = copy(err);
            originalError.message = err.message;
        }
    }
    err.message = err.message || null;
    if (typeof options === 'string') {
        err.message = options;
    }
    else if (typeof options === 'object' && options !== null) {
        update(err, options);
        if (options.message)
            err.message = options.message;
        if (options.code || options.name)
            err.code = options.code || options.name;
        if (options.stack)
            err.stack = options.stack;
    }
    if (typeof Object.defineProperty === 'function') {
        Object.defineProperty(err, 'name', { writable: true, enumerable: false });
        Object.defineProperty(err, 'message', { enumerable: true });
    }
    err.name = String(options && options.name || err.name || err.code || 'Error');
    err.time = new Date();
    if (originalError)
        err.originalError = originalError;
    return err;
}
exports.error = error;
exports.date = {
    /**
     * @return [Date] the current JavaScript date object. Since all
     *   AWS services rely on this date object, you can override
     *   this function to provide a special time value to AWS service
     *   requests.
     */
    getDate: function getDate() {
        if (aws_sdk_1.default.config.systemClockOffset) { // use offset when non-zero
            return new Date(new Date().getTime() + aws_sdk_1.default.config.systemClockOffset);
        }
        else {
            return new Date();
        }
    }
};
exports.default = {
    error,
    date: exports.date
};
//# sourceMappingURL=aws-util.js.map