var LeoConfiguration = require("../../lib/configuration.js");

function ES(configure) {
	let configuration = new LeoConfiguration(configure);
	let es = require("./toES.js")(configuration);
	return Object.assign((config) => {
		return new ES(config)
	}, {
		configuration: configuration,
		write: es.stream,
		query: es.query,
		get: es.get,
		_: es
	})
}




module.exports = new ES();