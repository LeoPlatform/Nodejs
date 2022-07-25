import leoConfig from "../../leoConfigure";

export interface RStreamsProcess extends NodeJS.Process {
	__config: Record<string, any>;
	resources: Record<any, unknown>;
}

const rstreamsProcess = process as unknown as RStreamsProcess;

if (rstreamsProcess.__config == null) {
	rstreamsProcess.__config = leoConfig;
	rstreamsProcess.env.TZ = leoConfig.timezone;
	rstreamsProcess.resources = process.env.Resources && JSON.parse(process.env.Resources) || {};
}

export const config = rstreamsProcess.__config;
export const registry = rstreamsProcess.__config.registry;
export const resources = rstreamsProcess.resources;
export default rstreamsProcess;
