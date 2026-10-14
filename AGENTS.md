# leo-sdk-nodejs (package `leo-sdk`)

## Overview

Node/TypeScript SDK that writes events to and reads events from an RStreams (LEO) bus.
Entry point is `index.js` (`RStreamsSdk`, typed by `index.d.ts`). It is the reference
implementation other-language SDKs are measured against, so observable behavior (DynamoDB
params, call order, option names) is load-bearing even where it looks accidental.
Version lives in `package.json`; GitHub repo `LeoPlatform/Nodejs`.

## Tech Stack

- Node 16/18/20/22 (CI matrix in `.github/workflows/node.js.yml`), TypeScript 4+, CommonJS output.
- AWS SDK v3 clients (`@aws-sdk/client-kinesis`, `client-firehose`, `client-s3`,
  `client-dynamodb` + `lib-dynamodb`, `client-lambda`, `client-secrets-manager`, `lib-storage`).
- Streams: `through2`, `pump`, `pumpify`, `event-stream`, `split2`, `flush-write-stream`.
- Tests: mocha + chai + sinon + sinon-chai, coverage by nyc.

## Source layout

- `index.js` / `index.d.ts` — SDK facade (`read`, `load`, `enrich`, `offload`, `putEvent`, `bot`, `streams`, `aws`).
- `lib/stream/leo-stream.js` — the core: `toLeo`, `load`, `fromLeo`, `process`, `enrich`, `offload`,
  `toCheckpoint`, `toDynamoDB`, `toS3`, `fromS3`, `magic`, `autoSwitch`, `createCorrelation`.
- `lib/stream/helper/` — `leos3.js`, `chunkEventStream.js` (hand-written JS); `leo-stream-helper.ts`,
  `parser-util.ts`, `worker-pool.ts` and friends (TypeScript).
- `lib/streams.js` — stream primitives (`through`, `buffer`, `batch`, `pipe`, `eventIdFromTimestamp`,
  `eventIdToTimestamp`).
- `lib/cron.js` — bot/cron table access: `checkpoint`, `checkLock`, `reportComplete`, `start`, `end`, `get`,
  `shouldRun`, `createBot`, `subscribe`.
- `lib/dynamodb.js` — DynamoDB document-client helpers (`get`, `put`, `merge`, `update`, `query`,
  `batchGetTable`, `createTableWriteStream`, `getSetting`, `saveSetting`).
- `lib/rstreams-config-provider-chain.ts` — config resolution chain (`ConfigProviderChain`, `EnvironmentConfiguration`,
  `FileTreeConfiguration`, `LeoConfiguration`, `ObjectConfiguration`, `AWSSecretsConfiguration`).
- `lib/event-trace.ts` — upstream/downstream event tracing via the cron and stats tables.
- `lib/reference.js` — `queue:`/`bot:`/`system:` reference parsing (`ref`, `refId`, `botRef`).
- `wrappers/` — Lambda wrappers: `cron.js`, `fanout.js` (multi-instance fan-out), `wrapAsAsync.js`.
- `lib/mock-*.ts`, `lib/mock.js` — in-memory SDK doubles used by consumers' tests.
- `connectors/`, `lib/apis/`, `lib/template/` — legacy, excluded from coverage.

## Build & Test

```bash
npm ci
npx tsc --watch false          # always pass --watch false; tsconfig.json has "watch": true
npm run coverage-all           # nyc --all + mocha over every compiled *.utest.js
npx mocha --exit test/lib.dynamodb.utest.js   # run one compiled test file
```

- Tests are TypeScript in `test/*.utest.ts`; mocha runs the compiled `test/*.utest.js`. Compile first, every time.
- `.js` compiled from `.ts` is gitignored (`.gitignore` has `*.js`, `!*.ts`). Hand-written JS sources such as
  `lib/cron.js`, `lib/dynamodb.js`, `lib/streams.js`, `lib/stream/leo-stream.js`, `wrappers/fanout.js` are tracked;
  a brand-new `.js` source needs `git add -f`.
