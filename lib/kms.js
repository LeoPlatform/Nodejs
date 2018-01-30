"use strict";
module.exports = {
  decryptString: function (encryptedString, done) {
    let kms = AWS.KMS();
    kms.decrypt({ CiphertextBlob: new Buffer(encryptedString, 'base64') }, function(err, data) {
      if (err) {
        return done(err);
      } else {
        done(null, data.Plaintext.toString('ascii'));
      }
    });
  }
};