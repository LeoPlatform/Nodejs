## Examples to help you get up to speed

There are examples using typescript to help you get up to speed located under the [local](local/) directory.  You will find examples using the `load, offload, put, and enrich` helper functions.  You will also find examples of doing more custom operations utilizing `node-streams` and RStream operations.  Have an understanding of [node-streams](https://nodejs.org/api/stream.html) will help you understand what's happening along the way.  Note, because you are using Rstreams, it will create the "queues/bot_ids" in botmon for you.  These are just logical resources created so you can see the data flow in botmon.  This is noted because it usually throws off people with AWS experience that are expecting to create a queue before writing to it.

### Creating the ts client

    1) Create a configuration file for the bus you want to do
    2) Set the LEO_ENVIRONMENT environmental variable to the environent you want wherever you are running your leo processing.  More leo environment setup [info](https://chb.atlassian.net/wiki/spaces/DSCO/pages/98324775822/Rstreams+config)  
    3) Bootstrap the config with this line 
    ```javascript
        const config = require('leo-config').bootstrap(require("<PATH TO LEO_CONFIG.JS>"));
    ```
    4) Create the sdk
    ```javascript
        import leo from "leo-sdk"
        const sdk = leo(config.leosdk);
    ```


SDK Type definitions [here](../index.d.ts)

### RStreams

    Ocassionally you will need to access the leo-streams interface if you have a more complicated workflow that the basic `load, offload, and enrich` functions don't support, for this you can access the leo-streams like this
    
       ```javascript
        import leo from "leo-sdk"
        const streams = leo(config.leosdk).streams;
    ```

    * Note you still need to boostrap the config

    For a commented example see [this](local/customThrough.ts)