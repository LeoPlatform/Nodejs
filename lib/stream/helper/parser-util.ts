/* eslint-disable @typescript-eslint/ban-ts-comment */
import { FastJson } from "fast-json";
import { Node } from "fast-json/dist/Node";

export interface FastJsonEvent {
	__unparsed_value__: string;
}
export enum FastParseType {
	Number = "number",
	String = "string",
	Eid = "eid",
	Raw = "raw",
	Json = "json",
	Array = "array",
	Object = "object",
}
export interface FastParseField {
	field: string;
	type?: FastParseType
}

export interface FastJsonEnhanced extends FastJson {
	parse: (input: string) => any;
	getPath: () => string[];
	currentObj: any;
}

// Overriding a private function to add isString feature.
//@ts-ignore
export class FastJsonPlus extends FastJson implements FastJsonEnhanced {

	currentObj: any;
	isLastPrimitiveAString: boolean = false;
	parse(input: string) {
		// Create an object for parsing
		let obj = {
			__unparsed_value__: input
		};
		this.currentObj = obj;

		// Write the current input
		this.write(input);

		// remove the current object and return
		delete this.currentObj;
		return obj;
	}
	getPath() {
		// Some fields are private so we have to fake access to them
		const fastJson = (this as unknown as {
			stack: {
				key: string
			}[]
			events: {
				node: Node
			},
			currentObj: {
				__unparsed_value__: string
			};
			getKey: (data: string) => string;
		});
		return fastJson.events.node.getPath().map((f, i) => {
			// Get the real field name for wildcards
			if (f == "*") {
				if (fastJson.stack.length > i + 1) {
					// If it is in the stack we can use the stack key
					f = fastJson.stack[i + 1].key;
				}
				else {
					// If it isn't in the stack we use the latest key
					f = fastJson.getKey(fastJson.currentObj.__unparsed_value__);
				}
			}
			return f;
		});
	}

	// Override private function to determine if the last permitive is a string or not
	emitPrimitiveOrString(data, start, end) {
		this.isLastPrimitiveAString = data[start - 1] == '"' && data[end] == '"';
		// @ts-ignore
		return super.emitPrimitiveOrString(data, start, end);
	}
}

export enum ParserName {
	JsonParse = "JSON.parse",
	Empty = "empty",
	FastJson = "fast-json",
}

export let fieldParsers: Record<FastParseType, {
	parse?: (value: string | Buffer) => any,
	set?: (
		field: string,
		value: any,
		setFn: (field: string, value: any, suffix?: string) => void
	) => void
}> = {
	[FastParseType.String]: { parse: (value) => value },
	[FastParseType.Number]: { parse: (value) => Number(value) },
	[FastParseType.Eid]: { parse: (value) => value.toString().startsWith("z/") ? value : parseInt(value.toString(), 10) },
	[FastParseType.Raw]: { set: (field, value, setFn) => setFn(field, value, "_raw") },

	// These are handled the same way.  Just JSON strings to parse
	[FastParseType.Json]: { parse: (value) => JSON.parse(value.toString()) },
	[FastParseType.Array]: { parse: (value) => JSON.parse(value.toString()) },
	[FastParseType.Object]: { parse: (value) => JSON.parse(value.toString()) },
};

