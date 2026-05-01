'use strict';

const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const { access } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { URL } = require('node:url');

const DATA_FILE = process.env.YES_DATA_FILE || 'data/yes.yaml';
const VALID_KINDS = new Set(['agree', 'confirm', 'contradict', 'encourage']);

async function loadPhrases(filePath = DATA_FILE) {
  await access(filePath);

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const phrases = [];
  let current = null;

  for await (const line of rl) {
    const kindMatch = line.match(/^\s*- kind:\s*(\w+)\s*$/);
    if (kindMatch) {
      current = { kind: kindMatch[1] };
      continue;
    }

    const textMatch = line.match(/^\s*text:\s*"(.*)"\s*$/);
    if (textMatch && current) {
      current.text = textMatch[1].replace(/\\"/g, '"');
      phrases.push(current);
      current = null;
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

    const filtered = kind ? phrases.filter((item) => item.kind === kind) : phrases;
    const phrase = pickRandom(filtered);

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

module.exports = { loadPhrases, createApp, VALID_KINDS };
