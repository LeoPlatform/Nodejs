//TODO: decide if we're going to need this and if not delete it

// How to extend the doc
// https://www.freecodecamp.org/news/a-deep-dive-into-typedocs-workflow-and-extensibility-d464683e092c/
//
// Good help: https://techsparx.com/nodejs/typescript/typedoc.html

import { Application, TSConfigReader, TypeDocReader } from "typedoc";
//import * as config from './typedoc.json';

async function main() {
    const app = new Application();

    // If you want TypeDoc to load tsconfig.json / typedoc.json files
    app.options.addReader(new TSConfigReader());
    app.options.addReader(new TypeDocReader());

    app.bootstrap({
        // typedoc options here

        entryPoints: ["../index.d.ts"],
    });

    const project = app.convert();

    if (project) {
        // Project may not have converted correctly
        const outputDir = "generated";

        // Rendered docs
        await app.generateDocs(project, outputDir);
        // Alternatively generate JSON output
        await app.generateJson(project, outputDir + "/documentation.json");
    }
}

(async() => {
    console.log('1')
    try {    
        await main();
    } catch (ex) {
        console.log(ex);
    }
    console.log('2')
  })()

