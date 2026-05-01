'use strict';

const { createServer } = require('node:http');
const { createReadStream, readFileSync } = require('node:fs');
const { access } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { URL } = require('node:url');
const path = require('node:path');

const BASE_DIR = __dirname;
const DATA_DIR = process.env.YES_DATA_DIR || path.join(BASE_DIR, 'data');
const VALID_KINDS = new Set(['agree', 'confirm', 'contradict', 'encourage']);
const MCP_RESOURCE_URI = 'docs://yaas/mcp-instructions';

const PAGE_TEMPLATE = readFileSync(path.join(BASE_DIR, 'template.html'), 'utf8');
const MCP_INSTRUCTIONS = readFileSync(path.join(BASE_DIR, 'docs/mcp-instructions.md'), 'utf8');

async function loadKindPhrases(dataDir = DATA_DIR, kind) {
  const filePath = path.join(dataDir, `${kind}.txt`);
  await access(filePath);

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const phrases = [];
  for await (const line of rl) {
    const text = line.trim();
    if (text) {
      phrases.push({ kind, text });
    }
  }

  return phrases;
}

async function loadPhrases(dataDir = DATA_DIR) {
  const phrases = [];
  for (const kind of VALID_KINDS) {
    try {
      const kindPhrases = await loadKindPhrases(dataDir, kind);
      phrases.push(...kindPhrases);
    } catch {
      // Ignore missing/unreadable kind files during startup; handled per-request.
    }
  }

  return phrases;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createJsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function createJsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleMcpRequest(payload, phrases) {
  const id = Object.prototype.hasOwnProperty.call(payload, 'id') ? payload.id : null;

  if (!payload || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return { status: 400, body: createJsonRpcError(id, -32600, 'Invalid Request') };
  }

  if (payload.method === 'initialize') {
    return {
      status: 200,
      body: createJsonRpcResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'yaas-mcp-server',
          version: '1.0.0'
        },
        instructions: 'Use this server when you need validated yes-like responses. Prefer get-yes with an optional kind. See the instruction resource for usage details.',
        capabilities: {
          tools: {},
          resources: {}
        }
      })
    };
  }

  if (payload.method === 'tools/list') {
    return {
      status: 200,
      body: createJsonRpcResponse(id, {
        tools: [
          {
            name: 'get-yes',
            title: 'Get Yes Phrase',
            description: 'Returns a yes-like phrase from the YAAS phrase library. Use this when you need short affirmative or supportive language. Optional kind must be one of: agree, confirm, contradict, encourage. Returns an error for unsupported kind values.',
            inputSchema: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  description: 'Optional phrase category. Supported values: agree, confirm, contradict, encourage.'
                }
              },
              additionalProperties: false
            }
          }
        ]
      })
    };
  }

  if (payload.method === 'tools/call') {
    const params = payload.params || {};
    const args = params.arguments || {};
    if (params.name !== 'get-yes') {
      return { status: 200, body: createJsonRpcError(id, -32601, 'Tool not found') };
    }

    const kind = args.kind;
    if (kind != null && !VALID_KINDS.has(kind)) {
      return { status: 200, body: createJsonRpcError(id, -32000, `Invalid kind: ${kind}`) };
    }

    const filtered = kind ? phrases.filter((item) => item.kind === kind) : phrases;
    if (filtered.length === 0) {
      return { status: 200, body: createJsonRpcError(id, -32001, 'No phrases available for requested kind') };
    }

    const phrase = pickRandom(filtered);
    return {
      status: 200,
      body: createJsonRpcResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ kind: phrase.kind, text: phrase.text })
          }
        ]
      })
    };
  }

  if (payload.method === 'resources/list') {
    return {
      status: 200,
      body: createJsonRpcResponse(id, {
        resources: [
          {
            uri: MCP_RESOURCE_URI,
            name: 'YAAS MCP Usage Instructions',
            description: 'Guidance explaining when to use this MCP server and how to call get-yes effectively.',
            mimeType: 'text/markdown'
          }
        ]
      })
    };
  }

  if (payload.method === 'resources/read') {
    const params = payload.params || {};
    if (params.uri !== MCP_RESOURCE_URI) {
      return { status: 200, body: createJsonRpcError(id, -32002, 'Resource not found') };
    }

    return {
      status: 200,
      body: createJsonRpcResponse(id, {
        contents: [
          {
            uri: MCP_RESOURCE_URI,
            mimeType: 'text/markdown',
            text: MCP_INSTRUCTIONS
          }
        ]
      })
    };
  }

  // Handle notifications (methods starting with 'notifications/')
  // Per JSON-RPC 2.0 spec, notifications must not have an id field
  if (payload.method && payload.method.startsWith('notifications/')) {
    if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
      return { status: 400, body: createJsonRpcError(null, -32600, 'Invalid Request') };
    }
    // Notification - no response expected
    // Currently we accept all notifications without specific handling
    return { status: 204, body: '' };
  }

  return { status: 200, body: createJsonRpcError(id, -32601, 'Method not found') };
}

