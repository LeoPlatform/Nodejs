"use strict";
const AWS = require('./leo-aws');

module.exports = function (configuration) {
	return {
		decryptString: function (secretName, done) {
			let region = configuration.aws.region;
			let secret = new AWS.SecretsManager({
				endpoint: `https://secretsmanager.${region}.amazonaws.com`,
				region: region,
				apiVersion: '2017-10-17'
			});

			secret.getSecretValue({
					SecretId: secretName
				},
				(err, data) => {
					if (err) {
						console.log(err, err.stack);
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