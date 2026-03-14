# RStreams SDK Mock (`mock-sdk`)

A framework-agnostic mock for the RStreams SDK designed for unit testing. Works with Jest, Mocha, Vitest, or any test runner.

## How It Works with Bot Handlers

RStreams bots are typically deployed using a wrapper (e.g., `wrappers/cron.js`) that handles the Lambda lifecycle: locking, invoking your handler, checkpointing, and reporting completion. That wrapper creates its own internal SDK instance which cannot be swapped out.

**This mock is designed to test your bot handler function directly, bypassing the wrapper.** Don't test the wrapper — it's framework plumbing. Test your `botHandler` function, which is where your business logic lives.

The only thing you need is a way to get the mock SDK into your handler. Two options:

### Option A: The `mockable()` Pattern

If your codebase has a `mockable()` utility, this is the cleanest approach. The handler keeps its normal `(settings, context, callback)` signature and gets the SDK through a swappable getter:

```typescript
// handler.ts
import { RStreamsSdk, RSFQueueBotInvocationEvent } from "leo-sdk";
import { Callback, Context } from "aws-lambda";
import { mockable } from "../../lib/mockable";

const leoInstance = new RStreamsSdk();

export const getLeo = mockable(_getLeo);
function _getLeo() { return leoInstance; }

export const botHandler = async (
  settings: RSFQueueBotInvocationEvent,
  context: Context,
  callback: Callback
) => {
  const leo = getLeo();

  leo.enrich(
    {
      id: settings.botId,
      inQueue: settings.queue,
      outQueue: "enriched-orders",
      transform(payload, event, done) {
        done(null, { ...payload, processed: true });
      },
    },
    (err) => {
      if (err) return callback(err);
      callback();
    }
  );
};

export const handler = require("leo-sdk/wrappers/cron")(botHandler);
```

```typescript
// handler.test.ts
import { RStreamsSdk } from "leo-sdk";
import { mockRStreamsSdk, createContext, createBotInvocationEvent } from "leo-sdk/lib/mock-sdk";
import { getLeo, botHandler } from "../handler";

describe("my bot", () => {
  let sdk;

  beforeEach(() => {
    sdk = mockRStreamsSdk(new RStreamsSdk());
    getLeo.override(() => sdk);
  });

  afterEach(() => {
    getLeo.clear();
    sdk.mock.reset();
  });

  it("enriches orders", (done) => {
    sdk.mock.queues["raw-orders"] = [
      { orderId: "A", subtotal: 100 },
    ];

    const event = createBotInvocationEvent("test-bot", {
      queue: "raw-orders",
      botNumber: 0,
    });

    botHandler(event, createContext(), (err) => {
      assert.isNull(err);
      assert.equal(sdk.mock.written["enriched-orders"].payloads.length, 1);
      done();
    });
  });
});
```

### Option B: Pass the SDK as the First Argument

If you don't have `mockable()`, put the SDK as the first parameter of your handler and give the cron wrapper a thin shim:

```typescript
// handler.ts
const leoInstance = new RStreamsSdk();

export async function botHandler(
  leo: RStreamsSdk,
  settings: RSFQueueBotInvocationEvent,
  context: Context,
) {
  await leo.enrichEvents({ ... });
}

// Thin shim — the wrapper sees a normal 2-arg async handler
export const handler = require("leo-sdk/wrappers/cron")(
  async (event, context) => {
    return botHandler(leoInstance, event, context);
  }
);
```

```typescript
// handler.test.ts
it("enriches orders", async () => {
  sdk.mock.queues["raw-orders"] = [{ orderId: "A" }];

  const event = createBotInvocationEvent("test-bot", {
    queue: "raw-orders",
    botNumber: 0,
  });

  await botHandler(sdk, event, createContext());

  assert.equal(sdk.mock.written["enriched-orders"].payloads.length, 1);
});
```

The shim is what the cron wrapper sees, so its `handler.length` check works normally. Your testable `botHandler` has a clean signature that takes the SDK explicitly.

**Key principle:** Don't test the wrapper. Test your handler. Make the SDK reachable via either a `mockable()` getter (preferred) or by accepting it as the first parameter with a shim for the wrapper.

---

## Quick Start

```typescript
import { RStreamsSdk } from "leo-sdk";
import { mockRStreamsSdk } from "leo-sdk/lib/mock-sdk";

const sdk = mockRStreamsSdk(new RStreamsSdk());

sdk.mock.queues["my-input-queue"] = [
  { orderId: "123", amount: 10 },
  { orderId: "456", amount: 20 },
];

// Call your handler with the mock SDK...
// Then assert on what was written, checkpointed, etc.
```

