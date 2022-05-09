
// How to extend the doc
// https://www.freecodecamp.org/news/a-deep-dive-into-typedocs-workflow-and-extensibility-d464683e092c/
// Good help: https://techsparx.com/nodejs/typescript/typedoc.html

import { Application, TSConfigReader, TypeDocReader, TypeDocOptions, Converter, Context, ReflectionKind, DefaultThemeRenderContext, DefaultTheme, PageEvent, Reflection } from "typedoc";
import {replaceInFile} from "replace-in-file";
import * as fs from 'fs/promises';
import {RStreamsThemeContext,  init as initRstreamsTheme} from './theme/rstreams-theme';
import * as path from 'path';

const TYPEDOC_FILE_PATH = './typedoc.json';
const THEME_ASSETS_PATH = 'theme/assets';
const BUILD_ASSETS_PATH = 'build/assets';
const MAIN_JS_PATH = BUILD_ASSETS_PATH + '/main.js';
const PATH_FOR_SERVER = 'Nodejs';
const PATH_FOR_LOCAL = 'build';
const SDK_NAME_FOR_BREADCRUMB = 'node-sdk';

class MyTheme extends DefaultTheme {
	private _contextCache?: RStreamsThemeContext;
	override getRenderContext() {
		this._contextCache ||= new RStreamsThemeContext(
			this,
			this.application.options
		);
		return this._contextCache;
	}
}

/**
 * Build the typedoc doc website using the config in TYPEDOC_FILE_PATH.
 * 
 *    "replaceText": {
        "replacements": [
            {
                "pattern": "rstreams-site-url",
                "replace": "https://rstreams.org"
            }
        ]
    },
 */

interface RstreamsTypedocConfig extends Partial<TypeDocOptions>{
	replaceText: {
		replacements: Replacement[]
	}
}

interface Replacement {
	pattern: string;
	replace: string;
}

async function buildDocs() {
	const typedocConfig = await getTypedocConfig();
	const RSTREAMS_SITE_URL = typedocConfig.replaceText?.replacements[0].replace;

	initRstreamsTheme(RSTREAMS_SITE_URL, typedocConfig.name, SDK_NAME_FOR_BREADCRUMB);

	const app = new Application();


	app.renderer.defineTheme("mydefault", MyTheme);
	//app.renderer.hooks.on("head.end", onHeadRenderHook);

	app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context: Context) => {
		onConverterCreateDeclaration(context);
	});

	app.options.addReader(new TSConfigReader());
	app.options.addReader(new TypeDocReader());

	app.bootstrap(typedocConfig);
	const project = app.convert();

	if (project) {
		await app.generateDocs(project, typedocConfig.out);
		await app.generateJson(project, typedocConfig.out + "/documentation.json");
		await postProcess(typedocConfig.out);
	} else {
		throw new Error('Project converstion failed without a cause');
	}

	// Move over theme assets manually
	const files = await getAllFiles(THEME_ASSETS_PATH, []);
	await moveFiles(files, BUILD_ASSETS_PATH);

	// Correct the search index which is sometimes setting the wrong base path and stupid
	// IE scroll code that throws uncaught JS exceptions
	await correctSearchIndexPathAndRemoveBrokenIeScrollCode();
}

/**
 * The generated main.js file lunr search index doesn't set the correct path depending on what file you are in
 * in the docs.  It was always running home to './' prepended to all search index URLs.  Modified
 * so if in the root doc of the website prepends './' otherwise prepends '../' so it works correctly.
 * 
 * Also removed broken IE onscroll code throwing an exception since I modified the theme.
 */
async function correctSearchIndexPathAndRemoveBrokenIeScrollCode() {
	let find = /;p\.href=n\.base\+u\.url/g;
	const replace = `;const iluw = window.location.pathname || '';n.base = iluw.endsWith('/${PATH_FOR_SERVER}/') || ` + 
					`iluw.endsWith('/${PATH_FOR_SERVER}/index.html') || iluw.endsWith('/${PATH_FOR_LOCAL}/') || `+ 
					`iluw.endsWith('/${PATH_FOR_LOCAL}/index.html')  ? './' : '../';p.href=n.base+u.url`;

	let fileData: string = await fs.readFile(MAIN_JS_PATH, 'utf8');
	fileData = fileData.replace(find, replace);

	find = /window\.addEventListener\("scroll",ne\(\(\)=>this\.onScroll\(\),10\)\),/g;
	fileData = fileData.replace(find, '');

	await fs.writeFile(MAIN_JS_PATH, fileData, 'utf8');
}

function onConverterCreateDeclaration(context: Context): void {
	let tag = null;
	for (const reflection of context.project.getReflectionsByKind(ReflectionKind.All)) {
		const { comment } = reflection;
      
		if (comment) {
			if (comment.hasTag('method')) {
				reflection.kind = ReflectionKind.Method;
				reflection.comment.removeTags('method');
			} else if (comment.hasTag('function')) {
				reflection.kind = ReflectionKind.Function;
				reflection.comment.removeTags('function');
			}
		}
	}
}
/**
 * When we categorieze things, get rid of the default name.
 * 
 * So, if we put the category name "Stream Methods" to categorize a class property,
 * typedoc will render that as "Properties Stream Methods".  The code below changes
 * the two headers in the resulting docs to get rid of the default "Properties" name
 * so it reads correctly as just "Stream Methods".
 */
async function postProcess(outDir: string) {
	const options = {
		files: outDir + '/**/*.html',
		from: [/<h3>Properties (\S.+?)<\/h3>/g, /<h2>(.+?\S) Properties<\/h2>/g],
		to: ['<h3>$1<\/h3>', '<h2>$1<\/h2>'],
	};
	await replaceInFile(options);
}

/**
 * @returns The typedoc JSON config read from file
 */
async function getTypedocConfig(): Promise<RstreamsTypedocConfig> {
	const data = await fs.readFile(TYPEDOC_FILE_PATH);
	return JSON.parse(data.toString());
}

async function getAllFiles(dirPath: string, arrayOfFiles: string[]): Promise<string[]>
{
	const files = await fs.readdir(dirPath);
	arrayOfFiles = arrayOfFiles || [];

	for (const file of files) {
		if ((await fs.stat(dirPath + "/" + file)).isDirectory()) {
			arrayOfFiles = await getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			arrayOfFiles.push(path.join(__dirname, dirPath, "/", file));
		}
	}

	return arrayOfFiles;
}

async function moveFiles(sourceFilePaths: string[], destPath: string) {
	sourceFilePaths.forEach(async (filePath) => {
		let fileName = /[^/]*$/.exec(filePath)[0];
		await fs.copyFile(filePath, destPath + '/' + fileName);
	});
}


// const getAllFiles =  function(dirPath, arrayOfFiles) {
//   files = fs.readdirSync(dirPath)

//   arrayOfFiles = arrayOfFiles || []

//   files.forEach(function(file) {
// if (fs.statSync(dirPath + "/" + file).isDirectory()) {
//   arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles)
// } else {
//   arrayOfFiles.push(path.join(__dirname, dirPath, "/", file))
// }
//   })

//   return arrayOfFiles
// }

(async() => {
	try {    
		await buildDocs();
	} catch (ex) {
		console.log(ex);
	}
})();

