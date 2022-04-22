// "use strict";

// const AWS = require('aws-sdk');
// const ini = require('ini');
// const fs = require('fs');
// const execSync = require("child_process").execSync;

// let currentProfile = null;

// module.exports = function (profile) {
//   console.log("^^^^^^^^^^^^^^^^^^^^^^^^^^^")
//   profile = profile || process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE;

//   if (profile != currentProfile) {
//     let configFile = `${process.env.HOME}/.aws/config`;
//     if (fs.existsSync(configFile)) {
//       let config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
//       console.log("config is", config);

//       let p = config[`profile ${profile}`];
//       if (p && profile !== 'default' && p.role_arn) {
//         let cacheFile = `${profile}--${p.role_arn.replace(/:/g, '_').replace(/[^A-Za-z0-9\-_]/g, '-')}`;
//         if (!fs.existsSync(cacheFile)) {
//           execSync('aws s3 ls')
//           //Then we need to get the credentials cached


//         }


//         let data = JSON.parse(fs.readFileSync(`${profile}--${p.role_arn.replace(/:/g, '_').replace(/[^A-Za-z0-9\-_]/g, '-')}`));
//         console.log(data);
//         AWS.config.credentials = new AWS.STS().credentialsFrom(data, data);
//       }
//     } else {
//       var credentials = new AWS.SharedIniFileCredentials({
//         profile: profile
//       });
//       AWS.config.credentials = credentials;
//       process.env.AWS_PROFILE = profile;
//     }
//   }
// }
