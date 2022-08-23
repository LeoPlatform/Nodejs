"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_util_1 = __importDefault(require("./aws-util"));
/**
 * Represents your RSTREAMS configuration
 * Creating a `Configuration` object allows you to pass around your
 * coinfig information to configuration and service objects.
 *
 *
 * ## Expiring and Refreshing Configuration
 *
 * Occasionally configuration can expire in the middle of a long-running
 * application. In this case, the SDK will automatically attempt to
 * refresh the configuration from the storage location if the Configuration
 * class implements the {refresh} method.
 *
 * If you are implementing a configuration storage location, you
 * will want to create a subclass of the `Configuration` class and
 * override the {refresh} method. This method allows configuration to be
 * retrieved from the backing store, be it a file system, database, or
 * some network storage. The method should reset the configuration attributes
 * on the object.
 *
 * @!attribute expired
 *   @return [Boolean] whether the configuration have been expired and
 *     require a refresh. Used in conjunction with {expireTime}.
 * @!attribute expireTime
 *   @return [Date] a time when configuration should be considered expired. Used
 *     in conjunction with {expired}.

 */
class Configuration {
    /**
     * A configuration object can be created using positional arguments or an options
     * hash.
     *

     */
    constructor(config = {}) {
        this.expireTime = 0;
        this.expired = false;
        /**
         * @return [Integer] the number of seconds before {expireTime} during which
         *   the configuration will be considered expired.
         */
        this.expiryWindow = 15;
        this.update(config);
    }
    update(config = {}) {
        this.expired = false;
        this.expireTime = 0;
        // Got verbose style so switch it to just the resource style
        if (config.s3 && config.resources) {
            config = config.resources;
        }
        [
            "Region",
            "LeoStream",
            "LeoCron",
            "LeoEvent",
            "LeoS3",
            "LeoKinesisStream",
            "LeoFirehoseStream",
            "LeoSettings",
            "LeoSystem"
        ].forEach(field => {
            this[field] = config[field];
        });
    }
    /**
     * @return [Boolean] whether the configuration object should call {refresh}
     * @note Subclasses should override this method to provide custom refresh
     *   logic.
     */
    needsRefresh() {
        let currentTime = aws_util_1.default.date.getDate().getTime();
        let adjustedTime = new Date(currentTime + this.expiryWindow * 1000);
        if (this.expireTime && adjustedTime.valueOf() > this.expireTime) {
            return true;
        }
        else {
            let valid = [
                "Region",
                "LeoStream",
                "LeoCron",
                "LeoEvent",
                "LeoS3",
                "LeoKinesisStream",
                "LeoFirehoseStream",
                "LeoSettings",
                "LeoSystem"
            ].every(field => {
                return this[field] != null || field === "LeoSettings" || field === "LeoSystem";
            });
            return this.expired || !valid;
        }
    }
    resolveSync() {
        this.getSync();
        return {
            Region: this.Region,
            LeoStream: this.LeoStream,
            LeoCron: this.LeoCron,
            LeoEvent: this.LeoEvent,
            LeoS3: this.LeoS3,
            LeoKinesisStream: this.LeoKinesisStream,
            LeoFirehoseStream: this.LeoFirehoseStream,
            LeoSettings: this.LeoSettings,
            LeoSystem: this.LeoSystem,
        };
    }
    /**
     * Gets the existing configuration, refreshing them if they are not yet loaded
     * or have expired. Users should call this method before using {refresh},
     * as this will not attempt to reload configuration when they are already
     * loaded into the object.
     */
    getSync() {
        if (this.needsRefresh()) {
            this.refreshSync();
            this.expired = false;
        }
    }
    /**
     * Refreshes the configuration. Users should call {get} before attempting
     * to forcibly refresh configuration.
     *
     * @note Subclasses should override this class to reset then
     *   configuration object and then call the callback with
     *   any error information.
     * @see get
     */
    refreshSync() {
        this.expired = false;
    }
}
exports.default = Configuration;
//# sourceMappingURL=rstreams-configuration.js.map