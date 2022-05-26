import { APIGatewayEventDefaultAuthorizerContext, APIGatewayEventIdentity, APIGatewayEventRequestContext, APIGatewayEventRequestContextWithAuthorizer, APIGatewayProxyEventHeaders, APIGatewayProxyEventMultiValueHeaders, APIGatewayProxyEventMultiValueQueryStringParameters, APIGatewayProxyEventPathParameters, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyEventStageVariables } from "aws-lambda";
import { Processor } from "./processor";
import { ProcessorParameters } from "./types";
import { config } from "./process";

export interface APIGatewayProxyEvent<T, TAuthorizerContext = APIGatewayEventDefaultAuthorizerContext> {
	body: T | null;
	headers: APIGatewayProxyEventHeaders;
	multiValueHeaders: APIGatewayProxyEventMultiValueHeaders;
	httpMethod: string;
	isBase64Encoded: boolean;
	path: string;
	pathParameters: APIGatewayProxyEventPathParameters | null;
	queryStringParameters: APIGatewayProxyEventQueryStringParameters | null;
	multiValueQueryStringParameters: APIGatewayProxyEventMultiValueQueryStringParameters | null;
	stageVariables: APIGatewayProxyEventStageVariables | null;
	requestContext: APIGatewayEventRequestContextWithAuthorizer<TAuthorizerContext>;
	resource: string;
}

interface APIGatewayProxyResult<T> {
	statusCode: number;
	headers?: {
		[header: string]: boolean | number | string;
	} | undefined;
	multiValueHeaders?: {
		[header: string]: Array<boolean | number | string>;
	} | undefined;
	body: string | T;
	isBase64Encoded?: boolean | undefined;
}

type APIGatewayProxyResultOrData<T> = APIGatewayProxyResult<T> | T;

export class ApiProcessor<E extends Record<any, any>, T, S> extends Processor<APIGatewayProxyEvent<E>, APIGatewayProxyResultOrData<T>, S>{

	public static HandlesEvent(event: any): boolean {
		return event && event.httpMethod || event.headers;
	}

	constructor(
		params: ProcessorParameters<APIGatewayProxyEvent<E>, T, S>
	) {
		super(params);
		this.setupUncaughtExceptions();
	}

	public setupUncaughtExceptions() {
		for (let x of process.listeners('uncaughtException')) { //remove lambdas default listener
			process.removeListener('uncaughtException', x);
		}
		process.on('uncaughtException', (err) => {
			console.error((new Date).toUTCString() + ' uncaughtException:', err.message);
			console.error(err.stack);
			this.context.done(null, {
				statusCode: 500,
				'Content-Type': 'application/json',
				body: JSON.stringify("Application Error")
			});
		});
	}

	public override async run(): Promise<APIGatewayProxyResultOrData<T>> {
		try {
			this.inputEvent = this.transformEvent(this.inputEvent);
			let response = await super.run();


			if (response && typeof response === "object" && "statusCode" in response) {
				let data = response as unknown as APIGatewayProxyResult<T>;
				if (config.cors && !("Access-Control-Allow-Origin" in data.headers)) {
					data.headers["Access-Control-Allow-Origin"] = config.cors;
				}
				return data;
			} else {
				let data = response as T;
				return {
					statusCode: 200,
					headers: {
						'Content-Type': config.ContentType || 'application/json',
						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
					},
					body: JSON.stringify(data)
				};
			}

		} catch (err) {
			if (err === "Access Denied" || err === "Error: Access Denied") {
				return {
					statusCode: 403,
					headers: {
						'Content-Type': config.ErrorContentType || 'text/html',
						"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
					},
					body: err.toString()
				};
			} else {
				if (typeof err === "object" && "statusCode" in err) {
					if (config.cors && err.headers && !("Access-Control-Allow-Origin" in err.headers)) {
						err.headers["Access-Control-Allow-Origin"] = config.cors;
					}
					return err;
				} else {
					return {
						statusCode: 500,
						headers: {
							'Content-Type': config.ErrorContentType || 'text/html',
							"Access-Control-Allow-Origin": config.cors ? config.cors : undefined
						},
						body: err.toString()
					};
				}
			}
		}
	}

	transformEvent(inputEvent: unknown): APIGatewayProxyEvent<E> {

		let outEvent: APIGatewayProxyEvent<E | string>;

		if (this.context.identity) {
			// Called Directly not via Api Gateway
			let event = inputEvent as APIGatewayProxyEvent<E>;
			outEvent = {
				body: event.body,
				httpMethod: event.httpMethod,
				queryStringParameters: event.queryStringParameters,
				pathParameters: null,
				multiValueHeaders: null,
				multiValueQueryStringParameters: null,
				isBase64Encoded: false,
				path: "",
				resource: "",
				stageVariables: null,
				headers: {
					Cookie: event.headers && event.headers.Cookie,
				},
				requestContext: {
					requestId: this.context.awsRequestId,
					identity: this.context.identity as APIGatewayEventIdentity
				} as APIGatewayEventRequestContext
			};

		} else {
			outEvent = inputEvent as APIGatewayProxyEvent<E>;
		}


		if (outEvent.isBase64Encoded) {
			outEvent.body = Buffer.from(outEvent.body as string, 'base64').toString();
		}
		if (outEvent.body && typeof outEvent.body !== "object") {
			outEvent.body = JSON.parse(outEvent.body);
		}
		Object.keys(outEvent.pathParameters).map((key) => {
			outEvent.pathParameters[key] = decodeURIComponent(outEvent.pathParameters[key]);
		});
		outEvent.pathParameters = outEvent.pathParameters || {};
		outEvent.queryStringParameters = outEvent.queryStringParameters || {};

		return outEvent as APIGatewayProxyEvent<E>;
	}
}
