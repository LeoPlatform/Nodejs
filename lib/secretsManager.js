"use strict";
const AWS = require('./leo-aws');

module.exports = function (configuration) {
	return {
		getSecret: async function (secretName) {
			let self = this;
			let promise = new Promise((resolve, reject) => {
				self.decryptString(secretName, (err, result) => {
					if (err) {
						reject(err);
					} else {
						resolve(result);
					}
				});
			});

			return await promise;
		},
		decryptString: function (secretName, done) {
			let region = configuration.aws.region;
			let secret = new AWS.SecretsManager({
				endpoint: `https://secretsmanager.${region}.amazonaws.com`,
				region: region
				// apiVersion: '2017-10-17'
			});

			secret.getSecretValue({SecretId: secretName}, (err, data) => {
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
		encryptString: function (value, done) {
			done('Encrypt not implemented');
		}
	}
};