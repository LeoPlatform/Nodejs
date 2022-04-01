export class Configuration {
	/**
	 * Creates a new Configuration.
	 */
	constructor(config: any)
	/**
	 * Resolves the configuration.
	 */
	resolve(callback: (err: Error | null, config?: Configuration) => void): Configuration;
	/**
	 * Return a Promise on resolve() function
	 */
	resolvePromise(): Promise<Configuration>;
}

