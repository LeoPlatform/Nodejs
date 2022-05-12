module.exports = {
	"parser": "@typescript-eslint/parser",
	"plugins": ["@typescript-eslint"],
	"env": {
		"node": true,
		"mocha": true,
		"jquery": true,
		"commonjs": true,
		"es2021": true
	},
	"extends": [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended"
	],
	"parserOptions": {
		"sourceType": "module",
		"ecmaVersion": "2022"
	},
	"rules": {
		"eol-last": [
			"error",
			"always"
		],
		"no-console": "off",
		"indent": [
			"error",
			"tab",
			{ "SwitchCase": 1 }
		],
		"semi": [
			"error",
			"always"
		],
		"@typescript-eslint/no-var-requires": "off",
		"@typescript-eslint/no-inferrable-types": "off",
		"@typescript-eslint/no-empty-interface": "off",

		/* Should Be Enable */
		"@typescript-eslint/no-explicit-any": "off", // "warn" // ~55
		"@typescript-eslint/no-unused-vars": "off", // "warn" // ~60
		"@typescript-eslint/no-empty-function": "off", // "error" // ~18
		"@typescript-eslint/no-unnecessary-type-constraint": "off", // "error" // ~1
		"@typescript-eslint/ban-types": "off", // "error" // ~1
		"no-redeclare": "off",  // "error" // ~7
		"no-var": "off", // "error" // ~270
		"max-lines": "off", // "error" // ~10
		"no-magic-numbers": "off", // "error" // ~325
		"prefer-const": "off", // "error" // ~225
		"no-extra-boolean-cast": "off", // "error" // ~1
	}
};
