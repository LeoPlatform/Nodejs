# Leo/RStreams Node.js SDK - Agent Context

## Overview

This repository is the **Leo/RStreams Node.js SDK** (npm package `leo-sdk`). It provides a TypeScript/Node.js SDK for pushing data to and pulling data from an instance of the RStreams bus. The SDK supports operations such as:

- **Put** – Send events to queues
- **Enrich** – Read from one queue, transform, write to another
- **Offload** – Stream data from queues to external systems (DBs, files)
- **Read** – Stream events from queues

The main entry point is `RStreamsSdk`, which discovers configuration from environment, leo-config, or explicit resources.

## Tech Stack

- **Language**: TypeScript (compiles to CommonJS)
- **Runtime**: Node.js 16.x, 18.x, 20.x, 22.x
- **Testing**: Mocha, Chai, Sinon, nyc (Istanbul)
- **Linting**: ESLint with @typescript-eslint
- **Build**: TypeScript compiler + Webpack (for worker-thread code)
- **Config**: leo-config, ConfigProviderChain
- **AWS**: @aws-sdk/* (v3) – DynamoDB, S3, Kinesis, Firehose, Lambda, CloudFormation, Secrets Manager, STS

## Project Structure

```
Nodejs/
├── index.d.ts          # Main SDK types and RStreamsSdk
├── lib/                # Core SDK logic
│   ├── rstreams.ts
│   ├── rstreams-configuration.ts
│   ├── rstreams-config-provider-chain.ts
│   ├── stream/         # Stream helpers, leo-stream, worker pool
│   ├── cron.ts         # Bot management
│   ├── dynamodb.ts     # DynamoDB utilities
│   └── ...
├── wrappers/           # Lambda/cron wrappers (cron, resource, fanout)
├── connectors/         # Connectors (e.g. mysql)
├── test/               # Unit tests (*.utest.ts)
├── examples/           # Example scripts
├── docs/               # API docs (TypeDoc)
├── coverage/           # Coverage output
├── .nycrc.json        # Coverage config
├── tsconfig.json
└── webpack.config.ts   # Worker-thread bundle
```

## Development Setup

```bash
npm install
# Install peer deps (AWS SDK v3) if needed:
npm i --no-save @aws-sdk/client-lambda@^3 @aws-sdk/client-cloudformation@^3 @aws-sdk/client-dynamodb@^3 @aws-sdk/client-firehose@^3 @aws-sdk/client-kinesis@^3 @aws-sdk/client-s3@^3 @aws-sdk/client-secrets-manager@^3 @aws-sdk/client-sts@^3 @aws-sdk/credential-providers@^3 @aws-sdk/lib-dynamodb@^3 @aws-sdk/lib-storage@^3

npm run compile          # Compile TS + worker-thread bundle
npm run watch            # Watch mode
npm run lint             # ESLint
```

## Code Patterns

- **Configuration**: Uses ConfigProviderChain / RStreamsConfiguration to resolve resources (LeoEvent, LeoStream, LeoS3, etc.) from env, leo-config, or explicit config.
- **Streams**: Heavy use of Node.js streams (through2, pumpify, readable-stream). StreamUtil provides load, offload, enrich, fromLeo, toLeo, toCheckpoint.
- **Worker threads**: Some stream processing uses worker threads; code is bundled via Webpack and injected via set-worker-thread-content.js.
- **RStreamsSdk**: Main class; exposes putEvent, putEvents, enrichEvents, offloadEvents, load, offload, enrich, read, streams, bot, aws.

## Testing

- **Test files**: `**/*.utest.ts` (compiled to `*.utest.js`)
- **Run tests**: npm run utest or npm run coverage-all
- **Coverage**: nyc with --all for full coverage; config in .nycrc.json
- **CI**: Runs on Node 16, 18, 20, 22; lint, compile, coverage-all

## Common Tasks

| Task | Command |
|------|---------|
| Compile | npm run compile |
| Lint | npm run lint |
| Run tests | npm run utest |
| Full coverage | npm run coverage-all |
| Publish beta | npm run publish-beta |
| Build docs | npm run build-docs |

## Gotchas

- **Compile order**: compile runs tsc then compile-worker-thread-code (Webpack + set-worker-thread-content). Both are required for full functionality.
- **Peer dependencies**: AWS SDK v3 is peer deps; consumers or CI must install them. CI uses npm i --no-save for AWS packages.
- **Excluded from coverage**: Connectors, test files, templates, apis, docs, and several legacy files are excluded in .nycrc.json.
- **tsconfig**: Excludes **/*.js; only .ts/.tsx are compiled. Generated .js files are the runtime artifacts.
