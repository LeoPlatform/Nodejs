import { FastJson } from "fast-json";
import { Node } from "fast-json/dist/Node";

export enum FastParseType {
	Number = "number",
	String = "string",
	Eid = "eid",
	Raw = "raw"
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

export class FastJsonPlus extends FastJson implements FastJsonEnhanced {

	currentObj: any;
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
}

export enum ParserName {
	JsonParse = "JSON.parse",
	Empty = "empty",
	FastJson = "fast-json",
}

// Factory of parsers so that they can be created with any config needed
export let parsers: Record<ParserName, (botId: string, queue: string, settings: any) => (input: string) => any> = {
	[ParserName.JsonParse]: () => JSON.parse,
	[ParserName.Empty]: (botId, queue, settings) => (input: string) => {
		return {
			id: "unknown",
			event: queue,
			payload: {}
		};
	},
	[ParserName.FastJson]: (botid, queue, settings: { fields?: FastParseField[], pathSeparator?: string }) => {
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

		let fieldParsers: Record<FastParseType, { parse?: (value: string | Buffer) => any, set?: (field: string, value: any) => void }> = {
			[FastParseType.String]: { parse: (value) => value },
			[FastParseType.Number]: { parse: (value) => parseInt(value.toString(), 10) },
			[FastParseType.Eid]: { parse: (value) => value.toString().startsWith("z/") ? value : parseInt(value.toString(), 10) },
			[FastParseType.Raw]: { set: (field, value) => set(field, value, "_raw") }
		};

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
			// TODO: disable skip if using a wildcard '*' field
			if (allowSkip && visitedFields == allFields) {
				fastJson.skip();
			}
		}

		allFieldsDefs.forEach(def => {
			allFields++;
			let fieldProcessor = fieldParsers[def.type] || fieldParsers.string;
			let fieldParser = fieldProcessor.parse || fieldParsers.string.parse;
			let fieldSet = fieldProcessor.set || set;

			// If wildcards are used we can't determine if all fields were visited
			// so disable skipping
			if (def.field.includes("*")) {
				allowSkip = false;
			}
			fastJson.on(def.field, (value) => {
				fieldSet(def.field, fieldParser(value));
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
