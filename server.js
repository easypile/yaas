'use strict';

const { createServer } = require('node:http');
const { createReadStream, readFileSync } = require('node:fs');
const { access } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { URL } = require('node:url');
const path = require('node:path');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

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

function createMcpServer(phrases) {
  const server = new McpServer(
    { name: 'yaas-mcp-server', version: '1.0.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: 'Use this server when you need validated yes-like responses. Prefer get-yes with an optional kind. See the instruction resource for usage details.'
    }
  );

  server.registerTool('get-yes', {
    title: 'Get Yes Phrase',
    description: 'Returns a yes-like phrase from the YAAS phrase library. Use this when you need short affirmative or supportive language. Optional kind must be one of: agree, confirm, contradict, encourage. Returns an error for unsupported kind values.',
    inputSchema: {
      kind: z.string().optional().describe('Optional phrase category. Supported values: agree, confirm, contradict, encourage.')
    }
  }, async ({ kind } = {}) => {
    if (kind != null && !VALID_KINDS.has(kind)) {
      throw new Error(`Invalid kind: ${kind}`);
    }

    const filtered = kind ? phrases.filter((item) => item.kind === kind) : phrases;
    if (filtered.length === 0) {
      throw new Error('No phrases available for requested kind');
    }

    const phrase = pickRandom(filtered);
    return {
      content: [{ type: 'text', text: JSON.stringify({ kind: phrase.kind, text: phrase.text }) }]
    };
  });

  server.registerResource(
    'YAAS MCP Usage Instructions',
    MCP_RESOURCE_URI,
    {
      description: 'Guidance explaining when to use this MCP server and how to call get-yes effectively.',
      mimeType: 'text/markdown'
    },
    async () => ({
      contents: [{ uri: MCP_RESOURCE_URI, mimeType: 'text/markdown', text: MCP_INSTRUCTIONS }]
    })
  );

  return server;
}

function createApp({ phrases }) {
  return createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const mcpCorsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version',
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
      req.on('end', async () => {
        let parsedBody;
        try {
          parsedBody = JSON.parse(raw || '{}');
        } catch {
          parsedBody = null;
        }

        // A new server and transport are created per request so that concurrent
        // stateless requests do not share transport state.
        const mcpServer = createMcpServer(phrases);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });

        // Register cleanup before handling the request to avoid a race where
        // the response finishes before the close handler is attached.
        res.on('close', () => {
          transport.close();
          mcpServer.close();
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
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

module.exports = { loadPhrases, loadKindPhrases, createApp, createMcpServer, VALID_KINDS, MCP_RESOURCE_URI };
