process.env.RSTREAMS_CONFIG_SECRET = "rstreams-us-west-2-clint-bus";

import { handler } from "./index";

let botId = "fanout-broker-threads";
handler({
	botId: botId,
	__cron: {
		id: botId,
		name: botId,
		ts: Date.now(),
		ignoreLock: true,
		iid: null,
		//icount: 15,
	}
}, require("../../../lib/mock").createContext({ Timeout: 30 }));
