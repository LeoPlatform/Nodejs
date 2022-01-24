const leosdk = {
    Region: "",
    LeoStream: "",
    LeoCron: "",
    LeoEvent: "",
    LeoS3: "",
    LeoKinesisStream: "",
    LeoFirehoseStream: "",
    LeoSettings: ""
}
import leo from "../../index"

let sdk = leo(leosdk);

interface LeoPayload {
    working: string
}

function enricher() {
    sdk.enrich({
        id: "test-ts-types-leo-enricher",
        inQueue: "test-2-ts-types-leo-queue",
        outQueue: "enriched-test-2-ts-types-leo-queue",
        transform: (payload, event) => {
            return transformer(payload, event);
        },
    }, (err) => { if (err) { console.log("Handle error") } })
}

function transformer(payload: LeoPayload, event: any): any {
    console.log(`Received Payloads\n\t${JSON.stringify(payload)}`);
    console.log(`Received Event\n\t${JSON.stringify(event)}`);
    payload.working = "Enriched"
    return payload;
}

enricher();