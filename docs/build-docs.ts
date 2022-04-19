
// How to extend the doc
// https://www.freecodecamp.org/news/a-deep-dive-into-typedocs-workflow-and-extensibility-d464683e092c/
// Good help: https://techsparx.com/nodejs/typescript/typedoc.html

import { Application, TSConfigReader, TypeDocReader, TypeDocOptions, Converter, Context, ReflectionKind } from "typedoc";
import {replaceInFile} from "replace-in-file";
import * as fs from 'fs/promises';

const TYPEDOC_FILE_PATH = './typedoc.json';

/**
 * Build the typedoc doc website using the config in TYPEDOC_FILE_PATH.
 */
async function buildDocs() {
    const typedocConfig = await getTypedocConfig();
    const app = new Application();

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
async function getTypedocConfig(): Promise<Partial<TypeDocOptions>> {
    const data = await fs.readFile(TYPEDOC_FILE_PATH);
    return JSON.parse(data.toString());
}

(async() => {
    try {    
        await buildDocs();
    } catch (ex) {
        console.log(ex);
    }
})()

