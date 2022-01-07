process.env.LEO_ENVIRONMENT = "sandbox"
let config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));
import { RStreamsEventItem, RStreamsEventRead } from '../../lib/lib';
import leo from "../../index";

let stream = leo(config.leosdk).streams

const botId = "test-ts-stream-writer-through";

interface LeoPayload {
    working: string
}


/* Sample of using the raw leo streams.  You can also use enrich for something like this */
stream.pipe( // pipe between streams and forward errors + deal with clean up
    stream.fromLeo(botId, "test-loader-queue"), // read from the queue test-loader and pass along 
    stream.through(processorFunction), //apply this processor function to each event or batches of events
    stream.log("Processed"),
    stream.load(botId), //load them to a new queue that was set in the processor function
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
        event: "types-loader-new-queue", //set to new queue
        payload: newPayload,
        timestamp: Date.now(),
        correlation_id: newCorrelationId,
        event_source_timestamp: Date.now()
    }

    done(null, newEvent); //callback to pipeline.  This is where you would pass up any errors/deal with any asnc tasks.  
    //In addition you pass back the new event for any further processing as the second paramater of the callback function
}