- `.nycrc.json`: `sourceMap: false`, `cache: false` so coverage is reported against the compiled JS lines.
  `coverage/` and `.nyc_output/` are gitignored; never commit them.
- `npm run compile` also builds the worker-thread bundle via webpack; not needed for tests.
- CI (`node.js.yml`) installs v2 `aws-sdk` and the v3 clients with `--no-save`, then runs `compile` and `coverage-all`.

## Test conventions

- Style reference: `test/lib.cron.utest.ts` — `sinon.createSandbox()`, `afterEach(() => sandbox.restore())`, chai
  `assert`/`expect`.
- Stub DynamoDB by stubbing `DynamoDBDocument.from` (from `@aws-sdk/lib-dynamodb`) to return
  `{ get, put, update, query, batchGet, batchWrite }` stubs that take `(params, callback)`.
- After a module has been built, its clients can be stubbed on the instance: `ls.kinesis.putRecords`,
  `ls.firehose.putRecordBatch`, `ls.dynamodb.docClient.query`, `ls.s3.send`, `ls.cron.checkpoint`, `ls.toS3`, `ls.fromS3`.
- Call `delete process.__config` in `beforeEach`; `process.__config.registry` is shared by every
  SDK/cron/stream instance in the process.
- Any test touching the `wrappers/fanout.js` factory must restore `leo.streams.fromLeo`, `leo.read`,
  `leo.bot.checkpoint`, `leo.bot.checkLock`, `leo.bot.reportComplete` afterwards (see `test/wrappers.fanout.utest.ts`).
- Use a short fibonacci backoff in tests (`backoff: { initialDelay: 1, maxDelay: 2 }`); `maxDelay` must be greater
  than `initialDelay`.
- `wrappers/fanout.utest.js` is a tracked hand-written test; the TypeScript fanout tests are in `test/wrappers.fanout.utest.ts`.

## Coding conventions

- Tabs for indentation; double quotes in TypeScript, mixed in legacy JS — match the file.
- Callback-first APIs (`(err, data)`) with promise wrappers added later; streams are object-mode.
- Errors are frequently strings (`"Stale Checkpoint"`, `"already running"`), not `Error` objects. Keep them.
- Options objects are merged with `Object.assign({defaults}, opts)`; option names are public API.

## Key patterns

- Write path: `load` -> `through` (wrap payload) -> size guard (> 614400 bytes goes to S3) -> `toLeo`
  (chunk, gzip, Kinesis/Firehose, emits `__cmd: "checkpoint"`) -> `toCheckpoint` (cron table).
- Read path: `fromLeo` does one `batchGet` (cron row + event row), then pages the stream table with
  `query`, prefetching the next page; items are inline `gzip` or `s3` pointers read via `fromS3`.
- Event ids look like `z/YYYY/MM/DD/HH/mm/<epochMs>-<7 digit record>`; compare as strings.
- Config resolution order is defined in `ConfigProviderChain.defaultProviders` (leo-config first).

## Domain context

- Bus tables: `LeoStream` (events), `LeoEvent` (per-queue state, `max_eid`), `LeoCron` (bots, checkpoints, locks),
  `LeoSystem`, `LeoSettings`; plus `LeoS3` bucket, `LeoKinesisStream`, `LeoFirehoseStream`.
- A checkpoint is per bot, per queue, `read` or `write`; `cron.checkpoint` uses a conditional update when a read
  checkpoint is expected and reports `"Stale Checkpoint"` on conflict.

## Gotchas

- `lib/cron.js` `start()` with no callback returns a promise whose overridden `then` returns `undefined`;
  `cron.run()` depends on it.
- `wrappers/fanout.js`: when the second argument is not a function it replaces the whole options object, so a third
  argument is ignored. Each factory call wraps the previous override on the shared `leo` singleton.
- `lib/stream/leo-stream.js` `toCheckpoint` builds its async tasks inside a `var` loop, so every task checkpoints the
  last bot/queue.
- `lib/event-trace.ts` formats eids from local time (no `.utc()`), so results depend on the process time zone.
- Do not run `npx tsc` without `--watch false`; it never exits.
