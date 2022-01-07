process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('leo-config').bootstrap(require("../config/leo_config"));
import { RStreamsEventItem, RStreamsEventRead } from '../../lib/lib';
import leo from "../../index";

let stream = leo(config.leosdk).streams

const botId = "test-ts-stream-writer-through";

interface LeoPayload {
    working: string
}


/* Sample of using the raw leo streams.  You can also use enrich for something like this */
stream.pipe(
    stream.fromLeo(botId, "bentest-types-loader-queue"),
    stream.through(processorFunction),
    stream.log("Processed"),
    stream.toLeo(botId),
    stream.toCheckpoint(),
    //stream.load(botId, "bentest-types-loader-new-queue"),
    (err: any) => { if (err) { console.log("Handle error") } }
)


function processorFunction(event: RStreamsEventRead<LeoPayload>, done: any) {
    console.log(`Event in ${JSON.stringify(event)}`)

    const newCorrelationId = {
        source: event.event,
        start: event.eid,
        units: 1 //number of units you collapsed from
    };

    const newPayload = {
        working: event.payload.working += "somethingNew"
    }

    const newEvent: RStreamsEventItem<LeoPayload> = {
        id: botId,
        event: "bentest-types-loader-new-queue",
        payload: newPayload,
        timestamp: Date.now(),
        correlation_id: newCorrelationId,
        event_source_timestamp: Date.now()
    }

    done(null, newEvent);
}
