'use strict';

const crypto = require('crypto');
const {
  segment, isDouble, checkout, advise, adviseTurn,
} = require('./darts');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1
const MAX_PLAYERS = 5;
const MIN_PLAYERS = 2;
const DARTS_PER_TURN = 3;
const COLORS = ['#ff5c5c', '#4ea8ff', '#3ddc84', '#ffb648', '#c078ff'];

function newCode() {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
  return n || 'Joueur';
}

function defaultSettings() {
  return {
    start: 301,
    doubleOut: true,
    doubleIn: false,
    legsToWin: 1,
    advice: 'full', // 'full' | 'checkout' | 'off'
  };
}

function sanitizeSettings(raw, base = defaultSettings()) {
  const s = { ...base };
  if (raw && typeof raw === 'object') {
    if ([101, 301, 501, 701].includes(Number(raw.start))) s.start = Number(raw.start);
    if (typeof raw.doubleOut === 'boolean') s.doubleOut = raw.doubleOut;
    if (typeof raw.doubleIn === 'boolean') s.doubleIn = raw.doubleIn;
    if ([1, 2, 3, 5].includes(Number(raw.legsToWin))) s.legsToWin = Number(raw.legsToWin);
    if (['full', 'checkout', 'off'].includes(raw.advice)) s.advice = raw.advice;
  }
  return s;
}

class Match {
  constructor(code, settings) {
    this.code = code;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.rev = 0;
    this.settings = sanitizeSettings(settings);
    this.players = [];
    this.hostId = null;
    this.status = 'lobby'; // lobby | playing | finished
    this.legNumber = 0;
    this.startingIndex = 0;
    this.turnIndex = 0;
    this.scores = {};
    this.opened = {};
    this.legsWon = {};
    this.turnDarts = [];
    this.turnStartScore = 0;
    this.history = []; // volées terminées, toutes manches confondues
    this.legWinner = null;
    this.matchWinner = null;
    this.lastEvent = null;
  }

  // -- joueurs -------------------------------------------------------------

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  playerByToken(token) {
    return this.players.find((p) => p.token === token) || null;
  }

