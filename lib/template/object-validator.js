"use strict";

var extend = require("extend");

function validate(obj) {
	var results = {
		obj: extend(true, {}, obj),
		error: {},
		warn: {},
		info: {}
	};
	var verifyPath = function(field) {
		var o = field.split(".").reverse().reduce((o, f) => {
			return {
				[f]: o
			}
		}, null);
		results.obj = extend(true, {}, results.obj, o, results.obj);
	};

	var set = function(obj, field, index, data) {
		if (!(field in obj)) {
			obj[field] = ['', '', ''];
		}
		if (obj[field][index] == '') {
			obj[field][index] = data.message;
			verifyPath(field);
		}
		if (obj[field][2] == '' && data.color) {
			obj[field][2] = data.color || '';
		}
	};
	var value = function(field) {
		return field.split(".").reduce((o, f) => {
			return (o != undefined && o != null) ? o[f] : undefined
		}, obj);
	}
	var v = function(field) {
		var ret = null;
		var closed = false;
		var isRequired = false;
		if (field) {
			ret = {
				isRequired: function() {
					return isRequired;
				},
				isClosed: function() {
					return closed;
				},
				required: function(opts) {
					isRequired = true;
					if (!closed) {
						var v = value(field);
						var t = typeof v;
						if (t == "undefined" || v == null) {
							closed = true;
							opts = opts || {};
							set(results[opts.type || 'error'], field, 0, Object.assign({
								message: "Missing required parameter"
							}, opts));
						}
					}
					return this;
				},
				in : function(values, opts) {
					if (!closed) {
						var v = value(field);
						if (values.indexOf(v) == -1 && (isRequired || v != undefined)) {
							opts = opts || {};
							set(results[opts.type || 'error'], field, 1, Object.assign({
								message: `expected (${values.join(',')})`
							}, opts));
						}
					}
					return this;
				},
				ofType: function(type, opts) {
					if (!closed) {
						var v = value(field);
						if ((typeof v !== type || (type == "array" && Array.isArray(v))) && (isRequired || v != undefined)) {
							opts = opts || {};
							set(results[opts.type || 'error'], field, 1, Object.assign({
								message: `invalid type, expected ${type}`
							}, opts));
						}
					}
					return this;
				},
				type: function() {
					return this.ofType.apply(this, arguments);
				},
				notOfType: function(type, opts) {
					if (!closed) {
						var v = value(field);
						if ((typeof v === type)) {
							opts = opts || {};
							set(results[opts.type || 'error'], field, 1, Object.assign({
								message: `invalid type ${type}`
							}, opts));
						}
					}
					return this;
				},
				notType: function() {
					return this.notOfType.apply(this, arguments);
				},
				match: function(regex, opts) {
					if (!closed) {
						var v = value(field);
						if ((isRequired || v != undefined) && (v == null || !v.match || !v.match(regex))) {
							opts = opts || {};
							set(results[opts.type || 'error'], field, 1, Object.assign({
								message: `invalid value, should match ${regex}`
							}, opts));
						}
					}
					return this;
				},
				info: function(message, color, side) {
					if (!closed) {
						var v = value(field);
						set(results.info, field, side || 0, {
							message: message,
							color: color
						});
					}
					return this;
				},
				assert: function(callback, opts) {
					if (!closed) {
						var v = value(field);
						if ((isRequired || v != undefined) && !callback(v)) {
							opts = opts || {};
							set(results[opts.type || 'error'], field, 1, Object.assign({
								message: `invalid value`
							}, opts));
						}
					}
					return this;
				},
				value: function() {
					return value(field);
				}
			}
		} else {
			ret = {
				results: function() {
					return results;
				}
			}
		}
		return ret;
	};
	v.results = function() {
		return results;
	}
	return v;
}

module.exports = validate;