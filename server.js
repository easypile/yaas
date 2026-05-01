'use strict';

const { createServer } = require('node:http');
const { createReadStream, readFileSync } = require('node:fs');
const { access } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { URL } = require('node:url');
const path = require('node:path');

const DATA_DIR = process.env.YES_DATA_DIR || 'data';
const VALID_KINDS = new Set(['agree', 'confirm', 'contradict', 'encourage']);

const PAGE_TEMPLATE = readFileSync('template.html', 'utf8');

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

function createApp({ phrases }) {
  return createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');

    const kindParam = requestUrl.searchParams.get('kind');
    const normalizedKind = kindParam === 'any' ? null : kindParam;

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
      res.end(readFileSync('favicon.svg', 'utf8'));
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