  addPlayer(name, token) {
    if (token) {
      const existing = this.playerByToken(token);
      if (existing) {
        existing.connected = true;
        if (name) existing.name = cleanName(name);
        return existing;
      }
    }
    if (this.players.length >= MAX_PLAYERS) {
      throw new HttpError(409, `La partie est complète (${MAX_PLAYERS} joueurs maximum).`);
    }
    if (this.status !== 'lobby') {
      throw new HttpError(409, 'La partie a déjà commencé.');
    }
    const p = {
      id: newId(),
      token: token || newToken(),
      name: cleanName(name),
      connected: true,
      joinedAt: Date.now(),
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.scores[p.id] = this.settings.start;
    this.legsWon[p.id] = 0;
    this.opened[p.id] = !this.settings.doubleIn;
    return p;
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    if (this.status === 'lobby') {
      this.players.splice(idx, 1);
      delete this.scores[id];
      delete this.legsWon[id];
      delete this.opened[id];
      if (this.hostId === id) this.hostId = this.players[0]?.id ?? null;
      if (this.turnIndex >= this.players.length) this.turnIndex = 0;
    } else {
      // en cours de partie on garde le joueur (score, historique) mais on le marque absent
      const p = this.players[idx];
      p.connected = false;
    }
  }

  // -- déroulement ---------------------------------------------------------

  get currentPlayer() {
    return this.players[this.turnIndex] || null;
  }

  get dartsLeft() {
    return DARTS_PER_TURN - this.turnDarts.length;
  }

  start() {
    if (this.players.length < MIN_PLAYERS) {
      throw new HttpError(400, `Il faut au moins ${MIN_PLAYERS} joueurs.`);
    }
    this.status = 'playing';
    this.legNumber = 1;
    this.startingIndex = 0;
    this.history = [];
    for (const p of this.players) this.legsWon[p.id] = 0;
    this.matchWinner = null;
    this.beginLeg(this.startingIndex);
    this.lastEvent = { type: 'start' };
  }

  beginLeg(startingIndex) {
    this.legWinner = null;
    this.turnIndex = startingIndex % this.players.length;
    this.turnDarts = [];
    for (const p of this.players) {
      this.scores[p.id] = this.settings.start;
      this.opened[p.id] = !this.settings.doubleIn;
    }
    this.turnStartScore = this.scores[this.currentPlayer.id];
  }

  nextLeg() {
    if (this.status !== 'playing' || !this.legWinner) {
      throw new HttpError(409, 'Aucune manche à enchaîner.');
    }
    if (this.matchWinner) throw new HttpError(409, 'Le match est terminé.');
    this.legNumber += 1;
    this.startingIndex = (this.startingIndex + 1) % this.players.length;
    this.beginLeg(this.startingIndex);
    this.lastEvent = { type: 'leg-start', legNumber: this.legNumber };
  }

  throwDart(playerId, segId) {
    if (this.status !== 'playing') throw new HttpError(409, 'La partie n’est pas en cours.');
    if (this.legWinner) throw new HttpError(409, 'La manche est terminée.');
    const current = this.currentPlayer;
    if (!current || current.id !== playerId) {
      throw new HttpError(403, 'Ce n’est pas ton tour.');
    }
    const seg = segment(segId);
    const before = this.scores[playerId];

    let counted = true;
    let value = seg.value;
    if (this.settings.doubleIn && !this.opened[playerId]) {
      if (isDouble(seg)) {
        this.opened[playerId] = true;
      } else {
        counted = false;
        value = 0;
      }
    }

    const after = before - value;
    let bust = false;
    let win = false;

    if (counted) {
      if (after < 0) bust = true;
      else if (this.settings.doubleOut && after === 1) bust = true;
      else if (after === 0 && this.settings.doubleOut && !isDouble(seg)) bust = true;
      else if (after === 0) win = true;
    }

    this.turnDarts.push({ segId: seg.id, label: seg.label, value: counted ? value : 0, counted, bust });
    if (!bust) this.scores[playerId] = after;

    if (bust) {
      this.scores[playerId] = this.turnStartScore;
      this.commitTurn({ bust: true });
    } else if (win) {
      this.commitTurn({ win: true });
      this.finishLeg(playerId, seg);
    } else if (this.turnDarts.length >= DARTS_PER_TURN) {
      this.commitTurn({});
    } else {
      this.lastEvent = { type: 'dart', playerId, segId: seg.id, value };
    }
  }

  commitTurn({ bust = false, win = false }) {
    const playerId = this.currentPlayer.id;
    const scored = bust ? 0 : this.turnDarts.reduce((a, d) => a + d.value, 0);
    this.history.push({
      legNumber: this.legNumber,
      playerId,
      darts: this.turnDarts.map((d) => ({ segId: d.segId, label: d.label, value: d.value })),
      scored,
      bust,
      win,
      before: this.turnStartScore,
      after: this.scores[playerId],
      ts: Date.now(),
    });
    this.lastEvent = { type: bust ? 'bust' : 'turn', playerId, scored };
    this.turnDarts = [];
    if (!win) this.advanceTurn();
  }

  advanceTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    this.turnStartScore = this.scores[this.currentPlayer.id];
  }

  finishLeg(playerId, finishSeg) {
    this.legWinner = playerId;
    this.legsWon[playerId] = (this.legsWon[playerId] || 0) + 1;
    this.lastEvent = { type: 'leg-win', playerId, segId: finishSeg.id };
    if (this.legsWon[playerId] >= this.settings.legsToWin) {
      this.matchWinner = playerId;
      this.status = 'finished';
      this.lastEvent = { type: 'match-win', playerId };
    }
  }

