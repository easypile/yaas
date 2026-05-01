import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { loadPhrases, createApp, MCP_RESOURCE_URI, YES_DIR, NO_DIR, VALID_YES_KINDS, VALID_NO_KINDS } from '../server.js';

async function withServer(fn, yesDir = YES_DIR, noDir = NO_DIR) {
  const yesPhrases = await loadPhrases(yesDir, VALID_YES_KINDS);
  const noPhrases = await loadPhrases(noDir, VALID_NO_KINDS);
  const server = createApp({ yesPhrases, noPhrases });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base); } finally { server.close(); await once(server, 'close'); }
}

async function mcpCall(base, method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test('GET / returns tabbed page with no inline JS and fonts preconnect', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Yes as a service/);
    assert.match(html, /No as a service/);
    assert.match(html, /Refresh yes phrase/);
    assert.match(html, /Refresh no phrase/);
    assert.match(html, /fonts.googleapis.com/);
  });
});

test('GET /yes and /no validate kinds', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/yes?kind=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/no?kind=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/yes?kind=agree`)).status, 200);
    assert.equal((await fetch(`${base}/no?kind=refuse`)).status, 200);
  });
});

test('MCP initialize returns detailed server description', async () => {
  await withServer(async (base) => {
    const { status, body } = await mcpCall(base, 'initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' }
    });
    assert.equal(status, 200);
    assert.match(body.result.instructions, /yes\/no-like responses/);
    assert.equal(body.result.serverInfo.name, 'yaas-mcp-server');
  });
});

test('MCP tools/list returns get-yes and get-no tool with description', async () => {
  await withServer(async (base) => {
    const { body } = await mcpCall(base, 'tools/list');
    const tools = body.result.tools;
    assert.equal(tools.length, 2);
    assert.ok(tools.some((t) => t.name === 'get-yes' && /Optional kind/.test(t.description)));
    assert.ok(tools.some((t) => t.name === 'get-no' && /Optional kind/.test(t.description)));
  });
});

test('MCP get-no returns error for invalid kind', async () => {
  await withServer(async (base) => {
    const { body } = await mcpCall(base, 'tools/call', { name: 'get-no', arguments: { kind: 'bad' } });
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /Invalid kind/);
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

test('MCP endpoint handles CORS preflight and POST headers', async () => {
  await withServer(async (base) => {
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');

    const post = await mcpCall(base, 'initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' }
    });
    assert.equal(post.headers.get('access-control-allow-origin'), '*');
  });
});

test('Health endpoints return ok', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
  });
});

test('GET /yes returns 400 when kind file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yes-data-'));
  const yesDir = path.join(root, 'yes');
  const noDir = path.join(root, 'no');
  await mkdir(yesDir);
  await mkdir(noDir);
  await writeFile(path.join(yesDir, 'agree.txt'), 'A\nB\n', 'utf8');

  await withServer(async (base) => {
    const res = await fetch(`${base}/yes?kind=confirm`);
    assert.equal(res.status, 400);
  }, yesDir, noDir);
});
