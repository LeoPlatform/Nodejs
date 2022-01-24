process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('<PATH TO LEO_CONFIG.JS>')
import { RstreamBatchResult, RStreamsEventItem, RStreamsEventRead } from '../../lib/lib';
import leo from "../../index";

let stream = leo(config.leosdk).streams

const botId = "test-multi-writer-bot-id";

interface LeoPayload {
    working: string
}


/* Sample of using the raw leo streams to do something more custom. */
stream.pipe(
    stream.fromLeo(botId, "test-types-loader-queue"),
    stream.batch(2),
    stream.log("Batched"),
    stream.through(processorFunction),
    stream.log("Processed"),
    stream.load(botId),
    (err: any) => { if (err) { console.log("Handle error") } }
)

/* Function that randomly writes to two different output locations */
function processorFunction(events: RstreamBatchResult<RStreamsEventRead<LeoPayload>>, done: any, push: any) {
    console.log(`Event in here ${JSON.stringify(events)}`)

    let destinationQueue: string;
    let random = Math.random() * 10;

    events.payload.forEach(function (event: RStreamsEventRead<LeoPayload>) {
        if (random > 5) {
            destinationQueue = "ts-types-multi-out-queue-1";
        } else {
            destinationQueue = "ts-types-multi-out-queue-2";
        };
        const newCorrelationId = {
            source: event.event,
            start: event.eid,
            units: 1 //number of units you collapsed from
        };

        let newEvent: RStreamsEventItem<LeoPayload> = {
            id: botId,
            event: destinationQueue,
            payload: event.payload,
            timestamp: Date.now(),
            correlation_id: newCorrelationId,
            event_source_timestamp: Date.now()
        }

        push(newEvent);
    })

    done(null);
}
