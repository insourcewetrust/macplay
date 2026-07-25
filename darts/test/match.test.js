'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MatchStore } = require('../lib/match');

function setup(settings = {}, names = ['Alex', 'Bea']) {
  const store = new MatchStore();
  const match = store.create(settings);
  const players = names.map((n) => match.addPlayer(n));
  match.start();
  return { match, players };
}

const throwAll = (match, playerId, segs) => segs.forEach((s) => match.throwDart(playerId, s));

test('le tour passe au joueur suivant après 3 fléchettes', () => {
  const { match, players } = setup();
  throwAll(match, players[0].id, ['T20', 'T20', 'S20']);
  assert.strictEqual(match.scores[players[0].id], 301 - 140);
  assert.strictEqual(match.currentPlayer.id, players[1].id);
  assert.strictEqual(match.history.length, 1);
  assert.strictEqual(match.history[0].scored, 140);
});

test('on ne peut pas lancer hors de son tour', () => {
  const { match, players } = setup();
  assert.throws(() => match.throwDart(players[1].id, 'T20'), /tour/);
});

test('bust : le score de début de volée est restauré et la volée est perdue', () => {
  const { match, players } = setup();
  const a = players[0].id;
  // 301 → 61 en deux volées
  throwAll(match, a, ['T20', 'T20', 'T20']);   // 121
  throwAll(match, players[1].id, ['MISS', 'MISS', 'MISS']);
  throwAll(match, a, ['T20', 'MISS', 'MISS']); // 61
  throwAll(match, players[1].id, ['MISS', 'MISS', 'MISS']);
  match.throwDart(a, 'T20');                    // 1 → bust (sortie double)
  assert.strictEqual(match.scores[a], 61);
  assert.strictEqual(match.currentPlayer.id, players[1].id);
  assert.strictEqual(match.history[match.history.length - 1].bust, true);
});

test('sortie double : finir sur un simple est un bust', () => {
  const { match, players } = setup({ start: 101 });
  const a = players[0].id;
  throwAll(match, a, ['T17', 'MISS', 'MISS']); // 101 → 50
  throwAll(match, players[1].id, ['MISS', 'MISS', 'MISS']);
  match.throwDart(a, 'S25');                   // 50 - 25 = 25
  match.throwDart(a, 'S25');                   // 0 sur un simple → bust
  assert.strictEqual(match.scores[a], 50);
  assert.strictEqual(match.legWinner, null);
});

test('sortie sur un double : la manche est gagnée', () => {
  const { match, players } = setup({ start: 101, legsToWin: 1 });
  const a = players[0].id;
  throwAll(match, a, ['T17', 'MISS', 'MISS']); // → 50
  throwAll(match, players[1].id, ['MISS', 'MISS', 'MISS']);
  match.throwDart(a, 'D25');
  assert.strictEqual(match.scores[a], 0);
  assert.strictEqual(match.legWinner, a);
  assert.strictEqual(match.matchWinner, a);
  assert.strictEqual(match.status, 'finished');
});

test('manches multiples : le match continue et le premier lanceur tourne', () => {
  const { match, players } = setup({ start: 101, legsToWin: 2 });
  const [a, b] = players.map((p) => p.id);
  throwAll(match, a, ['T17', 'MISS', 'MISS']);
  throwAll(match, b, ['MISS', 'MISS', 'MISS']);
  match.throwDart(a, 'D25');
  assert.strictEqual(match.legWinner, a);
  assert.strictEqual(match.matchWinner, null);
  match.nextLeg();
  assert.strictEqual(match.legNumber, 2);
  assert.strictEqual(match.currentPlayer.id, b);
  assert.strictEqual(match.scores[a], 101);
});

test('double in : rien ne compte avant le premier double', () => {
  const { match, players } = setup({ start: 101, doubleIn: true });
  const a = players[0].id;
  match.throwDart(a, 'T20');
  assert.strictEqual(match.scores[a], 101);
  assert.strictEqual(match.opened[a], false);
  match.throwDart(a, 'D10');
  assert.strictEqual(match.scores[a], 81);
  assert.strictEqual(match.opened[a], true);
  match.throwDart(a, 'S1');
  assert.strictEqual(match.scores[a], 80);
});

test('annuler une fléchette rend les points', () => {
  const { match, players } = setup();
  const a = players[0].id;
  match.throwDart(a, 'T20');
  match.throwDart(a, 'T20');
  match.undoDart(a);
  assert.strictEqual(match.scores[a], 241);
  assert.strictEqual(match.turnDarts.length, 1);
});

test('annuler la dernière volée redonne la main au lanceur', () => {
  const { match, players } = setup();
  const [a, b] = players.map((p) => p.id);
  throwAll(match, a, ['T20', 'T20', 'T20']);
  assert.strictEqual(match.currentPlayer.id, b);
  match.undoTurn(a);
  assert.strictEqual(match.scores[a], 301);
  assert.strictEqual(match.currentPlayer.id, a);
  assert.strictEqual(match.history.length, 0);
});

test('annuler la volée gagnante rouvre le match', () => {
  const { match, players } = setup({ start: 101 });
  const a = players[0].id;
  throwAll(match, a, ['T17', 'MISS', 'MISS']);
  throwAll(match, players[1].id, ['MISS', 'MISS', 'MISS']);
  match.throwDart(a, 'D25');
  assert.strictEqual(match.status, 'finished');
  match.undoTurn(a);
  assert.strictEqual(match.status, 'playing');
  assert.strictEqual(match.matchWinner, null);
  assert.strictEqual(match.legWinner, null);
  assert.strictEqual(match.scores[a], 50);
  assert.strictEqual(match.currentPlayer.id, a);
});

test('limites de joueurs', () => {
  const store = new MatchStore();
  const match = store.create();
  for (let i = 0; i < 5; i++) match.addPlayer(`J${i}`);
  assert.throws(() => match.addPlayer('J6'), /complète/);
  const solo = store.create();
  solo.addPlayer('Seul');
  assert.throws(() => solo.start(), /au moins/);
});

test('reconnexion : le même token retrouve le même joueur', () => {
  const store = new MatchStore();
  const match = store.create();
  const p = match.addPlayer('Alex');
  const again = match.addPlayer('Alex', p.token);
  assert.strictEqual(again.id, p.id);
  assert.strictEqual(match.players.length, 1);
});

test('le snapshot expose les conseils et jamais les tokens', () => {
  const { match, players } = setup({ start: 101 });
  throwAll(match, players[0].id, ['T17', 'MISS', 'MISS']); // → 50
  const snap = match.snapshot();
  assert.ok(!JSON.stringify(snap).includes(players[0].token));
  const first = snap.players.find((p) => p.id === players[0].id);
  assert.deepStrictEqual(first.checkout, ['Bull']);
  assert.strictEqual(first.advice.kind, 'checkout');
  assert.strictEqual(snap.turnPlayerId, players[1].id);
});

test('conseils désactivables par match', () => {
  const { match } = setup();
  match.updateSettings({ advice: 'off' });
  assert.strictEqual(match.snapshot().players[0].advice, null);
});
