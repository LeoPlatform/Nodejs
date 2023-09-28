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
		let obj = {
			__unparsed_value__: input
		};
		this.currentObj = obj;
		this.write(input);
		delete this.currentObj;
		return obj;
	}
	getPath() {
		return (this as unknown as {
			events: {
				node: Node
			}
		}).events.node.getPath();
	}
}


export let parsers: Record<string, (botId: string, queue: string, settings: any) => (input: string) => any> = {
	"JSON.parse": () => JSON.parse,
	"empty": (botId, queue, settings) => (input: string) => {
		return {
			id: "unknown",
			event: queue,
			payload: {}
		};
	},
	"fast-json": (botid, queue, settings: { fields?: FastParseField[], pathSeparator?: string }) => {
		let fastJson = new FastJsonPlus({ pathSeparator: settings.pathSeparator }) as FastJsonEnhanced;
		if (fastJson.parse == null) {
			fastJson.parse = function (value: string) {
				let obj = {
					__unparsed_value__: value
				};
				this.currentObj = obj;
				this.write(value);
				delete this.currentObj;
				return obj;
			};

			fastJson.getPath = function () {
				return this.events.node.getPath();
			};
		}

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

		function set(field, value, suffix = "") {
			let keys = fastJson.getPath();
			let last = keys.pop();
			// TODO: Detect if this is an array and default should be [] instead of {}
			let c = keys.reduce((c, f, i) => c[f] = c[f] || {}, fastJson.currentObj);
			c[last + suffix] = value;
			//fastJson.currentObj[field + suffix] = value;
		}

		function trySetSkip() {
			if (visitedFields == allFields) {
				fastJson.skip();
			}
		}

		allFieldsDefs.forEach(def => {
			allFields++;
			let fieldProcessor = fieldParsers[def.type] || fieldParsers.string;
			let fieldParser = fieldProcessor.parse || fieldParsers.string.parse;
			let fieldSet = fieldProcessor.set || set;
			fastJson.on(def.field, (value) => {
				fieldSet(def.field, fieldParser(value));
				visitedFields++;
				trySetSkip();
			});
		});
		console.log(allFieldsDefs.map(a => a.field));

		return (input) => {
			visitedFields = 0;
			return fastJson.parse(input);
		};
	}
};
