'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { loadPhrases, createApp, VALID_KINDS } = require('../server');

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

test('GET / returns HTML page', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Yes as a service/);
  });
});

test('GET /?kind=agree preselects kind', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/?kind=agree`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /value="agree" checked/);
  });
});


test('GET / with invalid kind falls back to any and returns 200', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/?kind=unknown`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /value="any" checked/);
  });
});

test('GET /favicon.svg returns svg favicon', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/favicon.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    const body = await res.text();
    assert.match(body, /<svg/);
  });
});

test('GET /yes returns random phrase', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/yes`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.length > 0);
  });
});

test('GET /yes?kind=agree filters by kind', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/yes?kind=agree`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.length > 0);
  });
});

test('GET /yes rejects invalid kind', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/yes?kind=unknown`);
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /plain\/text/);
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

test('unknown route returns 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /plain\/text/);
  });
});
