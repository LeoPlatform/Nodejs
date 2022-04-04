import AWS from "aws-sdk";


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
			if (ret === abort) break;
		}
	}
}

export function inherit(klass?, features?) {
	var newObject = null;
	if (features === undefined) {
		features = klass;
		klass = Object;
		newObject = {};
	} else {
		var ctor = function ConstructorWrapper() { };
		ctor.prototype = klass.prototype;
		newObject = new ctor();
	}

	// constructor not supplied, create pass-through ctor
	if (features.constructor === Object) {
		features.constructor = function () {
			if (klass !== Object) {
				return klass.apply(this, arguments);
			}
		};
	}

	features.constructor.prototype = newObject;
	update(features.constructor.prototype, features);
	features.constructor.__super__ = klass;
	return features.constructor;
}

export function promisifyMethod(methodName?, PromiseDependency?) {
	return function promise() {
		var self = this;
		var args = Array.prototype.slice.call(arguments);
		return new PromiseDependency(function (resolve, reject) {
			args.push(function (err, data) {
				if (err) {
					reject(err);
				} else {
					resolve(data);
				}
			});
			self[methodName].apply(self, args);
		});
	};
}

export function addPromises(constructors?, PromiseDependency?) {
	var deletePromises = false;
	if (PromiseDependency === undefined && AWS && AWS.config) {
		PromiseDependency = AWS.config.getPromisesDependency();
	}
	if (PromiseDependency === undefined && typeof Promise !== 'undefined') {
		PromiseDependency = Promise;
	}
	if (typeof PromiseDependency !== 'function') deletePromises = true;
	if (!Array.isArray(constructors)) constructors = [constructors];

	for (var ind = 0; ind < constructors.length; ind++) {
		var constructor = constructors[ind];
		if (deletePromises) {
			if (constructor.deletePromisesFromClass) {
				constructor.deletePromisesFromClass();
			}
		} else if (constructor.addPromisesToClass) {
			constructor.addPromisesToClass(PromiseDependency);
		}
	}
}

export const fn = {
	noop: function () { },
	callback: function (err) { if (err) throw err; },

	// /**
	//  * Turn a synchronous function into as "async" function by making it call
	//  * a callback. The underlying function is called with all but the last argument,
	//  * which is treated as the callback. The callback is passed passed a first argument
	//  * of null on success to mimick standard node callbacks.
	//  */
	// makeAsync: function makeAsync(fn, expectedArgs) {
	// 	if (expectedArgs && expectedArgs <= fn.length) {
	// 		return fn;
	// 	}

	// 	return function () {
	// 		var args = Array.prototype.slice.call(arguments, 0);
	// 		var callback = args.pop();
	// 		var result = fn.apply(null, args);
	// 		callback(result);
	// 	};
	// }
}

export function copy(object) {
	if (object === null || object === undefined) return object;
	var dupe = {};
	// jshint forin:false
	for (var key in object) {
		dupe[key] = object[key];
	}
	return dupe;
}

export function error(err, options) {
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
	} else if (typeof options === 'object' && options !== null) {
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

	if (originalError) err.originalError = originalError;

	return err;
}
export function arrayEach(array, iterFunction) {
	for (var idx in array) {
		if (Object.prototype.hasOwnProperty.call(array, idx)) {
			var ret = iterFunction.call(this, array[idx], parseInt(idx, 10));
			if (ret === abort) break;
		}
	}
}

export const date = {

	/**
	 * @return [Date] the current JavaScript date object. Since all
	 *   AWS services rely on this date object, you can override
	 *   this function to provide a special time value to AWS service
	 *   requests.
	 */
	getDate: function getDate() {
		if (AWS.config.systemClockOffset) { // use offset when non-zero
			return new Date(new Date().getTime() + AWS.config.systemClockOffset);
		} else {
			return new Date();
		}
	}
};

export default {
	inherit,
	promisifyMethod,
	addPromises,
	error,
	arrayEach,
	fn,
	date
};