## API Reference

### `mockRStreamsSdk(sdk: RStreamsSdk, opts?): MockRStreamsSdk`

Takes an `RStreamsSdk` instance and returns a new object that extends it with a `.mock` control surface. The original SDK is **not** mutated.

All real streaming utilities (`through`, `throughAsync`, `pipeline`, `pipeAsync`, `devnull`, `parse`, `stringify`, `batch`, `eventstream`, etc.) are preserved and work normally. Only bus-connected operations are intercepted.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disableS3` | `boolean` | `true` | Strip `useS3` from all write options passed to `enrich`, `offload`, `load`, and `toLeo`. Prevents any code path from attempting real S3 operations during tests. Set to `false` if you explicitly want to test S3-related code paths. |

### `mock.queues`

**Type:** `Record<string, any[]>`

Configure what events each queue returns when `sdk.read()` / `sdk.streams.fromLeo()` is called.

Values can be:
- **Raw payloads** — auto-wrapped into `ReadEvent` objects with generated `eid`, `event`, `id`, and `timestamp` fields
- **Full `ReadEvent` objects** — passed through as-is (detected by having both `eid` and `payload` properties)

```typescript
// Raw payloads (simplest)
sdk.mock.queues["orders"] = [
  { orderId: "A", total: 100 },
  { orderId: "B", total: 200 },
];

// Full ReadEvent objects (when you need control over eid, timestamps, etc.)
sdk.mock.queues["orders"] = [
  {
    id: "my-bot",
    event: "orders",
    eid: "z/2025/01/15/00/00/1705276800000-0000000",
    timestamp: 1705276800000,
    event_source_timestamp: 1705276800000,
    payload: { orderId: "A", total: 100 },
  },
];
```

Queues not configured in `mock.queues` return an empty stream (zero events).

### `mock.written`

**Type:** `Record<string, QueueWriteCapture>`

Access events captured by `sdk.write()` / `sdk.streams.toLeo()` / `sdk.streams.load()` / `sdk.put()` / `sdk.putEvent()` / `sdk.putEvents()`.

Auto-populated as events flow through write streams. Key is the queue name.

```typescript
interface QueueWriteCapture<T = any> {
  events: Event<T>[];   // Full event objects
  payloads: T[];        // Just the payloads (convenience)
}
```

```typescript
// After running your pipeline...
const written = sdk.mock.written["output-queue"];
assert.equal(written.events.length, 2);
assert.deepEqual(written.payloads, [
  { orderId: "A", enriched: true },
  { orderId: "B", enriched: true },
]);
```

### `mock.checkpoints`

**Type:** `MockCheckpointControl`

```typescript
interface MockCheckpointControl {
  calls: SpyCall[];           // bot.checkpoint() calls
  toCheckpointCalls: SpyCall[]; // streams.toCheckpoint() creation calls
}
```

`toCheckpoint()` returns a real `devnull` stream so pipelines work normally, but the call is recorded.

### `mock.bot`

**Type:** `MockBotControl`

Every bot/cron method is replaced with a spy that records calls and immediately invokes callbacks with success.

```typescript
interface MockBotControl {
  checkLock: SpyFn;
  reportComplete: SpyFn;
  createLock: SpyFn;
  removeLock: SpyFn;
  checkpoint: SpyFn;
  getCheckpoint: SpyFn & { returnValue: Record<string, any> };
}
```

**Configuring `getCheckpoint` return values:**

```typescript
sdk.mock.bot.getCheckpoint.returnValue["my-queue"] = {
  checkpoint: "z/2025/01/15/00/00/1705276800000",
  records: 500,
};

const cp = await sdk.bot.getCheckpoint("my-bot", "my-queue");
// cp === { checkpoint: "z/2025/01/15/00/00/1705276800000", records: 500 }
```

### `mock.stats`

**Type:** `Partial<Checkpoint> | null`

Override the stats returned by the read stream's `.get()` method and the stats stream.

```typescript
sdk.mock.stats = {
  checkpoint: "z/2025/01/01/00/00/custom",
  records: 999,
  source_timestamp: 1700000000000,
};
```

Set to `null` to use auto-computed stats (the default).

### `mock.reset()`

Clears all state: queue configurations, captured writes, call records, stats override, and all spy histories.

Call this in your test `beforeEach` / `afterEach` to ensure test isolation.

### `mock.readSpy` / `mock.writeSpy` / `mock.loadSpy`

**Type:** `SpyFn`

Spies on `fromLeo` / `toLeo` / `load` calls. Useful to assert which bot ID, queue name, or config was used.

```typescript
sdk.streams.fromLeo("my-bot", "my-queue", { limit: 100 });