// Factory of parsers so that they can be created with any config needed
export let parsers: Record<ParserName, (settings: any) => (input: string) => any> = {
	[ParserName.JsonParse]: () => JSON.parse,
	[ParserName.Empty]: () => (input: string) => {
		return {
			id: "unknown",
			payload: {}
		};
	},
	[ParserName.FastJson]: (settings: {
		fields?: FastParseField[], pathSeparator?: string
	}) => {
		let fastJson = new FastJsonPlus({ pathSeparator: settings.pathSeparator });

		let allFields = 0;
		let visitedFields = 0;

		let wrapperFieldsDefs: FastParseField[] = [{
			field: "id"
		}, {
			field: "event"
		},
		// {
		// 	field: "eid",
		// 	type: FastParseType.Eid
		// },
		{
			field: "event_source_timestamp",
			type: FastParseType.Number
		},
			// {
			// 	field: "timestamp",
			// 	type: FastParseType.Number
			// },
			// {
			// 	field: "correlation_id",
			// 	type: FastParseType.Raw
			// },
			// {
			// 	field: "payload",
			// 	type: FastParseType.Raw
			// }
		];

		/**
		 * Example from payload
		 * 	{
		 * 		field: "payload.new.supplier_id",
		 * 		type: FastParseType.Number
		 * 	}
		 */
		let allFieldsDefs = wrapperFieldsDefs.concat(settings.fields ?? []);

		const ARRAY_TYPE = 1;
		function set(field, value, suffix = "") {
			let keys = fastJson.getPath();
			let last = keys.pop();
			// Detect if this is an array and use [] instead of {}
			let c = keys.reduce((c, f, i) => c[f] = c[f] || ((fastJson as any).stack[i + 1].type == ARRAY_TYPE ? [] : {}), fastJson.currentObj);
			if (Array.isArray(c)) {
				c[parseInt(last, 10)] = value;
			} else {
				c[last + suffix] = value;
			}
		}

		let allowSkip = true;
		function trySetSkip() {
			if (allowSkip && visitedFields == allFields) {
				fastJson.skip();
			}
		}

		let defaultFieldSet = ((a, b) => set(a, b));

		allFieldsDefs.forEach(def => {
			allFields++;
			let fieldProcessor = fieldParsers[def.type] || fieldParsers.string;
			let fieldParser = fieldProcessor.parse || fieldParsers.string.parse;
			let fieldSet = fieldProcessor.set || defaultFieldSet;

			// If wildcards are used we can't determine if all fields were visited
			// so disable skipping
			if (def.field.includes("*")) {
				allowSkip = false;
			}
			fastJson.on(def.field, (value) => {
				// If the value is string null then use JS null
				if (value == "null" && !fastJson.isLastPrimitiveAString) {
					fieldSet(def.field, null, set);
				} else {
					fieldSet(def.field, fieldParser(value), set);
				}
				visitedFields++;
				trySetSkip();
			});
		});
		//console.log(allFieldsDefs.map(a => a.field));

		return (input) => {
			visitedFields = 0;
			return fastJson.parse(input);
		};
	}
};


type ParseFunction<T> = (data: string) => T;

interface CreateParserParams<R, T> {
	parser: string | ParseFunction<R>;
	opts: T & { botId?: string, queue?: string };

}
// Require function that is run outside of webpack
declare var __webpack_require__;
declare var __non_webpack_require__;
const requireFn = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

// Create a parser and handle eid commands
// Eid Commands are needed when merging multiple records
// LeoStream records together as they have different starting eids
export function createParser<R = any, T = any>(params: CreateParserParams<R, T>) {
	let JSONparseInner: (val: string) => any;

	if (typeof params.parser === "string") {

		let parseFn: ((...args: any[]) => (input: string) => any) = parsers[params.parser];
		if (parseFn == null) {
			//console.log("PARSER:", params.parser);
			// If it isn't one of the default parsers
			// it should be an external module that we can require
			// with a function to call to get the parser
			parseFn = requireFn(params.parser);
			if (typeof parseFn !== "function") {
				let lib = parseFn as any;
				parseFn = lib.default;
				if (typeof parseFn !== "function") {
					parseFn = (parseFn as any).parser;
				}
			}
			parseFn = parseFn || parsers[ParserName.JsonParse];
		}
		//console.log("PARSER context:", parseFn.toString());
		// Create the inner parser and pass in the parser options
		if (parseFn.length == 1) {
			JSONparseInner = (parseFn)(params.opts);
		} else {
			JSONparseInner = (parseFn)(params.opts.botId, params.opts.queue, params.opts);
		}
	} else {
		JSONparseInner = params.parser;
	}

	JSONparseInner = JSONparseInner || JSON.parse;
	return (str) => {
		if (str.startsWith("__cmd:eid__")) {
			let cmd = JSON.parse(str.replace("__cmd:eid__", ""));
			cmd._cmd = "setBaseEid";
			return cmd;
		}
		let r = JSONparseInner(str);

		// Add size in bytes if it doesn't exist
		if (r != null && r.size == null) {
			r.size = Buffer.byteLength(str);
		}
		return r;
	};
}
