import { expect, assert } from "chai";
import { 
	FastParseType, 
	fieldParsers, 
	parsers, 
	ParserName, 
	createParser,
	FastJsonPlus
} from "../lib/stream/helper/parser-util";

describe('lib/stream/helper/parser-util.ts', function () {

	describe("FastParseType enum", function () {
		it('should have Number type', function () {
			expect(FastParseType.Number).to.equal('number');
		});

		it('should have String type', function () {
			expect(FastParseType.String).to.equal('string');
		});

		it('should have IfString type', function () {
			expect(FastParseType.IfString).to.equal('ifstring');
		});

		it('should have Eid type', function () {
			expect(FastParseType.Eid).to.equal('eid');
		});

		it('should have Raw type', function () {
			expect(FastParseType.Raw).to.equal('raw');
		});

		it('should have Json type', function () {
			expect(FastParseType.Json).to.equal('json');
		});

		it('should have Array type', function () {
			expect(FastParseType.Array).to.equal('array');
		});

		it('should have Object type', function () {
			expect(FastParseType.Object).to.equal('object');
		});
	});

	describe("ParserName enum", function () {
		it('should have JsonParse', function () {
			expect(ParserName.JsonParse).to.equal('JSON.parse');
		});

		it('should have Empty', function () {
			expect(ParserName.Empty).to.equal('empty');
		});

		it('should have FastJson', function () {
			expect(ParserName.FastJson).to.equal('fast-json');
		});
	});

	describe("fieldParsers", function () {
		describe("String parser", function () {
			it('should return value as-is', function () {
				const result = fieldParsers[FastParseType.String].parse!('test');
				expect(result).to.equal('test');
			});
		});

		describe("Number parser", function () {
			it('should convert string to number', function () {
				const result = fieldParsers[FastParseType.Number].parse!('42');
				expect(result).to.equal(42);
			});

			it('should handle decimal numbers', function () {
				const result = fieldParsers[FastParseType.Number].parse!('3.14');
				expect(result).to.equal(3.14);
			});

			it('should return NaN for invalid numbers', function () {
				const result = fieldParsers[FastParseType.Number].parse!('not a number');
				expect(result).to.be.NaN;
			});
		});

		describe("Eid parser", function () {
			it('should parse integer eid', function () {
				const result = fieldParsers[FastParseType.Eid].parse!('12345');
				expect(result).to.equal(12345);
			});

			it('should keep z/ prefixed eids as strings', function () {
				const result = fieldParsers[FastParseType.Eid].parse!('z/2024/01/01/12/00');
				expect(result).to.equal('z/2024/01/01/12/00');
			});
		});

		describe("Json parser", function () {
			it('should parse JSON string', function () {
				const result = fieldParsers[FastParseType.Json].parse!('{"key":"value"}');
				expect(result).to.deep.equal({ key: 'value' });
			});

			it('should parse JSON array', function () {
				const result = fieldParsers[FastParseType.Json].parse!('[1,2,3]');
				expect(result).to.deep.equal([1, 2, 3]);
			});
		});

		describe("Array parser", function () {
			it('should parse JSON array', function () {
				const result = fieldParsers[FastParseType.Array].parse!('[1,"two",3]');
				expect(result).to.deep.equal([1, 'two', 3]);
			});
		});

		describe("Object parser", function () {
			it('should parse JSON object', function () {
				const result = fieldParsers[FastParseType.Object].parse!('{"nested":{"a":1}}');
				expect(result).to.deep.equal({ nested: { a: 1 } });
			});
		});

		describe("IfString parser", function () {
			it('should call setFn for actual strings', function () {
				let setCalled = false;
				let setArgs: any[] = [];
				const setFn = (field, value) => {
					setCalled = true;
					setArgs = [field, value];
				};
				fieldParsers[FastParseType.IfString].set!('field', 'actual string', setFn);
				expect(setCalled).to.be.true;
				expect(setArgs).to.deep.equal(['field', 'actual string']);
			});

			it('should not call setFn for JSON-like strings starting with {', function () {
				let setCalled = false;
				const setFn = () => { setCalled = true; };
				fieldParsers[FastParseType.IfString].set!('field', '{"key":"value"}', setFn);
				expect(setCalled).to.be.false;
			});

			it('should not call setFn for JSON-like strings starting with [', function () {
				let setCalled = false;
				const setFn = () => { setCalled = true; };
				fieldParsers[FastParseType.IfString].set!('field', '[1,2,3]', setFn);
				expect(setCalled).to.be.false;
			});
		});

		describe("Raw parser", function () {
			it('should call setFn with _raw suffix', function () {
				let setArgs: any[] = [];
				const setFn = (field, value, suffix) => {
					setArgs = [field, value, suffix];
				};
				fieldParsers[FastParseType.Raw].set!('field', 'value', setFn);
				expect(setArgs).to.deep.equal(['field', 'value', '_raw']);
			});
		});
	});

	describe("parsers", function () {
		describe("JSON.parse parser", function () {
			it('should return JSON.parse function', function () {
				const parser = parsers[ParserName.JsonParse]({});
				const result = parser('{"test":true}');
				expect(result).to.deep.equal({ test: true });
			});
		});

		describe("empty parser", function () {
			it('should return default object with id and payload', function () {
				const parser = parsers[ParserName.Empty]({});
				const result = parser('anything');
				expect(result).to.deep.equal({ id: 'unknown', payload: {} });
			});
		});

		describe("fast-json parser", function () {
			it('should parse JSON with __unparsed_value__', function () {
				const parser = parsers[ParserName.FastJson]({ fields: [] });
				const result = parser('{"id":"test"}');
				expect(result.__unparsed_value__).to.equal('{"id":"test"}');
			});

			it('should extract id field', function () {
				const parser = parsers[ParserName.FastJson]({ fields: [] });
				const result = parser('{"id":"my-id","event":"test"}');
				expect(result.id).to.equal('my-id');
			});

			it('should extract event field', function () {
				const parser = parsers[ParserName.FastJson]({ fields: [] });
				const result = parser('{"id":"1","event":"my-event"}');
				expect(result.event).to.equal('my-event');
			});

			it('should extract event_source_timestamp as number', function () {
				const parser = parsers[ParserName.FastJson]({ fields: [] });
				const result = parser('{"id":"1","event_source_timestamp":1234567890}');
				expect(result.event_source_timestamp).to.equal(1234567890);
			});

			it('should extract custom fields', function () {
				const parser = parsers[ParserName.FastJson]({ 
					fields: [{ field: 'payload.name' }]
				});
				const result = parser('{"id":"1","payload":{"name":"test"}}');
				expect(result.payload.name).to.equal('test');
			});

			it('should extract custom fields with number type', function () {
				const parser = parsers[ParserName.FastJson]({ 
					fields: [{ field: 'payload.count', type: FastParseType.Number }]
				});
				const result = parser('{"id":"1","payload":{"count":"42"}}');
				expect(result.payload.count).to.equal(42);
			});
		});
	});

	describe("createParser", function () {
		it('should create parser using JSON.parse', function () {
			const parser = createParser({ 
				parser: ParserName.JsonParse, 
				opts: {} 
			});
			const result = parser('{"test":"value"}');
			expect(result.test).to.equal('value');
		});

		it('should handle eid commands', function () {
			const parser = createParser({ 
				parser: ParserName.JsonParse, 
				opts: {} 
			});
			const result = parser('__cmd:eid__{"eid":"z/2024/01/01"}');
			expect(result._cmd).to.equal('setBaseEid');
			expect(result.eid).to.equal('z/2024/01/01');
		});

		it('should add size property to result', function () {
			const parser = createParser({ 
				parser: ParserName.JsonParse, 
				opts: {} 
			});
			const input = '{"id":"test"}';
			const result = parser(input);
			expect(result.size).to.equal(Buffer.byteLength(input));
		});

		it('should not override existing size property', function () {
			const parser = createParser({ 
				parser: ParserName.JsonParse, 
				opts: {} 
			});
			const result = parser('{"id":"test","size":100}');
			expect(result.size).to.equal(100);
		});

		it('should use custom parser function', function () {
			const customParser = (str: string) => ({ custom: true, data: str });
			const parser = createParser({ 
				parser: customParser, 
				opts: {} 
			});
			const result = parser('test input');
			expect(result.custom).to.be.true;
		});

		it('should create empty parser', function () {
			const parser = createParser({ 
				parser: ParserName.Empty, 
				opts: {} 
			});
			const result = parser('anything');
			expect(result.id).to.equal('unknown');
			expect(result.payload).to.deep.equal({});
		});

		it('should create fast-json parser with opts', function () {
			const parser = createParser({ 
				parser: ParserName.FastJson, 
				opts: { fields: [] } 
			});
			const result = parser('{"id":"test","event":"test-event"}');
			expect(result.id).to.equal('test');
		});
	});

	describe("FastJsonPlus", function () {
		it('should parse JSON and store in __unparsed_value__', function () {
			const parser = new FastJsonPlus();
			const input = '{"test":"value"}';
			const result = parser.parse(input);
			expect(result.__unparsed_value__).to.equal(input);
		});

		it('should have isLastPrimitiveAString property', function () {
			const parser = new FastJsonPlus();
			expect(parser.isLastPrimitiveAString).to.be.false;
		});
	});
});
