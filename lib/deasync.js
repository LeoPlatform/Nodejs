/*!
 * deasync
 * https://github.com/abbr/deasync
 *
 * Copy of the deasync lib that looks holds references to each .node file 
 * So it can survive webpack
 */
const path = require("path");
const fs = require("fs");
let bindings = {
	// Darwin
	"darwin-x64-node-12": () => { try { return require("deasync/bin/darwin-x64-node-12/deasync") } catch (ex) { return undefined } },
	"darwin-x64-node-14": () => { try { return require("deasync/bin/darwin-x64-node-14/deasync") } catch (ex) { return undefined } },
	"darwin-x64-node-16": () => { try { return require("deasync/bin/darwin-x64-node-16/deasync") } catch (ex) { return undefined } },

	// linux
	"linux-x64-node-12": () => { try { return require("deasync/bin/linux-x64-node-12/deasync") } catch (ex) { return undefined; } },
	"linux-x64-node-14": () => { try { return require("deasync/bin/linux-x64-node-14/deasync") } catch (ex) { return undefined; } },
	"linux-x64-node-16": () => { try { return require("deasync/bin/linux-x64-node-16/deasync") } catch (ex) { return undefined; } },

	// Windows 32 bit
	"win32-ia32-node-12": () => { try { return require("deasync/bin/win32-ia32-node-12/deasync") } catch (ex) { return undefined; } },
	"win32-ia32-node-14": () => { try { return require("deasync/bin/win32-ia32-node-14/deasync") } catch (ex) { return undefined; } },
	"win32-ia32-node-16": () => { try { return require("deasync/bin/win32-ia32-node-16/deasync") } catch (ex) { return undefined; } },

	// Windows 64 bit
	"win32-x64-node-12": () => { try { return require("deasync/bin/win32-x64-node-12/deasync") } catch (ex) { return undefined; } },
	"win32-x64-node-14": () => { try { return require("deasync/bin/win32-x64-node-14/deasync") } catch (ex) { return undefined; } },
	"win32-x64-node-16": () => { try { return require("deasync/bin/win32-x64-node-16/deasync") } catch (ex) { return undefined; } },
};

const MIN_NODE_VERSION = 12;
const MAX_NODE_VERSION = 16;

// Seed random numbers [gh-82] if on Windows. See https://github.com/laverdet/node-fibers/issues/82
if (process.platform === 'win32') Math.random()

// Look for binary for this platform
let nodeVM = /[0-9]+/.exec(process.versions.node)[0];

let binding;
try {
	// Lookup the best version of node bindings
	let nodVMInt = parseInt(nodeVM, 10);
	if (binding == null && nodVMInt != null) {
		// Find closest version looking backwards
		for (var v = nodVMInt; binding == null && v >= MIN_NODE_VERSION; v--) {
			let modPath = `${process.platform}-${process.arch}-node-${v}`;
			console.log("Trying", modPath);
			binding = (bindings[modPath] || none)();
		}
		// Find closest version looking forward
		for (var v = nodVMInt + 1; binding == null && v <= MAX_NODE_VERSION; v++) {
			let modPath = `${process.platform}-${process.arch}-node-${v}`;
			console.log("Trying", modPath);
			binding = (bindings[modPath] || none)();
		}
	}
	if (binding == null) {
		throw new Error("Deasync bindings not found");
	} else if (binding.default) {
		// Handle webpack version
		/**
		 * using the file loader for webpack will put the files in the directory structure
		 * walk up the that structure looking for the webpacked file
		 * if we find it load it in as bindings
		 */
		let filename = binding.default;
		let currentDir = __dirname;

		// Get underlying require function
		const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

		// Walk the tree
		let lastDir;
		do {
			try {
				let file = path.resolve(currentDir, filename);

				// If the webpacks file exists equire it
				if (fs.existsSync(file)) {
					binding = requireFunc(file);
					break;
				}
			} catch (err) {
				// Nothing to do
			}
			lastDir = currentDir;
			currentDir = path.resolve(currentDir, "../");
		} while (currentDir != lastDir);


	}
} catch (ex) {
	binding = require('bindings')('deasync')
}

function none() { return undefined; }

function deasync(fn) {
	return function() {
		let done = false;
		let args = Array.prototype.slice.apply(arguments).concat(cb);
		let err;
		let res;

		fn.apply(this, args);
		module.exports.loopWhile(function() {
			return !done;
		})
		if (err)
			throw err;

		return res;

		function cb(e, r) {
			err = e;
			res = r;
			done = true;
		}
	}
}

module.exports = deasync

module.exports.sleep = deasync(function(timeout, done) {
	setTimeout(done, timeout)
});

module.exports.runLoopOnce = function() {
	process._tickCallback();
	binding.run();
}

module.exports.loopWhile = function(pred) {
	while (pred()) {
		process._tickCallback();
		if (pred()) binding.run();
	}
};
