/* eslint-disable max-lines */
module.exports = {
	"parser": "@typescript-eslint/parser",
	"plugins": ["@typescript-eslint"],
	"env": {
		// "es6": true,
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
			"tab"
		],
		"semi": [
			"error",
			"always"
		],
		"@typescript-eslint/no-var-requires": "off",


		/** Should keep */
		// "no-var": "error",
		// "max-lines": "error",
		// "no-magic-numbers": "warn",

		/** Will rules */
		"accessor-pairs": "error",
		"array-bracket-newline": "error",
		"array-bracket-spacing": "error",
		"array-callback-return": "error",
		// "array-element-newline": "error",
		"arrow-body-style": "off",
		"arrow-parens": [
			"error",
			"always"
		],
		"arrow-spacing": [
			"error",
			{
				"after": true,
				"before": true
			}
		],
		"block-scoped-var": "error",
		"block-spacing": "error",
		"brace-style": [
			"error",
			"1tbs"
		],
		"camelcase": "off",
		/*
		 * "capitalized-comments": [
		 *  "error",
		 *  "always"
		 * ],
		 */
		"class-methods-use-this": "error",
		// "comma-dangle": "error",
		"comma-spacing": [
			"error",
			{
				"after": true,
				"before": false
			}
		],
		"comma-style": [
			"error",
			"last"
		],
		"complexity": [
			"warn",
			{"max": 50}
		],
		"computed-property-spacing": [
			"error",
			"never"
		],
		// "consistent-return": ["error", { "treatUndefinedAsUnspecified": true }],
		"consistent-this": "error",
		"curly": "error",
		"default-case": "error",
		"default-case-last": "error",
		"default-param-last": "error",
		"dot-location": [
			"error",
			"property"
		],
		"dot-notation": "error",
		// "eol-last": "error",
		"eqeqeq": [
			"error",
			"smart"
		],
		"func-call-spacing": "error",
		"func-name-matching": "error",
		"func-names": "off",
		// "func-style": [
		// 	"error",
		// 	"declaration"
		// ],
		"function-paren-newline": "error",
		// "generator-star-spacing": "error",
		"grouped-accessor-pairs": "error",
		// "guard-for-in": "warn",
		"id-denylist": "error",
		"id-length": "off",
		"id-match": "error",
		"implicit-arrow-linebreak": "error",
		// "init-declarations": "warn",
		"jsx-quotes": "error",
		"key-spacing": "error",
		"keyword-spacing": [
			"error",
			{
				"after": true,
				"before": true
			}
		],
		// "line-comment-position": "error",
		"lines-around-comment": "off",
		"lines-between-class-members": "error",
		"max-classes-per-file": "error",
		"max-depth": "off",
		"max-len": "off",
		// "max-lines": "error",
		"max-lines-per-function": "off",
		"max-nested-callbacks": "error",
		"max-params": "off",
		"max-statements": "off",
		"max-statements-per-line": "error",
		// "multiline-comment-style": "error",
		"multiline-ternary": "off",
		// "new-cap": "error",
		"new-parens": "error",
		"newline-per-chained-call": "error",
		"no-alert": "error",
		"no-array-constructor": "error",
		// "no-await-in-loop": "error",
		"no-bitwise": "error",
		"no-caller": "error",
		"no-confusing-arrow": "error",
		// "no-console": "off",
		"no-constructor-return": "error",
		"no-continue": "error",
		"no-div-regex": "error",
		"no-duplicate-imports": "error",
		"no-else-return": "error",
		"no-empty-function": "error",
		// "no-eq-null": "error",
		"no-eval": "error",
		"no-extend-native": "error",
		"no-extra-bind": "error",
		"no-extra-label": "error",
		// "no-extra-parens": "error",
		"no-floating-decimal": "error",
		"no-implicit-coercion": "error",
		"no-implicit-globals": "error",
		"no-implied-eval": "error",
		// "no-inline-comments": "error",
		"no-invalid-this": "error",
		"no-iterator": "error",
		"no-label-var": "error",
		// "no-labels": "error",
		"no-lone-blocks": "error",
		"no-lonely-if": "error",
		"no-loop-func": "error",
		// "no-magic-numbers": "warn",
		"no-mixed-operators": "error",
		"no-multi-assign": "error",
		"no-multi-spaces": "error",
		"no-multi-str": "error",
		"no-multiple-empty-lines": "error",
		// "no-negated-condition": "error",
		"no-nested-ternary": "error",
		"no-new": "error",
		"no-new-func": "error",
		"no-new-object": "error",
		"no-new-wrappers": "error",
		"no-octal-escape": "error",
		"no-param-reassign": "off",
		"no-plusplus": "off",
		"no-promise-executor-return": "error",
		"no-proto": "error",
		"no-restricted-exports": "error",
		"no-restricted-globals": "error",
		"no-restricted-imports": "error",
		"no-restricted-properties": "error",
		"no-restricted-syntax": "error",
		"no-return-assign": "error",
		"no-return-await": "error",
		"no-script-url": "error",
		"no-self-compare": "error",
		"no-sequences": "error",
		"no-shadow": "off",
		// "no-tabs": [
		// 	"error",
		// 	{
		// 		"allowIndentationTabs": true
		// 	}
		// ],
		"no-template-curly-in-string": "error",
		"no-ternary": "off",
		"no-throw-literal": "off",
		"no-undef-init": "error",
		"no-undefined": "off",
		// "no-underscore-dangle": "error",
		"no-unmodified-loop-condition": "error",
		"no-unneeded-ternary": "error",
		"no-unreachable-loop": "error",
		"no-unused-expressions": "error",
		"no-unused-private-class-members": "error",
		"no-use-before-define": "error",
		"no-useless-call": "error",
		"no-useless-computed-key": "error",
		"no-useless-concat": "error",
		"no-useless-constructor": "error",
		"no-useless-rename": "error",
		"no-useless-return": "off",
		// "no-var": "error",
		"no-void": "error",
		// "no-warning-comments": "warn",
		"no-whitespace-before-property": "error",
		"nonblock-statement-body-position": "error",
		"object-curly-newline": "error",
		// "object-curly-spacing": "error",
		"object-property-newline": "error",
		"object-shorthand": "off",
		"one-var": "off",
		"one-var-declaration-per-line": "error",
		"operator-assignment": "error",
		"operator-linebreak": "error",
		"padded-blocks": "off",
		"padding-line-between-statements": "error",
		// "prefer-arrow-callback": "error",
		"prefer-const": "off",
		"prefer-destructuring": "off",
		"prefer-exponentiation-operator": "error",
		"prefer-named-capture-group": "off",
		"prefer-numeric-literals": "error",
		"prefer-object-has-own": "error",
		// "prefer-object-spread": "error",
		"prefer-promise-reject-errors": "off",
		"prefer-regex-literals": "error",
		// "prefer-rest-params": "error",
		// "prefer-spread": "error",
		"prefer-template": "off",
		"quote-props": "off",
		"quotes": "off",
		"radix": "error",
		"require-atomic-updates": "error",
		// "require-await": "error",
		"require-unicode-regexp": "off",
		"rest-spread-spacing": "error",
		// "semi": "error",
		"semi-spacing": "error",
		"semi-style": [
			"error",
			"last"
		],
		// "sort-imports": "error",
		"sort-keys": "off",
		"sort-vars": "error",
		"space-before-blocks": "error",
		"space-before-function-paren": "off",
		"space-in-parens": [
			"error",
			"never"
		],
		"space-infix-ops": "error",
		"space-unary-ops": "error",
		"spaced-comment": [
			"error",
			"always"
		],
		"strict": "warn",
		"switch-colon-spacing": "error",
		"symbol-description": "error",
		"template-curly-spacing": [
			"error",
			"never"
		],
		"template-tag-spacing": "error",
		"unicode-bom": [
			"error",
			"never"
		],
		"vars-on-top": "error",
		"wrap-iife": "error",
		"wrap-regex": "error",
		"yield-star-spacing": "error",
		"yoda": [
			"error",
			"never"
		]
	}
};