assert.equal(sdk.mock.readSpy.callCount, 1);
assert.equal(sdk.mock.readSpy.lastCall.args[0], "my-bot");
assert.equal(sdk.mock.readSpy.lastCall.args[1], "my-queue");
assert.deepEqual(sdk.mock.readSpy.lastCall.args[2], { limit: 100 });
```

### `mock.s3`

**Type:** `MockS3Control`

Mocks for `streams.toS3` and `streams.fromS3`.

```typescript
interface MockS3Control {
  written: Record<string, any[]>;    // Captured writes, keyed by "Bucket/File"
  files: Record<string, Buffer | string>; // Configure data for fromS3, keyed by "bucket/key"
  toS3Spy: SpyFn;
  fromS3Spy: SpyFn;
}
```

**Writing to S3 (capture):**

`streams.toS3(Bucket, File)` returns a real writable stream that captures data to `mock.s3.written["Bucket/File"]`.

**Reading from S3 (configure):**

```typescript
sdk.mock.s3.files["my-bucket/path/to/file.json"] = '{"hello":"world"}';
const stream = sdk.streams.fromS3({ bucket: "my-bucket", key: "path/to/file.json" });
```

If the key is not configured, `fromS3` throws a `NoSuchKey` error (matching real S3 behavior).

### `createContext(config?)`

```typescript
import { createContext } from "leo-sdk/lib/mock-sdk";
```

Creates a fake Lambda `Context` object with a working `getRemainingTimeInMillis()`. Useful when calling bot handlers directly in tests.

```typescript
const context = createContext({ Timeout: 60 }); // 60 seconds
context.awsRequestId;            // "requestid-mock-1234567890"
context.getRemainingTimeInMillis(); // ~60000 (counts down from creation time)
```

`Timeout` is in seconds (default 300).

### `createBotInvocationEvent(botId, settings?)`

```typescript
import { createBotInvocationEvent } from "leo-sdk/lib/mock-sdk";
```

Creates a fake `BotInvocationEvent` with `__cron` pre-configured for testing (`force: true`, `ignoreLock: true`).

```typescript
const event = createBotInvocationEvent("my-bot", {
  queue: "input-queue",
  botNumber: 0,
});
// event.botId === "my-bot"
// event.__cron.id === "my-bot"
// event.__cron.force === true
// event.queue === "input-queue"
```

### `SpyFn` Interface

Every spy exposes:

| Property | Type | Description |
|----------|------|-------------|
| `calls` | `SpyCall[]` | All recorded calls with `{ args, timestamp }` |
| `callCount` | `number` | Number of times called |
| `called` | `boolean` | Whether called at least once |
| `lastCall` | `SpyCall \| undefined` | Most recent call |
| `reset()` | `() => void` | Clear this spy's call history |

---

## Recipes

### Testing an Enrich Bot (Callback Style)

This matches the most common real-world pattern: `leo.enrich(opts, callback)`.

```typescript
// handler.ts
import { RStreamsSdk, RSFQueueBotInvocationEvent } from "leo-sdk";
import { Callback, Context } from "aws-lambda";

const leoInstance = new RStreamsSdk();
export const getLeo = () => leoInstance; // make swappable

export const botHandler = async (
  settings: RSFQueueBotInvocationEvent,
  context: Context,
  callback: Callback
) => {
  const leo = getLeo();

  leo.enrich(
    {
      id: settings.botId,
      inQueue: settings.queue,
      outQueue: "enriched-items",
      useS3: true,
      config: {
        stopTime: Date.now() + context.getRemainingTimeInMillis() * 0.8,
        fast_s3_read: true,
      },
      transform(payload, event, done) {
        if (!payload.active) return done(); // filter out
        done(null, { ...payload, enriched: true });
      },
    },
    (err) => {
      if (err) return callback(err);
      callback();
    }
  );
};

export const handler = require("leo-sdk/wrappers/cron")(botHandler);
```

```typescript
// handler.test.ts
import { mockRStreamsSdk, createContext, createBotInvocationEvent } from "leo-sdk/lib/mock-sdk";
import * as mod from "../handler";

