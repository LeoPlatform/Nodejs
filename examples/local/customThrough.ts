process.env.LEO_ENVIRONMENT = "test"
process.env.LEO_LOGGER = "/.*/ei" //TODO document
let config = require('leo-config').bootstrap(require("../config/leo_config"));
import { RstreamBatchResult, RStreamsEventItem } from '../../lib/lib';
import leo from "../../index";

let stream = leo(config.leosdk).streams

const botId = "test-multi-writer-bot-id";

interface LeoPayload {
    working: string
}


/* Sample of using the raw leo streams to do something more custom. */
stream.pipe(
    stream.fromLeo(botId, "bentest-types-loader-queue"),
    stream.batch(2),
    stream.log("Batched"),
    stream.through(processorFunction),
    stream.log("Processed"),
    stream.load(botId),
    (err: any) => { if (err) { console.log("Handle error") } }
)

// stream.enrich(
//     {
//         id: botId, inQueue: "bentest-types-loader-queue", outQueue: "", batch: 2, transform: (payload, event, done) => {

//             //put in processor function

//             done(err, () => {


//             }, { queue: "outgoingQueue" })
//         }
//     }
// )

/* Function that randomly writes to two different output locations */
function processorFunction(events: RstreamBatchResult<RStreamsEventItem<LeoPayload>>, done: any, push: any) {
    console.log(`Event in here ${JSON.stringify(events)}`)

    let destinationQueue: string;
    let random = Math.random() * 10;

    events.payload.forEach(function (event: any) {
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
        //Create new LEO event

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
