'use strict';

const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const { access } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { URL } = require('node:url');
const path = require('node:path');

const DATA_DIR = process.env.YES_DATA_DIR || 'data';
const VALID_KINDS = new Set(['agree', 'confirm', 'contradict', 'encourage']);

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

function createApp({ phrases, dataDir = DATA_DIR }) {
  return createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');

    if (req.method !== 'GET' || requestUrl.pathname !== '/yes') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const kind = requestUrl.searchParams.get('kind');
    if (kind && !VALID_KINDS.has(kind)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid kind' }));
      return;
    }

    if (kind) {
      try {
        const filtered = await loadKindPhrases(dataDir, kind);
        const phrase = pickRandom(filtered);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(phrase));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Kind file is not accessible' }));
      }
      return;
    }

    const phrase = pickRandom(phrases);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(phrase));
  });
}

async function start() {
  const phrases = await loadPhrases();
  const port = Number(process.env.PORT || 3000);
  const server = createApp({ phrases });

  server.listen(port, () => {
    process.stdout.write(`Server listening on :${port}\n`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { loadPhrases, loadKindPhrases, createApp, VALID_KINDS };
