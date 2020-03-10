module.exports = {
  "env": {
    "es6": true,
    "node": true,
    "mocha": true,
    "jquery": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "sourceType": "module",
    "ecmaVersion": 2017
  },
  "rules": {
    "eol-last": ["error", "always"],
    "no-console": 0,
    "indent": [
      "error",
      "tab"
    ],
    "linebreak-style": [
      "error",
      "unix"
    ],
    "semi": [
      "error",
      "always"
    ]
  }
}
