var LeoConfiguration = require("../../lib/configuration.js");

function ES(configure) {
	let configuration = new LeoConfiguration(configure);
	return Object.assign((config) => {
		return new ES(config)
	}, {
		configuration: configuration,
		write: require("./toES.js")(configuration).stream
	})
}




module.exports = new ES();