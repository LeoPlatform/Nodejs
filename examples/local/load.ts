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

const EVENTS = 10;

interface LeoPayload {
    working: string
    count: number
}

async function loadEvents() {

    let stream = sdk.load("test-types-loader", "test-types-loader-queue", { useS3: true });

    for (let i = 0; i < EVENTS; i++) {

        let payload: LeoPayload = {
            working: "working",
            count: i
        }

        if (!stream.write(payload)) {
            //drain stream if there's backpressure
            await new Promise((res) => {
                stream.once("drain", res)
            })
        }

    }

    stream.end();
}

loadEvents();