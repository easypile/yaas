'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { loadPhrases, createApp } = require('../server');

async function withServer(fn) {
  const phrases = await loadPhrases('data/yes.yaml');
  const server = createApp({ phrases });
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
  });
});

test('unknown route returns 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});
