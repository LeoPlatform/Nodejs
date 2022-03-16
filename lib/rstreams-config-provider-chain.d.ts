import { ProvidersInputType } from "./rstreams-config-provider-chain";
import Configuration from "./rstreams-configuration";

export class ConfigProviderChain {
	/**
	 * Creates a new ConfigProviderChain with a default set of providers specified by defaultProviders.
	 */
	constructor(providers?: provider[], addToDefaults?: ProvidersInputType)
	/**
	 * Resolves the provider chain by searching for the first set of configuration in providers.
	 */
	resolve(callback: (err: Error | null, config?: typeof Configuration) => void): ConfigProviderChain;
	/**
	 * Return a Promise on resolve() function
	 */
	resolvePromise(): Promise<typeof Configuration>;
	/**
	 * Returns a list of configuration objects or functions that return configuration objects. If the provider is a function, the function will be executed lazily when the provider needs to be checked for valid credentials. By default, this object will be set to the defaultProviders.
	 */
	providers: Array<typeof Configuration | provider>;

	static defaultProviders: provider[]
}

type provider = () => typeof Configuration;
