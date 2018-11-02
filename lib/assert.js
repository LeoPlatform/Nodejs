var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var ARGUMENT_NAMES = /([^\s,]+)/g;

function getParamNames(func) {
	var fnStr = func.toString().replace(STRIP_COMMENTS, '');
	var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
	if (result === null)
		result = [];
	return result;
}

function wrap(obj) {
	let data = [];
	out = (...args) => {
		return out.ok.apply(out, args);
	};
	Object.keys(obj).map(k => {
		let old = obj[k];
		if (typeof old === "function") {
			let functionParams = getParamNames(old)
			out[k] = function(...args) {
				let params = k == "fail" && args.length == 1 ? ["message"] : functionParams;
				let log = {
					passes: false,
					method: k
				};
				args.map((v, i) => {
					log[params[i] || i] = v;
				})
				try {
					let result = old.apply(obj, args);
					log.passes = true;
					data.push(log)
					return result;
				} catch (e) {
					data.push(log);
					throw e;
				}
			}
		} else {
			out[k] = old;
		}
	});
	out.get = () => data;
	out.print = () => {
		console.log(JSON.stringify(data, null, 2));
	};
	out.clear = () => {
		data = [];
		return obj;
	};
	return out;
}

module.exports = wrap(require("assert"))