  undoDart(playerId) {
    if (this.status !== 'playing') throw new HttpError(409, 'La partie n’est pas en cours.');
    if (this.turnDarts.length === 0) throw new HttpError(409, 'Aucune fléchette à annuler.');
    const current = this.currentPlayer;
    if (current.id !== playerId && this.hostId !== playerId) {
      throw new HttpError(403, 'Seul le lanceur (ou l’hôte) peut annuler.');
    }
    const removed = this.turnDarts.pop();
    this.scores[current.id] += removed.value;
    if (this.settings.doubleIn && removed.counted && isDouble(segment(removed.segId))) {
      const stillOpen = this.turnDarts.some((d) => d.counted && isDouble(segment(d.segId)));
      const openedEarlier = this.history.some(
        (h) => h.legNumber === this.legNumber && h.playerId === current.id
          && h.darts.some((d) => d.value > 0),
      );
      if (!stillOpen && !openedEarlier) this.opened[current.id] = false;
    }
    this.lastEvent = { type: 'undo-dart', playerId: current.id };
  }

  /** Annule la dernière volée terminée (et revient au joueur concerné). */
  undoTurn(playerId) {
    if (this.status === 'lobby') throw new HttpError(409, 'La partie n’a pas commencé.');
    const last = this.history[this.history.length - 1];
    if (!last) throw new HttpError(409, 'Aucune volée à annuler.');
    if (playerId !== this.hostId && playerId !== last.playerId) {
      throw new HttpError(403, 'Seul l’hôte ou le lanceur peut annuler la volée.');
    }
    if (this.turnDarts.length > 0) {
      // on annule d'abord la volée en cours
      const current = this.currentPlayer;
      this.scores[current.id] = this.turnStartScore;
      this.turnDarts = [];
    }
    this.history.pop();

    if (last.win) {
      this.legsWon[last.playerId] = Math.max(0, (this.legsWon[last.playerId] || 1) - 1);
      this.legWinner = null;
      if (this.matchWinner === last.playerId) {
        this.matchWinner = null;
        this.status = 'playing';
      }
    }

    this.legNumber = last.legNumber;
    this.scores[last.playerId] = last.before;
    this.turnIndex = this.players.findIndex((p) => p.id === last.playerId);
    if (this.turnIndex < 0) this.turnIndex = 0;
    this.turnStartScore = last.before;
    if (this.settings.doubleIn) {
      const opened = this.history.some(
        (h) => h.legNumber === this.legNumber && h.playerId === last.playerId
          && h.darts.some((d) => d.value > 0),
      );
      this.opened[last.playerId] = opened;
    }
    this.lastEvent = { type: 'undo-turn', playerId: last.playerId };
  }

  backToLobby() {
    this.status = 'lobby';
    this.legNumber = 0;
    this.legWinner = null;
    this.matchWinner = null;
    this.turnDarts = [];
    this.history = [];
    this.turnIndex = 0;
    for (const p of this.players) {
      this.scores[p.id] = this.settings.start;
      this.legsWon[p.id] = 0;
      this.opened[p.id] = !this.settings.doubleIn;
    }
    this.lastEvent = { type: 'lobby' };
  }

  rematch() {
    this.backToLobby();
    this.start();
    this.lastEvent = { type: 'rematch' };
  }

  shufflePlayers() {
    if (this.status !== 'lobby') throw new HttpError(409, 'Impossible en cours de partie.');
    for (let i = this.players.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    }
    this.lastEvent = { type: 'shuffle' };
  }

  updateSettings(raw) {
    if (this.status !== 'lobby') {
      // en cours de partie on n'autorise que le réglage des conseils
      const next = sanitizeSettings({ ...this.settings, ...raw }, this.settings);
      this.settings.advice = next.advice;
      return;
    }
    this.settings = sanitizeSettings(raw, this.settings);
    for (const p of this.players) {
      this.scores[p.id] = this.settings.start;
      this.opened[p.id] = !this.settings.doubleIn;
    }
  }

  // -- statistiques --------------------------------------------------------

