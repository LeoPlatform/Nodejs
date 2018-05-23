"use strict";
const AWS = require('./leo-aws');

let cache = {};
module.exports = function(configuration) {
	return {
		getSecret: function(secretName, opts) {
			opts = Object.assign({
				cache: 1000 * 60 * 5
			}, opts || {});

			if (cache[secretName]) {
				if (cache[secretName].t + opts.cache > Date.now()) {
					console.log("cached value returned");
					return cache[secretName].data;
				} else {
					delete cache[secretName];
				}
			}
			return new Promise((resolve, reject) => {
				this.decryptString(secretName, (err, result) => {
					if (err) {
						reject(err);
					} else {
						cache[secretName] = {
							t: Date.now(),
							data: result
						};
						resolve(result);
					}
				});
			});
		},
		decryptString: function(secretName, done) {
			let region = configuration.aws.region;
			let secret = new AWS.SecretsManager({
				region: region
			});
			secret.getSecretValue({
				SecretId: secretName
			}, (err, data) => {
				if (err) {
					if (err.code === 'ResourceNotFoundException') {
						console.log("The requested secret " + secretName + " was not found");
					} else if (err.code === 'InvalidRequestException') {
						console.log("The request was invalid due to: " + err.message);
					} else if (err.code === 'InvalidParameterException') {
						console.log("The request had invalid params: " + err.message);
					}

					done(err);
				} else {
					done(null, JSON.parse(data.SecretString));
				}
			});
		},
		encryptString: function(value, done) {
			done('Encrypt not implemented');
		}
	};
};
