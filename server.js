import { createReadStream, readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const BASE_DIR = path.dirname(__filename);
const DATA_DIR = process.env.YES_DATA_DIR || path.join(BASE_DIR, 'data');
const YES_DIR = path.join(DATA_DIR, 'yes');
const NO_DIR = path.join(DATA_DIR, 'no');
const VALID_YES_KINDS = new Set(['agree', 'confirm', 'contradict', 'encourage']);
const VALID_NO_KINDS = new Set(['refuse', 'surprise', 'reinforce']);
const MCP_RESOURCE_URI = 'docs://yaas/mcp-instructions';

const MCP_INSTRUCTIONS = readFileSync(path.join(BASE_DIR, 'docs/mcp-instructions.md'), 'utf8');

async function loadKindPhrases(dataDir, kind) {
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

async function loadPhrases(dataDir, validKinds) {
  const phrases = [];
  for (const kind of validKinds) {
    try {
      const kindPhrases = await loadKindPhrases(dataDir, kind);
      phrases.push(...kindPhrases);
    } catch {
      // Ignore missing files during startup; handled per request.
    }
  }
  return phrases;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createMcpServer(yesPhrases, noPhrases) {
  const server = new McpServer({ name: 'yaas-mcp-server', version: '2.0.0' }, {
    capabilities: { tools: {}, resources: {} },
    instructions: 'Use this server when you need validated yes/no-like responses. Prefer get-yes or get-no with optional kind.'
  });

  server.registerTool('get-yes', {
    title: 'Get Yes Phrase',
    description: 'Returns a yes-like phrase. Optional kind: agree, confirm, contradict, encourage.',
    inputSchema: { kind: z.string().optional() }
  }, async ({ kind } = {}) => {
    if (kind != null && !VALID_YES_KINDS.has(kind)) throw new Error(`Invalid kind: ${kind}`);
    const filtered = kind ? yesPhrases.filter((item) => item.kind === kind) : yesPhrases;
    if (filtered.length === 0) throw new Error('No phrases available for requested kind');
    const phrase = pickRandom(filtered);
    return { content: [{ type: 'text', text: JSON.stringify({ kind: phrase.kind, text: phrase.text }) }] };
  });

  server.registerTool('get-no', {
    title: 'Get No Phrase',
    description: 'Returns a no-like phrase. Optional kind: refuse, surprise, reinforce.',
    inputSchema: { kind: z.string().optional() }
  }, async ({ kind } = {}) => {
    if (kind != null && !VALID_NO_KINDS.has(kind)) throw new Error(`Invalid kind: ${kind}`);
    const filtered = kind ? noPhrases.filter((item) => item.kind === kind) : noPhrases;
    if (filtered.length === 0) throw new Error('No phrases available for requested kind');
    const phrase = pickRandom(filtered);
    return { content: [{ type: 'text', text: JSON.stringify({ kind: phrase.kind, text: phrase.text }) }] };
  });

  server.registerResource('YAAS MCP Usage Instructions', MCP_RESOURCE_URI, {
    description: 'Guidance explaining when to use this MCP server and how to call tools effectively.',
    mimeType: 'text/markdown'
  }, async () => ({
    contents: [{ uri: MCP_RESOURCE_URI, mimeType: 'text/markdown', text: MCP_INSTRUCTIONS }]
  }));

  return server;
}

function createApp({ yesPhrases, noPhrases }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(BASE_DIR, 'views'));

  app.use(compression());
  app.use('/public', express.static(path.join(BASE_DIR, 'public')));
  app.use('/favicon.svg', express.static(path.join(BASE_DIR, 'public/favicon.svg')));
  app.use('/mcp', cors({ origin: '*', methods: ['POST', 'OPTIONS'], allowedHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version'] }));

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.status(200).json({ status: 'ready' }));

  app.post('/mcp', express.json(), async (req, res) => {
    const mcpServer = createMcpServer(yesPhrases, noPhrases);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body ?? {});
  });

  app.get('/yes', (req, res) => {
    const kind = req.query.kind === 'any' ? null : req.query.kind;
    if (kind && !VALID_YES_KINDS.has(kind)) return res.status(400).type('text/plain').send('Invalid kind');
    const filtered = kind ? yesPhrases.filter((item) => item.kind === kind) : yesPhrases;
    if (kind && filtered.length === 0) return res.status(400).type('text/plain').send('Kind file is not accessible');
    return res.status(200).type('text/plain').send(pickRandom(filtered).text);
  });

  app.get('/no', (req, res) => {
    const kind = req.query.kind === 'any' ? null : req.query.kind;
    if (kind && !VALID_NO_KINDS.has(kind)) return res.status(400).type('text/plain').send('Invalid kind');
    const filtered = kind ? noPhrases.filter((item) => item.kind === kind) : noPhrases;
    if (kind && filtered.length === 0) return res.status(400).type('text/plain').send('Kind file is not accessible');
    return res.status(200).type('text/plain').send(pickRandom(filtered).text);
  });

  app.get('/', (req, res) => {
    const tab = req.query.tab === 'no' ? 'no' : 'yes';
    const kind = req.query.kind;

    const selectedYesKind = tab === 'yes' && VALID_YES_KINDS.has(kind) ? kind : 'any';
    const selectedNoKind = tab === 'no' && VALID_NO_KINDS.has(kind) ? kind : 'any';

    const yesFiltered = selectedYesKind === 'any' ? yesPhrases : yesPhrases.filter((item) => item.kind === selectedYesKind);
    const noFiltered = selectedNoKind === 'any' ? noPhrases : noPhrases.filter((item) => item.kind === selectedNoKind);

    return res.render('index', {
      yesPhrase: pickRandom(yesFiltered).text,
      noPhrase: pickRandom(noFiltered).text,
      selectedYesKind,
      selectedNoKind,
      activeTab: tab
    });
  });

  app.use((_req, res) => res.status(404).type('text/plain').send('Not Found'));
  return http.createServer(app);
}

async function start() {
  const yesPhrases = await loadPhrases(YES_DIR, VALID_YES_KINDS);
  const noPhrases = await loadPhrases(NO_DIR, VALID_NO_KINDS);
  const port = Number(process.env.PORT || 3000);
  const server = createApp({ yesPhrases, noPhrases });

  server.listen(port, () => process.stdout.write(`Server listening on :${port}\n`));

  const shutdown = (signal) => {
    process.stdout.write(`Received ${signal}, shutting down gracefully...\n`);
    server.close(() => {
      process.stdout.write('Shutdown complete.\n');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] === __filename) {
  start().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

export { loadPhrases, loadKindPhrases, createApp, createMcpServer, VALID_YES_KINDS, VALID_NO_KINDS, MCP_RESOURCE_URI, YES_DIR, NO_DIR };
