#!/usr/bin/env node
'use strict';

/**
 * Serveur 301 — HTTP + Server-Sent Events, sans aucune dépendance npm.
 *
 *   node darts/server.js            → http://localhost:3010
 *   PORT=8080 node darts/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { MatchStore, HttpError, MIN_PLAYERS, MAX_PLAYERS } = require('./public/lib/match');
const { applyAction } = require('./public/lib/actions');

const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = new MatchStore();
/** @type {Map<string, Set<{res: import('http').ServerResponse, playerId: string|null}>>} */
const streams = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// Diffusion temps réel
// ---------------------------------------------------------------------------

function clientsOf(code) {
  let set = streams.get(code);
  if (!set) {
    set = new Set();
    streams.set(code, set);
  }
  return set;
}

function broadcast(match) {
  match.rev += 1;
  match.updatedAt = Date.now();
  const payload = JSON.stringify(match.snapshot());
  for (const client of clientsOf(match.code)) {
    try {
      client.res.write(`event: state\ndata: ${payload}\n\n`);
    } catch {
      /* le flux sera nettoyé par son handler 'close' */
    }
  }
}

function refreshPresence(match) {
  const live = new Set();
  for (const c of clientsOf(match.code)) if (c.playerId) live.add(c.playerId);
  let changed = false;
  for (const p of match.players) {
    const connected = p.local ? true : live.has(p.id);
    if (p.connected !== connected) {
      p.connected = connected;
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Utilitaires HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Requête trop volumineuse.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Interdit');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // toute route inconnue retombe sur l'app (liens de partage /ABCD)
      if (!path.extname(rel)) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return res.writeHead(404).end('Introuvable');
          res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
        });
        return;
      }
      res.writeHead(404).end('Introuvable');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function authenticate(match, token) {
  const player = match.playerByToken(String(token || ''));
  if (!player) throw new HttpError(401, 'Session inconnue — rejoins la partie.');
  return player;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'matches', ...]

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'matches') {
    const body = await readBody(req);
    const match = store.create(body.settings);
    const player = match.addPlayer(body.name, body.token);
    broadcast(match);
    return sendJson(res, 201, {
      code: match.code, playerId: player.id, token: player.token, state: match.snapshot(),
    });
  }

  if (parts.length >= 3 && parts[1] === 'matches') {
    const match = store.get(parts[2]);
    const action = parts[3];

    if (req.method === 'GET' && !action) {
      return sendJson(res, 200, { state: match.snapshot() });
    }

    if (req.method === 'POST' && action === 'join') {
      const body = await readBody(req);
      const player = match.addPlayer(body.name, body.token);
      broadcast(match);
      return sendJson(res, 200, {
        code: match.code, playerId: player.id, token: player.token, state: match.snapshot(),
      });
    }

    if (req.method === 'GET' && action === 'stream') {
      const player = match.playerByToken(url.searchParams.get('token') || '');
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const client = { res, playerId: player ? player.id : null };
      clientsOf(match.code).add(client);
      res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(match.snapshot())}\n\n`);
      if (refreshPresence(match)) broadcast(match);

      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch { /* ignoré */ }
      }, 20000);

      req.on('close', () => {
        clearInterval(ping);
        clientsOf(match.code).delete(client);
        if (refreshPresence(match)) broadcast(match);
      });
      return undefined;
    }

    if (req.method === 'POST' && action === 'action') {
      const body = await readBody(req);
      const player = authenticate(match, body.token);
      applyAction(match, player, body);
      broadcast(match);
      return sendJson(res, 200, { ok: true, state: match.snapshot() });
    }
  }

  throw new HttpError(404, 'Route inconnue.');
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Erreur serveur' });
      else res.end();
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Méthode non autorisée');
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

setInterval(() => store.sweep(), 15 * 60 * 1000).unref();

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  🎯  301 — partie de fléchettes en réseau');
    console.log(`      ${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs, chacun sur son téléphone`);
    console.log('');
    console.log(`      Sur cet appareil : http://localhost:${PORT}`);
    for (const addr of localAddresses()) {
      console.log(`      Sur le Wi-Fi     : http://${addr}:${PORT}`);
    }
    console.log('');
  });
}

module.exports = { server, store };
