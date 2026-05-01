# YAAS — Yes as a Service

YAAS is a tiny Node.js service that returns short affirmative phrases.
It includes:

- a plain text API endpoint (`/yes`),
- a simple web UI (`/`), and
- an MCP-compatible JSON-RPC endpoint (`/mcp`) exposing a `get-yes` tool.

The project is intentionally lightweight and file-based, making it easy to run locally and adapt for demos, testing, or assistant integrations.

## Features

- Random yes-like phrase responses from curated categories.
- Phrase categories (`kind`): `agree`, `confirm`, `contradict`, `encourage`.
- Browser page for one-click phrase generation.
- MCP server support for tool and resource discovery.
- No external runtime dependencies.

## Project Structure

```text
.
├── data/
│   ├── agree.txt
│   ├── confirm.txt
│   ├── contradict.txt
│   └── encourage.txt
├── docs/
│   └── mcp-instructions.md
├── test/
│   └── server.test.js
├── server.js
├── template.html
├── favicon.svg
├── package.json
├── Dockerfile
└── README.md
```

## Requirements

- Node.js 18+ (recommended)

## Getting Started

### 1) Install dependencies

This project currently uses only Node built-ins, so install is usually optional, but you can still run:

```bash
npm install
```

### 2) Run the server

```bash
npm start
```

By default, YAAS listens on port `3000`.

## Configuration

Environment variables:

- `PORT` — HTTP port (default: `3000`)
- `YES_DATA_DIR` — directory containing phrase files (default: `./data`)

Example:

```bash
PORT=8080 YES_DATA_DIR=./data npm start
```

## API Reference

### GET `/yes`

Returns a plain text phrase.

#### Query parameters

- `kind` *(optional)*: `agree`, `confirm`, `contradict`, `encourage`
- `kind=any` or omitted: choose from all categories

#### Examples

```bash
curl "http://localhost:3000/yes"
curl "http://localhost:3000/yes?kind=encourage"
```

#### Error behavior

- `400 Invalid kind` when `kind` is unsupported.
- `400 Kind file is not accessible` when a specific kind has no available phrases.

### GET `/`

Serves a minimal HTML interface that displays a random phrase and allows filtering by category.

### POST `/mcp`

MCP-style JSON-RPC endpoint.

Supported methods:

- `initialize`
- `tools/list`
- `tools/call` (tool: `get-yes`)
- `resources/list`
- `resources/read`

#### `tools/call` example

```bash
curl -X POST "http://localhost:3000/mcp" \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get-yes",
      "arguments": { "kind": "agree" }
    }
  }'
```

## Phrase Data Format

Each file in `data/` should contain one phrase per line. Empty lines are ignored.

Example (`data/agree.txt`):

```text
Absolutely.
Yes, I agree.
That makes sense to me.
```

## Development

Run tests:

```bash
npm test
```

Start directly with Node:

```bash
node server.js
```

## Docker

Build image:

```bash
docker build -t yaas .
```

Run container:

```bash
docker run --rm -p 3000:3000 yaas
```

## Security Notes

- Input handling is intentionally simple and best suited for trusted/internal usage.
- If exposing publicly, consider adding request size limits, rate limiting, and structured logging.

## License

MIT — see [LICENSE](LICENSE).
