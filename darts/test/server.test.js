'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { server } = require('../server');

let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Ouvre un flux SSE et collecte les états jusqu'à ce que `done` soit satisfait. */
function streamUntil(code, token, done) {
  return new Promise((resolve, reject) => {
    const states = [];
    let buffer = '';
    const req = http.get(`${base}/api/matches/${code}/stream?token=${token}`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let i = buffer.indexOf('\n\n');
        while (i !== -1) {
          const frame = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (data) states.push(JSON.parse(data.slice(6)));
          if (states.length && done(states[states.length - 1])) {
            req.destroy();
            resolve(states);
            return;
          }
          i = buffer.indexOf('\n\n');
        }
      });
    });
    req.on('error', (e) => { if (!states.length || !done(states[states.length - 1])) reject(e); });
    setTimeout(() => { req.destroy(); reject(new Error('délai SSE dépassé')); }, 5000).unref();
  });
}

test('le fichier index est servi', async () => {
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /301/);
});

test('un lien de partage /ABCD renvoie l’application', async () => {
  const res = await fetch(`${base}/ABCD`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('créer, rejoindre, jouer et suivre en direct', async () => {
  const created = await post('/api/matches', { name: 'Alex', settings: { start: 101 } });
  assert.strictEqual(created.status, 201);
  const { code, token: tokenA } = created.body;
  assert.match(code, /^[A-Z0-9]{4}$/);

  const joined = await post(`/api/matches/${code}/join`, { name: 'Bea' });
  const tokenB = joined.body.token;
  assert.strictEqual(joined.body.state.players.length, 2);

  // le flux reçoit l'état initial, puis chaque changement jusqu'à la fléchette
  const pending = streamUntil(code, tokenB, (st) => st.turnDarts.length === 1);
  await new Promise((r) => { setTimeout(r, 100); });
  await post(`/api/matches/${code}/action`, { token: tokenA, action: 'start' });
  await post(`/api/matches/${code}/action`, { token: tokenA, action: 'throw', segment: 'T20' });
  const states = await pending;

  assert.strictEqual(states[0].status, 'lobby');
  assert.ok(states.some((st) => st.status === 'playing'), 'un état « partie lancée » est diffusé');
  const last = states[states.length - 1];
  assert.strictEqual(last.players.find((p) => p.name === 'Alex').score, 41);
  assert.strictEqual(last.turnDarts.length, 1);
  assert.strictEqual(last.dartsLeft, 2);
  assert.ok(!JSON.stringify(states).includes(tokenA));

  // Bea ne peut pas jouer à la place d'Alex
  const stolen = await post(`/api/matches/${code}/action`, { token: tokenB, action: 'throw', segment: 'T20' });
  assert.strictEqual(stolen.status, 403);
});

test('jeton inconnu et partie inconnue sont refusés', async () => {
  const noMatch = await post('/api/matches/ZZZZ/action', { token: 'x', action: 'start' });
  assert.strictEqual(noMatch.status, 404);

  const created = await post('/api/matches', { name: 'Alex' });
  const bad = await post(`/api/matches/${created.body.code}/action`, { token: 'faux', action: 'start' });
  assert.strictEqual(bad.status, 401);
});

test('seul l’hôte peut lancer la partie', async () => {
  const created = await post('/api/matches', { name: 'Alex' });
  const { code } = created.body;
  const guest = await post(`/api/matches/${code}/join`, { name: 'Bea' });
  const res = await post(`/api/matches/${code}/action`, { token: guest.body.token, action: 'start' });
  assert.strictEqual(res.status, 403);
});
