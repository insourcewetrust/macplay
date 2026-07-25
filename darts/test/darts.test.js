'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { checkout, canCheckout, advise, leaveQuality } = require('../lib/darts');

const route = (score, darts = 3, doubleOut = true) => {
  const path = checkout(score, darts, doubleOut);
  return path ? path.map((s) => s.label).join(' ') : null;
};

test('sorties classiques en 3 fléchettes', () => {
  assert.strictEqual(route(170), 'T20 T20 Bull');
  assert.strictEqual(route(167), 'T20 T19 Bull');
  assert.strictEqual(route(164), 'T20 T18 Bull');
  assert.strictEqual(route(161), 'T20 T17 Bull');
  assert.strictEqual(route(160), 'T20 T20 D20');
  assert.strictEqual(route(141), 'T20 T19 D12');
});

test('sorties en 2 fléchettes et sortie directe', () => {
  assert.strictEqual(route(100), 'T20 D20');
  assert.strictEqual(route(96), 'T20 D18');
  assert.strictEqual(route(81), 'T19 D12');
  assert.strictEqual(route(40), 'D20');
  assert.strictEqual(route(32), 'D16');
  assert.strictEqual(route(50), 'Bull');
});

test('la dernière fléchette est toujours un double en sortie double', () => {
  for (let s = 2; s <= 170; s++) {
    const path = checkout(s, 3, true);
    if (!path) continue;
    const last = path[path.length - 1];
    assert.ok(last.ring === 'D', `sortie de ${s} sur ${last.label}`);
    assert.strictEqual(path.reduce((a, x) => a + x.value, 0), s);
  }
});

test('les bogey numbers ne sortent pas en 3 fléchettes', () => {
  for (const s of [169, 168, 166, 165, 163, 162, 159]) {
    assert.strictEqual(canCheckout(s, 3, true), false, `${s} ne devrait pas sortir`);
  }
  assert.strictEqual(canCheckout(171, 3, true), false);
  assert.strictEqual(canCheckout(1, 3, true), false);
});

test('sortie simple : on peut finir sur n’importe quel segment', () => {
  assert.strictEqual(canCheckout(1, 1, false), true);
  assert.strictEqual(canCheckout(180, 3, false), true);
  assert.strictEqual(route(20, 1, false), '20');
  assert.strictEqual(route(60, 1, false), 'T20');
});

test('conseil : finish quand il est disponible', () => {
  const a = advise(100, 3, true);
  assert.strictEqual(a.kind, 'checkout');
  assert.strictEqual(a.target.id, 'T20');
  assert.deepStrictEqual(a.path.map((s) => s.label), ['T20', 'D20']);
});

test('conseil : placement sur la dernière fléchette', () => {
  const a = advise(66, 1, true);
  assert.strictEqual(a.kind, 'setup');
  assert.ok(a.leave <= 40 && a.leave % 2 === 0, `laisse ${a.leave}`);
  assert.ok(a.leaveCheckout.length === 1);
});

test('conseil : ne jamais laisser 1 point en sortie double', () => {
  for (let score = 42; score <= 180; score++) {
    for (const darts of [1, 2, 3]) {
      const a = advise(score, darts, true);
      if (a.kind === 'setup') assert.notStrictEqual(a.leave, 1, `${score} en ${darts} fléchettes`);
    }
  }
});

test('conseil : gros score → on tape dans les 60', () => {
  const a = advise(250, 3, true);
  assert.strictEqual(a.kind, 'setup');
  assert.ok(a.target.value >= 57, `cible ${a.target.label}`);
});

test('qualité de reliquat : 32 vaut mieux que 1 ou 169', () => {
  assert.ok(leaveQuality(32) > leaveQuality(50));
  assert.ok(leaveQuality(40) > leaveQuality(37));
  assert.ok(leaveQuality(100) > leaveQuality(169));
  assert.ok(leaveQuality(1) < 0);
});
