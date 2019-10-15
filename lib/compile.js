'use strict';

module.exports = {
	compile: function compile(code, process) {
		let self = this;
		let evalFn = eval;
		if (typeof code == "function") {
			evalFn = () => {
				return function (wrap) {
					let exports = {
						handler: code
					};
					let module = {
						exports: exports
					}
					return wrap(exports, module)
				};
			}
		} else if (typeof code === "object") {
			evalFn = () => {
				return function (wrap) {

					let module = code;
					if (!code.exports) {
						module = {
							exports: code
						}
					}
					return wrap(module.exports, module);
				};
			}
		} else {
			let exp = `((wrap) => {
				var exports = {};
				var module = {
					exports :exports
				};
				${code}
				return wrap(exports, module);
			})`;

			// Not an exports module.  Just a return value.  
			// Wrap it as a module
			if (!code.match(/([^\w\d]+ *exports\.?.*?)\s*=/gm)) {
				exp = `((wrap) => {
					var exports = {};
					var module = {
						exports :exports
					};
					exports.handler = (data)=>{let $ = data; ${code}}
					return wrap(exports, module);
				})`;
			}
			evalFn = () => eval(exp);
		}
		return evalFn()(function (exports, module) {
			if (!exports.handler && exports.each) {
				exports.handler = exports.each;
			}

			exports.each = self.callbackify(exports.each, 1);
			exports.handler = self.callbackify(exports.handler, 1);

			if (typeof process === "function") {
				process(exports, module);
			}
			return exports;
		});
	},
	callbackify: function (fn, arity) {
		if (fn && fn.length <= arity) {
			return function () {
				let done = arguments[arguments.length - 1];
				try {
					done(null, fn.apply(this, arguments));
				} catch (err) {
					done(err);
				}
			}
		}
		return fn;
	}
}
