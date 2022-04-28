"use strict";
var AWS = require('./leo-aws');
module.exports = function(configuration) {
	return {
		decryptString: function(encryptedString, done) {
			let kms = new AWS.KMS({
				endpoint: process.env.AWS_KMS_ENDPOINT || undefined,
				region: configuration.aws.region,
				credentials: configuration.credentials
			});
			kms.decrypt({
				CiphertextBlob: Buffer.from(encryptedString, 'base64')
			}, function(err, data) {
				if (err) {
					return done(err);
				} else {
					done(null, data.Plaintext.toString('ascii'));
				}
			});
		},
		encryptString: function(value, done) {
			let kms = new AWS.KMS({
				region: configuration.aws.region,
				credentials: configuration.credentials
			});
			kms.encrypt(value, function(err, data) {
				if (err) {
					return done(err);
				} else {
					done(null, data.CiphertextBlob.toString("base64"));
				}
			});
		}
	};
};
