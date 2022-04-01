import util from "aws-sdk/lib/util";

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
const Configuration = util.inherit({
	/**
	 * A configuration object can be created using positional arguments or an options
	 * hash.
	 *

	 */
	constructor: function Configuration(config: any = {}) {
		// hide secretAccessKey from being displayed with util.inspect
		//util.hideProperties(this, ['secretAccessKey']);

		this.expired = false;
		this.expireTime = null;
		this.refreshCallbacks = [];

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
			"LeoSettings"
		].forEach(field => {
			this[field] = config[field];
		});
	},

	/**
	 * @return [Integer] the number of seconds before {expireTime} during which
	 *   the configuration will be considered expired.
	 */
	expiryWindow: 15,

	/**
	 * @return [Boolean] whether the configuration object should call {refresh}
	 * @note Subclasses should override this method to provide custom refresh
	 *   logic.
	 */
	needsRefresh: function needsRefresh() {
		var currentTime = util.date.getDate().getTime();
		var adjustedTime = new Date(currentTime + this.expiryWindow * 1000);

		if (this.expireTime && adjustedTime > this.expireTime) {
			return true;
		} else {
			let valid = [
				"Region",
				"LeoStream",
				"LeoCron",
				"LeoEvent",
				"LeoS3",
				"LeoKinesisStream",
				"LeoFirehoseStream",
				"LeoSettings"
			].every(field => {
				return this[field] != null || field === "LeoSettings";
			});

			return this.expired || !valid
		}
	},

	resolve: function resolve(callback) {
		this.get((err) => {
			let data;
			if (!err) {
				data = {
					Region: this.Region,
					LeoStream: this.LeoStream,
					LeoCron: this.LeoCron,
					LeoEvent: this.LeoEvent,
					LeoS3: this.LeoS3,
					LeoKinesisStream: this.LeoKinesisStream,
					LeoFirehoseStream: this.LeoFirehoseStream,
					LeoSettings: this.LeoSettings,
				}
			}
			callback(err, data);
		})
	},

	/**
	 * Gets the existing configuration, refreshing them if they are not yet loaded
	 * or have expired. Users should call this method before using {refresh},
	 * as this will not attempt to reload configuration when they are already
	 * loaded into the object.
	 *
	 * @callback callback function(err)
	 *   When this callback is called with no error, it means either configuration
	 *   do not need to be refreshed or refreshed configuration information has
	 *   been loaded into the object.
	 *   @param err [Error] if an error occurred, this value will be filled
	 */
	get: function get(callback) {
		var self = this;
		if (this.needsRefresh()) {
			this.refresh(function (err) {
				if (!err) self.expired = false; // reset expired flag
				if (callback) callback(err);
			});
		} else if (callback) {
			callback();
		}
	},

	/**
	 * @!method  getPromise()
	 *   Returns a 'thenable' promise.
	 *   Gets the existing configuration, refreshing them if they are not yet loaded
	 *   or have expired. Users should call this method before using {refresh},
	 *   as this will not attempt to reload configuration when they are already
	 *   loaded into the object.
	 *
	 *   Two callbacks can be provided to the `then` method on the returned promise.
	 *   The first callback will be called if the promise is fulfilled, and the second
	 *   callback will be called if the promise is rejected.
	 *   @callback fulfilledCallback function()
	 *     Called if the promise is fulfilled. When this callback is called, it
	 *     means either configuration do not need to be refreshed or refreshed
	 *     configuration information has been loaded into the object.
	 *   @callback rejectedCallback function(err)
	 *     Called if the promise is rejected.
	 *     @param err [Error] if an error occurred, this value will be filled
	 *   @return [Promise] A promise that represents the state of the `get` call.
	 *   @example Calling the `getPromise` method.
	 *     var promise = credProvider.getPromise();
	 *     promise.then(function() { ... }, function(err) { ... });
	 */

	/**
	 * @!method  refreshPromise()
	 *   Returns a 'thenable' promise.
	 *   Refreshes the coniguration. Users should call {get} before attempting
	 *   to forcibly refresh coniguration.
	 *
	 *   Two callbacks can be provided to the `then` method on the returned promise.
	 *   The first callback will be called if the promise is fulfilled, and the second
	 *   callback will be called if the promise is rejected.
	 *   @callback fulfilledCallback function()
	 *     Called if the promise is fulfilled. When this callback is called, it
	 *     means refreshed configuration information has been loaded into the object.
	 *   @callback rejectedCallback function(err)
	 *     Called if the promise is rejected.
	 *     @param err [Error] if an error occurred, this value will be filled
	 *   @return [Promise] A promise that represents the state of the `refresh` call.
	 *   @example Calling the `refreshPromise` method.
	 *     var promise = credProvider.refreshPromise();
	 *     promise.then(function() { ... }, function(err) { ... });
	 */

	/**
	 * Refreshes the configuration. Users should call {get} before attempting
	 * to forcibly refresh configuration.
	 *
	 * @callback callback function(err)
	 *   When this callback is called with no error, it means refreshed
	 *   configuration information has been loaded into the object (as the
	 *   `accessKeyId`, `secretAccessKey`, and `sessionToken` properties).
	 *   @param err [Error] if an error occurred, this value will be filled
	 * @note Subclasses should override this class to reset then
	 *   configuration object and then call the callback with
	 *   any error information.
	 * @see get
	 */
	refresh: function refresh(callback) {
		this.expired = false;
		callback();
	},

	// /**
	//  * @api private
	//  * @param callback
	//  */
	// coalesceRefresh: function coalesceRefresh(callback, sync) {
	// 	var self = this;
	// 	if (self.refreshCallbacks.push(callback) === 1) {
	// 		self.load(function onLoad(err) {
	// 			util.arrayEach(self.refreshCallbacks, function (callback) {
	// 				if (sync) {
	// 					callback(err);
	// 				} else {
	// 					// callback could throw, so defer to ensure all callbacks are notified
	// 					util.defer(function () {
	// 						callback(err);
	// 					});
	// 				}
	// 			});
	// 			self.refreshCallbacks.length = 0;
	// 		});
	// 	}
	// },

	// /**
	//  * @api private
	//  * @param callback
	//  */
	// load: function load(callback) {
	// 	callback();
	// }
});


Configuration.addPromisesToClass = function addPromisesToClass(PromiseDependency) {
	this.prototype.getPromise = util.promisifyMethod('get', PromiseDependency);
	this.prototype.refreshPromise = util.promisifyMethod('refresh', PromiseDependency);
};


Configuration.deletePromisesFromClass = function deletePromisesFromClass() {
	delete this.prototype.getPromise;
	delete this.prototype.refreshPromise;
};

util.addPromises(Configuration);


export default Configuration;
