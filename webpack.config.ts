const path = require('path');
const { glob } = require("glob");
module.exports = (async () => {

	const entryFiles = (await glob("**/*-task-module.ts", {
		ignore: ["node_modules/**", "util-lambdas/**"],
	})).reduce((all, file) => {
		console.log("File:", file);
		all[file.replace(/\.ts$/, "")] = path.resolve(__dirname, file);
		return all;
	}, {});

	console.log(entryFiles);
	return {
		entry: {
			...entryFiles
		},
		externals: [
			/^@aws-sdk\//
		],
		// Don't include source map for these files
		// devtool: 'source-map',
		mode: "production",
		module: {
			rules: [
				// all files with a `.ts` or `.tsx` extension will be handled by `ts-loader`
				{
					exclude: [
						[
							path.resolve(__dirname, ".webpack"),
						],
					],
					loader: "ts-loader",
					options: {
						experimentalWatchApi: true,
						transpileOnly: true,
					},
					test: /\.(tsx?)$/,
				}
			],
		},
		optimization: {
			minimize: false, // We do not want to minimize our code. Easier to fix in lambda console.
		},
		output: {
			filename: "[name].js",
			libraryTarget: "commonjs",
			path: __dirname//path.join(__dirname, ".webpack")
		},
		resolve: {
			cacheWithContext: false,
			extensions: [".mjs", ".json", ".ts", ".js"],
			symlinks: false,
		},
		target: "node"
	};
})();