describe("item enrichment", () => {
  let sdk;

  beforeEach(() => {
    sdk = mockRStreamsSdk(new RStreamsSdk());
    (mod as any).getLeo = () => sdk;
  });

  it("filters inactive items and enriches active ones", (done) => {
    sdk.mock.queues["raw-items"] = [
      { item_id: 1, active: true, name: "Widget" },
      { item_id: 2, active: false, name: "Discontinued" },
      { item_id: 3, active: true, name: "Gadget" },
    ];

    const event = createBotInvocationEvent("test", {
      queue: "raw-items",
      botNumber: 0,
    });

    mod.botHandler(event, createContext(), (err) => {
      assert.isNull(err);
      const output = sdk.mock.written["enriched-items"];
      assert.equal(output.payloads.length, 2);
      assert.isTrue(output.payloads[0].enriched);
      assert.equal(output.payloads[0].name, "Widget");
      done();
    });
  });
});
```

### Testing an Offload Bot

```typescript
// offload-handler.ts
export const botHandler = async (settings, context, callback) => {
  const leo = getLeo();
  const db = await getDatabase();

  leo.offload(
    {
      id: settings.botId,
      inQueue: settings.queue,
      transform(payload, event, done) {
        db.upsert("items", payload).then(() => done()).catch(done);
      },
    },
    callback
  );
};
```

```typescript
// offload-handler.test.ts
it("offloads all events from the queue", (done) => {
  sdk.mock.queues["items-to-sync"] = [
    { item_id: 1, name: "Widget" },
    { item_id: 2, name: "Gadget" },
  ];

  const event = createBotInvocationEvent("sync-bot", {
    queue: "items-to-sync",
    botNumber: 0,
  });

  mod.botHandler(event, createContext(), (err) => {
    assert.isNull(err);
    // For offload bots, assert on side effects (DB calls, etc.)
    // The mock ensures no real bus reads happened
    assert.equal(sdk.mock.readSpy.callCount, 1);
    done();
    }
  );
});
```

### Testing put / putEvent / putEvents

```typescript
it("writes a single event", async () => {
  await sdk.putEvent("my-bot", "notifications", {
    userId: "u1",
    message: "Hello!",
  });

  assert.equal(sdk.mock.written["notifications"].payloads.length, 1);
  assert.equal(sdk.mock.written["notifications"].payloads[0].message, "Hello!");
});

it("writes multiple events", async () => {
  await sdk.putEvents(
    [{ data: "a" }, { data: "b" }, { data: "c" }],
    { botId: "batch-bot", queue: "batch-queue" }
  );

  assert.equal(sdk.mock.written["batch-queue"].payloads.length, 3);
});
```

### Testing a Custom Pipeline

```typescript
it("transforms and writes via pipeline", async () => {
  sdk.mock.queues["input"] = [
    { name: "alice" },
    { name: "bob" },
  ];

  await sdk.streams.pipeAsync(
    sdk.read("my-bot", "input"),
    sdk.streams.through((event, done) => {
      done(null, {
        id: "my-bot",
        event: "output",
        payload: { greeting: `Hello, ${event.payload.name}!` },
      });
    }),
    sdk.write("my-bot"),
    sdk.streams.devnull()
  );

  assert.deepEqual(sdk.mock.written["output"].payloads, [
    { greeting: "Hello, alice!" },
    { greeting: "Hello, bob!" },
  ]);
});
```

### Asserting Checkpoint Behavior

```typescript
it("checkpoints after processing", async () => {
  sdk.mock.queues["q"] = [{ x: 1 }];

  const readStream = sdk.read("bot", "q");
  // ... process the stream ...

  readStream.checkpoint(() => {});
  assert.equal(readStream.checkpointSpy.callCount, 1);
});
```

### Configuring getCheckpoint Return Values

```typescript
it("resumes from last checkpoint", async () => {
  sdk.mock.bot.getCheckpoint.returnValue["my-queue"] = {
    checkpoint: "z/2025/01/15/00/00/1705276800000",
    records: 1000,
  };

  const cp = await sdk.bot.getCheckpoint("my-bot", "my-queue");
  assert.equal(cp.records, 1000);
});
```

---

## Architecture Notes

- **No framework dependencies**: The spy system is built from scratch — no sinon, jest, or other test library required. Works identically with any test runner.
- **Real streams**: Read streams are real Node.js `Readable` streams in object mode. Write streams use real `Transform` streams (`streams.through`). Backpressure works normally.
- **Non-mutating**: `mockRStreamsSdk` creates a new object via `Object.create(sdk)`. The original SDK instance is untouched — safe for parallel test execution.
- **Prototype chain**: The mock SDK inherits from the original via prototype, so any property/method not explicitly overridden falls through to the real SDK.
- **Wrapper-agnostic**: This mock tests your handler logic directly. The cron/resource wrappers (`wrappers/cron.js`, etc.) manage Lambda lifecycle (locking, reporting) using their own internal SDK instance. Make your SDK accessor swappable (a getter function or `mockable()` wrapper) so tests can inject the mock while the handler keeps its normal `(settings, context, callback)` signature.