  statsFor(playerId, { legOnly = false } = {}) {
    const turns = this.history.filter(
      (h) => h.playerId === playerId && (!legOnly || h.legNumber === this.legNumber),
    );
    let darts = 0;
    let points = 0;
    let best = 0;
    let tons = 0;
    for (const t of turns) {
      darts += t.darts.length;
      points += t.scored;
      if (t.scored > best) best = t.scored;
      if (t.scored >= 100) tons += 1;
    }
    return {
      turns: turns.length,
      darts,
      points,
      best,
      tons,
      avg: darts ? Number(((points / darts) * 3).toFixed(1)) : 0,
      lastTurn: turns.length ? turns[turns.length - 1] : null,
    };
  }

  adviceFor(score, dartsLeft) {
    if (this.settings.advice === 'off') return null;
    const a = dartsLeft >= 3 ? adviseTurn(score, this.settings.doubleOut)
      : advise(score, dartsLeft, this.settings.doubleOut);
    if (!a || a.kind === 'none') return null;
    if (this.settings.advice === 'checkout' && a.kind !== 'checkout') return null;
    return {
      kind: a.kind,
      target: a.target
        ? { id: a.target.id, label: a.target.label, spoken: a.target.spoken, value: a.target.value }
        : null,
      path: a.path ? a.path.map((s) => s.label) : null,
      leave: a.leave,
      leaveCheckout: a.leaveCheckout ? a.leaveCheckout.map((s) => s.label) : null,
      headline: a.headline,
      detail: a.detail,
      text: a.text,
    };
  }

  // -- sérialisation -------------------------------------------------------

  snapshot() {
    const current = this.currentPlayer;
    const dartsLeft = this.dartsLeft;
    return {
      code: this.code,
      rev: this.rev,
      status: this.status,
      settings: { ...this.settings },
      hostId: this.hostId,
      legNumber: this.legNumber,
      legsToWin: this.settings.legsToWin,
      turnPlayerId: this.status === 'playing' && !this.legWinner ? current?.id ?? null : null,
      dartsLeft,
      turnDarts: this.turnDarts.map((d) => ({ label: d.label, value: d.value, counted: d.counted })),
      turnStartScore: this.turnStartScore,
      legWinner: this.legWinner,
      matchWinner: this.matchWinner,
      lastEvent: this.lastEvent,
      players: this.players.map((p, i) => {
        const score = this.scores[p.id] ?? this.settings.start;
        const stats = this.statsFor(p.id);
        const isTurn = this.status === 'playing' && !this.legWinner && current?.id === p.id;
        return {
          id: p.id,
          name: p.name,
          color: COLORS[i % COLORS.length],
          connected: p.connected,
          isHost: p.id === this.hostId,
          score,
          opened: this.opened[p.id] ?? true,
          legsWon: this.legsWon[p.id] ?? 0,
          stats,
          checkout: this.status === 'playing'
            ? (checkout(score, isTurn ? dartsLeft : 3, this.settings.doubleOut) || []).map((s) => s.label)
            : [],
          advice: this.status === 'playing' && !this.legWinner
            ? this.adviceFor(score, isTurn ? dartsLeft : 3)
            : null,
        };
      }),
      feed: this.history.slice(-12).reverse().map((h) => ({
        playerId: h.playerId,
        legNumber: h.legNumber,
        darts: h.darts.map((d) => d.label),
        scored: h.scored,
        bust: h.bust,
        win: h.win,
        after: h.after,
      })),
    };
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class MatchStore {
  constructor({ ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    this.matches = new Map();
    this.ttlMs = ttlMs;
  }

  create(settings) {
    let code = newCode();
    while (this.matches.has(code)) code = newCode();
    const match = new Match(code, settings);
    this.matches.set(code, match);
    return match;
  }

  get(code) {
    const match = this.matches.get(String(code || '').toUpperCase());
    if (!match) throw new HttpError(404, 'Partie introuvable — vérifie le code.');
    return match;
  }

  sweep(now = Date.now()) {
    for (const [code, m] of this.matches) {
      if (now - m.updatedAt > this.ttlMs) this.matches.delete(code);
    }
  }
}

module.exports = {
  Match, MatchStore, HttpError, defaultSettings, sanitizeSettings,
  MAX_PLAYERS, MIN_PLAYERS, DARTS_PER_TURN, COLORS, newToken, cleanName,
};
