import leoConfig from "../../leoConfigure";

export interface RStreamsProcess extends NodeJS.Process {
	__config: unknown;
	resources: Record<any, unknown>;
}

const rstreamsProcess = process as unknown as RStreamsProcess;

if (rstreamsProcess.__config == null) {
	rstreamsProcess.__config = leoConfig;
	rstreamsProcess.env.TZ = leoConfig.timezone;
	rstreamsProcess.resources = process.env.Resources && JSON.parse(process.env.Resources) || {};
}

export const config = leoConfig;
export const registry = leoConfig.registry;
export const resources = rstreamsProcess.resources;
export default rstreamsProcess;