function createApp({ phrases }) {
  return createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const mcpCorsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, mcp-session-id',
      'access-control-max-age': '86400'
    };

    const kindParam = requestUrl.searchParams.get('kind');
    const normalizedKind = kindParam === 'any' ? null : kindParam;

    if (req.method === 'OPTIONS' && requestUrl.pathname === '/mcp') {
      res.writeHead(204, mcpCorsHeaders);
      res.end();
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/mcp') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          res.writeHead(400, { ...mcpCorsHeaders, 'content-type': 'application/json; charset=utf-8' });
          res.end(createJsonRpcError(null, -32700, 'Parse error'));
          return;
        }

        const response = handleMcpRequest(payload, phrases);
        res.writeHead(response.status, { ...mcpCorsHeaders, 'content-type': 'application/json; charset=utf-8' });
        res.end(response.body);
      });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/yes') {
      if (normalizedKind && !VALID_KINDS.has(normalizedKind)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Invalid kind');
        return;
      }
      const filtered = normalizedKind ? phrases.filter((item) => item.kind === normalizedKind) : phrases;
      if (normalizedKind && filtered.length === 0) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Kind file is not accessible');
        return;
      }
      const phrase = pickRandom(filtered);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(phrase.text);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/favicon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
      res.end(readFileSync(path.join(BASE_DIR, 'favicon.svg'), 'utf8'));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/') {
      const selectedKind = VALID_KINDS.has(normalizedKind) ? normalizedKind : 'any';
      const filtered = selectedKind === 'any' ? phrases : phrases.filter((item) => item.kind === selectedKind);
      const phrase = pickRandom(filtered);
      const page = PAGE_TEMPLATE
        .replace('{{PHRASE_PLACEHOLDER}}', phrase.text)
        .replace('{{CHECKED_ANY}}', selectedKind === 'any' ? 'checked' : '')
        .replace('{{CHECKED_AGREE}}', selectedKind === 'agree' ? 'checked' : '')
        .replace('{{CHECKED_CONFIRM}}', selectedKind === 'confirm' ? 'checked' : '')
        .replace('{{CHECKED_CONTRADICT}}', selectedKind === 'contradict' ? 'checked' : '')
        .replace('{{CHECKED_ENCOURAGE}}', selectedKind === 'encourage' ? 'checked' : '');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });
}

async function start() {
  const phrases = await loadPhrases();
  const port = Number(process.env.PORT || 3000);
  const server = createApp({ phrases });

  server.listen(port, () => {
    process.stdout.write(`Server listening on :${port}
`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    process.stderr.write(`${error.stack || error}
`);
    process.exitCode = 1;
  });
}

module.exports = { loadPhrases, loadKindPhrases, createApp, VALID_KINDS, handleMcpRequest, MCP_RESOURCE_URI };
