# YAAS — Yes (and No) as a Service

YAAS is a small Express service that returns short affirmative and negative phrases.
It includes:

- plain text REST endpoints (`/yes`, `/no`),
- a browser UI (`/`) rendered by EJS, and
- an MCP JSON-RPC endpoint (`/mcp`) exposing `get-yes` and `get-no` tools.

## Features

- Phrase categories for both yes and no responses.
- Lightweight file-based phrase storage.
- Compression middleware for HTTP responses.
- CORS handling for MCP endpoint.
- Health/readiness endpoints for platform integration.
- Graceful shutdown on `SIGINT` and `SIGTERM`.

## Project Structure

```text
.
├── data/
│   ├── yes/
│   │   ├── agree.txt
│   │   ├── confirm.txt
│   │   ├── contradict.txt
│   │   └── encourage.txt
│   └── no/
│       ├── refuse.txt
│       ├── surprise.txt
│       └── reinforce.txt
├── docs/
│   └── mcp-instructions.md
├── public/
│   └── favicon.svg
├── views/
│   └── index.ejs
├── test/
│   └── server.test.js
├── server.js
├── package.json
└── Dockerfile
```

## Requirements

- Node.js 18+ (Node 20+ recommended)

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Run tests

```bash
npm test
```

### 3) Start the server

```bash
npm start
```

By default YAAS listens on port `3000`.

## Configuration

- `PORT` — HTTP port (default: `3000`)
- `YES_DATA_DIR` — root directory that contains `yes/` and `no/` folders (default: `./data`)

Example:

```bash
PORT=8080 YES_DATA_DIR=./data npm start
```

## API Reference

### `GET /yes`

Returns one yes-like phrase as plain text.

- Optional query: `kind`
- `kind` values: `agree`, `confirm`, `contradict`, `encourage`
- `kind=any` or omitted = choose from all yes kinds

### `GET /no`

Returns one no-like phrase as plain text.

- Optional query: `kind`
- `kind` values: `refuse`, `surprise`, `reinforce`
- `kind=any` or omitted = choose from all no kinds

### `GET /`

Serves the browser UI.

### `GET /healthz`

Liveness probe endpoint.

### `GET /readyz`

Readiness probe endpoint.

### `POST /mcp`

MCP JSON-RPC endpoint supporting:

- `initialize`
- `tools/list`
- `tools/call` (`get-yes`, `get-no`)
- `resources/list`
- `resources/read`

## Static and Middleware

- `express.static` serves `/favicon.svg` from `public/favicon.svg`.
- `compression()` is enabled globally.
- `cors()` is applied to `/mcp` with MCP-related headers allowed.

## Development

Run directly:

```bash
node server.js
```

## Docker

Build:

```bash
docker build -t yaas .
```

Run:

```bash
docker run --rm -p 3000:3000 yaas
```

## License

MIT — see [LICENSE](LICENSE).
