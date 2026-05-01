'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { loadPhrases, createApp, MCP_RESOURCE_URI } = require('../server');

async function withServer(fn, dataDir = 'data') {
  const phrases = await loadPhrases(dataDir);
  const server = createApp({ phrases, dataDir });
  server.listen(0);
  await once(server, 'listening');

  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    await fn(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function mcpCall(base, method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return { status: res.status, body: await res.json() };
}

test('GET / returns HTML page', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Yes as a service/);
  });
});

test('GET /yes rejects invalid kind', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/yes?kind=unknown`);
    assert.equal(res.status, 400);
  });
});

test('MCP initialize returns detailed server description', async () => {
  await withServer(async (base) => {
    const { status, body } = await mcpCall(base, 'initialize');
    assert.equal(status, 200);
    assert.match(body.result.instructions, /validated yes-like responses/);
    assert.equal(body.result.serverInfo.name, 'yaas-mcp-server');
  });
});

test('MCP tools/list returns get-yes tool with description', async () => {
  await withServer(async (base) => {
    const { body } = await mcpCall(base, 'tools/list');
    assert.equal(body.result.tools.length, 1);
    assert.equal(body.result.tools[0].name, 'get-yes');
    assert.match(body.result.tools[0].description, /Optional kind must be one of/);
  });
});

test('MCP get-yes returns error for invalid kind', async () => {
  await withServer(async (base) => {
    const { body } = await mcpCall(base, 'tools/call', { name: 'get-yes', arguments: { kind: 'bad' } });
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /Invalid kind/);
  });
});

test('MCP resources list/read exposes instructions resource', async () => {
  await withServer(async (base) => {
    const list = await mcpCall(base, 'resources/list');
    assert.equal(list.body.result.resources[0].uri, MCP_RESOURCE_URI);

    const read = await mcpCall(base, 'resources/read', { uri: MCP_RESOURCE_URI });
    assert.match(read.body.result.contents[0].text, /When to use it/);
  });
});

test('MCP endpoint handles CORS preflight', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  });
});

test('MCP notifications/initialized returns no content', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });
    assert.equal(res.status, 204);
    const body = await res.text();
    assert.equal(body, '');
  });
});

test('MCP notifications/initialized with id returns error', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, -32600);
  });
});

test('MCP handles other notification methods correctly', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' })
    });
    assert.equal(res.status, 204);
  });
});

test('unknown route returns 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

test('GET /yes returns 400 when kind file is missing', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yes-data-'));
  await writeFile(path.join(dataDir, 'agree.txt'), 'A\nB\n', 'utf8');

  await withServer(async (base) => {
    const res = await fetch(`${base}/yes?kind=confirm`);
    assert.equal(res.status, 400);
  }, dataDir);
});
