'use strict';

/* 301 — client temps réel. Aucune dépendance. */

const $ = (id) => document.getElementById(id);
const el = (sel) => document.querySelector(sel);

const S = {
  code: null,
  token: null,
  playerId: null,
  state: null,
  mult: 'S',
  es: null,
  overlayDismissed: null,
  wasMyTurn: false,
  scoreForAll: false, // un seul téléphone : l'hôte saisit aussi pour les autres
};

const store = {
  get name() { return localStorage.getItem('darts301.name') || ''; },
  set name(v) { localStorage.setItem('darts301.name', v); },
  session(code) {
    try { return JSON.parse(localStorage.getItem(`darts301.s.${code}`) || 'null'); } catch { return null; }
  },
  saveSession(code, data) { localStorage.setItem(`darts301.s.${code}`, JSON.stringify(data)); },
  dropSession(code) { localStorage.removeItem(`darts301.s.${code}`); },
  scoreForAll(code) { return localStorage.getItem(`darts301.all.${code}`) === '1'; },
  setScoreForAll(code, on) { localStorage.setItem(`darts301.all.${code}`, on ? '1' : '0'); },
};

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

async function api(path, { method = 'POST', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function action(name, extra = {}) {
  return api(`/api/matches/${S.code}/action`, { body: { token: S.token, action: name, ...extra } })
    .catch(toastError);
}

function connect() {
  if (S.es) S.es.close();
  S.es = new EventSource(`/api/matches/${S.code}/stream?token=${encodeURIComponent(S.token)}`);
  S.es.addEventListener('state', (ev) => {
    try { render(JSON.parse(ev.data)); } catch (e) { console.error(e); }
  });
  S.es.addEventListener('error', () => { /* EventSource se reconnecte tout seul */ });
}

// ---------------------------------------------------------------------------
// UI de base
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(msg, ok = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('ok', ok);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
const toastError = (e) => toast(e.message || String(e));

function showScreen(name) {
  for (const id of ['screen-home', 'screen-lobby', 'screen-game']) {
    $(id).hidden = id !== `screen-${name}`;
  }
}

function buzz(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignoré */ } }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------
// Entrée dans une partie
// ---------------------------------------------------------------------------

function currentName() {
  const v = $('name-input').value.trim();
  if (v) store.name = v;
  return v || store.name || 'Joueur';
}

async function createMatch() {
  try {
    const data = await api('/api/matches', { body: { name: currentName() } });
    enterMatch(data);
  } catch (e) { toastError(e); }
}

async function joinMatch(code) {
  const c = String(code || $('code-input').value).trim().toUpperCase();
  if (c.length !== 4) return toast('Le code fait 4 caractères.');
  const prev = store.session(c);
  try {
    const data = await api(`/api/matches/${c}/join`, {
      body: { name: currentName(), token: prev ? prev.token : undefined },
    });
    enterMatch(data);
  } catch (e) { toastError(e); }
  return undefined;
}

function enterMatch(data) {
  S.code = data.code;
  S.token = data.token;
  S.playerId = data.playerId;
  store.saveSession(data.code, { token: data.token, playerId: data.playerId });
  S.scoreForAll = store.scoreForAll(data.code);
  history.replaceState(null, '', `/${data.code}`);
  render(data.state);
  connect();
}

function leaveMatch() {
  action('leave');
  if (S.es) S.es.close();
  store.dropSession(S.code);
  S.code = S.token = S.playerId = S.state = null;
  history.replaceState(null, '', '/');
  showScreen('home');
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const avgText = (stats) => (stats.darts ? stats.avg.toFixed(1) : '—');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function me(state) {
  return state.players.find((p) => p.id === S.playerId) || null;
}

function render(state) {
  S.state = state;
  if (state.status === 'lobby') {
    showScreen('lobby');
    renderLobby(state);
  } else {
    showScreen('game');
    renderGame(state);
  }
  renderOverlay(state);
}

// -- salon -------------------------------------------------------------------

function renderLobby(state) {
  const amHost = state.hostId === S.playerId;
  $('lobby-code').textContent = state.code;
  $('lobby-url').textContent = `${location.host}/${state.code}`;
  $('lobby-count').textContent = `${state.players.length}/5`;

  $('lobby-players').innerHTML = state.players.map((p) => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="name">${esc(p.name)}</span>
      ${p.isHost ? '<span class="tag">hôte</span>' : ''}
      ${p.id === S.playerId ? '<span class="tag">toi</span>' : ''}
      ${p.local ? '<span class="tag">même tél.</span>' : ''}
      ${amHost && !p.isHost ? `<button class="kick" data-kick="${p.id}" aria-label="Retirer">✕</button>` : ''}
    </li>`).join('');

  const n = state.players.length;
  $('lobby-hint').textContent = n < 2
    ? 'Partage le code, ou ajoute les joueurs qui marqueront sur ton téléphone.'
    : (amHost ? 'Tout le monde est là ? Lance la partie.' : 'En attente de l’hôte…');

  for (const seg of document.querySelectorAll('#lobby-settings-card .seg')) {
    const key = seg.dataset.setting;
    const value = String(state.settings[key]);
    for (const b of seg.children) b.classList.toggle('on', b.dataset.value === value);
    seg.dataset.disabled = amHost ? '0' : '1';
  }

  $('add-player-row').hidden = !amHost || n >= 5;
  $('btn-start').disabled = !amHost || n < 2;
  $('btn-start').textContent = n < 2 ? 'Il manque des joueurs' : 'Lancer la partie';
  $('btn-shuffle').hidden = !amHost || n < 2;
}

// -- partie ------------------------------------------------------------------

function renderGame(state) {
  const mine = me(state);
  const myTurn = state.turnPlayerId === S.playerId;
  const amHost = state.hostId === S.playerId;
  // je saisis si c'est mon tour, ou si je tiens le téléphone pour tout le monde
  const scoring = myTurn || (amHost && S.scoreForAll);

  $('game-leg').textContent = state.legsToWin > 1
    ? `Manche ${state.legNumber} · au meilleur des ${state.legsToWin * 2 - 1}`
    : `Manche ${state.legNumber}`;
  $('game-mode').textContent = [
    state.settings.start,
    state.settings.doubleIn ? 'double in' : null,
    state.settings.doubleOut ? 'double out' : 'sortie simple',
  ].filter(Boolean).join(' · ');
  $('game-code').textContent = state.code;

  renderScoreboard(state);
  renderTurnPanel(state, myTurn, scoring);
  renderAdvice(state, mine, myTurn, scoring);
  renderKeypad(state, scoring, amHost);
  renderFeed(state);

  if (myTurn && !S.wasMyTurn) { buzz(70); }
  if (state.lastEvent && state.lastEvent.type === 'bust' && state.lastEvent.playerId === S.playerId) buzz([40, 60, 40]);
  S.wasMyTurn = myTurn;
  $('menu-advice').textContent = { off: 'aucun', checkout: 'finish', full: 'complet' }[state.settings.advice];
  $('menu-scorer').textContent = S.scoreForAll ? 'oui' : 'non';
  el('button[data-menu="scorer"]').hidden = !amHost;
}

function renderScoreboard(state) {
  $('scoreboard').innerHTML = state.players.map((p) => {
    const isTurn = p.id === state.turnPlayerId;
    const legs = Array.from({ length: state.legsToWin }, (_, i) => `<i class="${i < p.legsWon ? 'won' : ''}"></i>`).join('');
    const last = p.stats.lastTurn;
    const check = p.checkout.length ? `<span class="sb-check">${p.checkout.join(' ')}</span>` : '';
    return `
      <li class="sb ${isTurn ? 'turn' : ''} ${p.id === S.playerId ? 'me' : ''} ${p.connected ? '' : 'out'}">
        <span class="stripe" style="background:${p.color}"></span>
        <div class="sb-main">
          <div class="sb-name">${esc(p.name)} ${!p.opened ? '<span class="tag">à ouvrir</span>' : ''}</div>
          <div class="sb-meta">
            <span>moy. ${avgText(p.stats)}</span>
            <span>${last ? (last.bust ? 'bust' : `dernière ${last.scored}`) : '—'}</span>
            ${check}
          </div>
        </div>
        <div class="sb-score">
          <b>${p.score}</b>
          ${state.legsToWin > 1 ? `<div class="sb-legs">${legs}</div>` : ''}
        </div>
      </li>`;
  }).join('');
}

function renderTurnPanel(state, myTurn, scoring) {
  const thrower = state.players.find((p) => p.id === state.turnPlayerId);
  if (!thrower) { $('turn-panel').innerHTML = ''; return; }
  const rest = `${plural(state.dartsLeft, 'fléchette', 'fléchettes')} restante${state.dartsLeft > 1 ? 's' : ''}`;
  let head;
  if (myTurn) head = `🎯 À toi de jouer — ${thrower.score} points`;
  else if (scoring) head = `🖊 Tu saisis pour <b>${esc(thrower.name)}</b> — ${thrower.score}`;
  else head = `Au tour de <b>${esc(thrower.name)}</b> — ${thrower.score}`;
  $('turn-panel').innerHTML = `<div class="turn-banner ${myTurn ? '' : 'other'}">
      <span>${head}</span><span class="rest">${rest}</span></div>`;
}

function renderAdvice(state, mine, myTurn, scoring) {
  const box = $('advice');
  const thrower = state.players.find((p) => p.id === state.turnPlayerId);
  const focus = scoring && thrower ? thrower : mine;
  const advice = focus ? focus.advice : null;
  if (!advice || !focus) { box.hidden = true; return; }
  box.hidden = false;
  let kicker;
  if (myTurn) kicker = `Conseil · fléchette ${4 - state.dartsLeft}/3`;
  else if (scoring) kicker = `Conseil pour ${focus.name} · fléchette ${4 - state.dartsLeft}/3`;
  else kicker = 'À ton prochain tour';
  const route = advice.kind === 'checkout' ? advice.path : advice.leaveCheckout;
  const path = route && route.length > 1
    ? `<div class="advice-path">${route.map((s) => `<span>${s}</span>`).join('')}</div>`
    : '';
  box.innerHTML = `
    <div class="advice-kicker">${kicker}</div>
    <div class="advice-main">${esc(advice.headline)}</div>
    <div class="advice-sub">${esc(advice.detail)}</div>
    ${path}`;
}

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);
const QUICK = [
  { id: 'T20', label: 'T20' }, { id: 'T19', label: 'T19' }, { id: 'T18', label: 'T18' },
  { id: 'D20', label: 'D20' }, { id: 'D16', label: 'D16' }, { id: 'D25', label: 'Bull' },
];

function buildKeypad() {
  $('quick-row').innerHTML = QUICK.map((q) => `<button data-seg="${q.id}">${q.label}</button>`).join('');
  $('number-grid').innerHTML = [
    ...NUMBERS.map((n) => `<button data-num="${n}">${n}</button>`),
    '<button data-seg="S25" class="wide">25</button>',
    '<button data-seg="D25" class="bull">BULL 50</button>',
    '<button data-seg="MISS" class="miss">RATÉ</button>',
  ].join('');
}

function renderKeypad(state, scoring, amHost) {
  const pad = $('keypad');
  const wait = $('waiting');
  const active = scoring && !state.legWinner && state.status === 'playing';
  pad.hidden = !active;
  wait.hidden = active;
  const thrower = state.players.find((p) => p.id === state.turnPlayerId);

  const banner = $('keypad-for');
  if (thrower && state.turnPlayerId !== S.playerId) {
    banner.hidden = false;
    banner.innerHTML = `<span class="dot" style="background:${thrower.color}"></span>
      Saisie pour <b>${esc(thrower.name)}</b>`;
  } else {
    banner.hidden = true;
  }

  if (active) {
    const slots = [0, 1, 2].map((i) => {
      const d = state.turnDarts[i];
      if (!d) return '<span class="slot">·</span>';
      return `<span class="slot filled ${d.value === 0 ? 'zero' : ''}">${d.label}</span>`;
    }).join('');
    $('keypad-darts').innerHTML = slots;
    $('btn-undo-dart').disabled = state.turnDarts.length === 0;
    for (const b of $('mult-row').children) b.classList.toggle('on', b.dataset.mult === S.mult);
  } else if (state.status === 'playing') {
    const thrower = state.players.find((p) => p.id === state.turnPlayerId);
    const live = state.turnDarts.map((d) => `<span>${d.label}</span>`).join('');
    const takeOver = amHost && !state.legWinner
      ? `<button class="btn" id="btn-take-over">🖊 Saisir pour ${esc(thrower ? thrower.name : '')}</button>`
      : '';
    wait.innerHTML = state.legWinner
      ? '<b>Manche terminée</b>'
      : `<div>Saisie en cours par <b>${esc(thrower ? thrower.name : '…')}</b></div>
         <div class="live">${live || '<span>—</span>'}</div>${takeOver}`;
  }
}

function renderFeed(state) {
  $('feed').innerHTML = state.feed.map((f) => {
    const p = state.players.find((x) => x.id === f.playerId);
    return `<li>
      <span class="who" style="color:${p ? p.color : 'inherit'}">${esc(p ? p.name : '?')}</span>
      <span class="darts-list">${f.darts.join(' · ')}</span>
      ${f.bust ? '<span class="bust">BUST</span>' : `<span class="pts">${f.scored}</span>`}
      <span class="darts-list" style="flex:none">→ ${f.after}</span>
    </li>`;
  }).join('') || '<li class="darts-list">Rien encore.</li>';
}

// -- fin de manche / de match ------------------------------------------------

function renderOverlay(state) {
  const key = state.matchWinner ? `match:${state.matchWinner}`
    : (state.legWinner ? `leg:${state.legNumber}:${state.legWinner}` : null);
  if (!key || S.overlayDismissed === key) { $('overlay').hidden = true; return; }

  const winner = state.players.find((p) => p.id === (state.matchWinner || state.legWinner));
  const isMatch = Boolean(state.matchWinner);
  const amHost = state.hostId === S.playerId;

  $('overlay').hidden = false;
  $('overlay-emoji').textContent = isMatch ? '🏆' : '🎯';
  $('overlay-title').textContent = winner
    ? (winner.id === S.playerId ? 'Tu gagnes !' : `${winner.name} gagne !`)
    : 'Terminé';
  const runnerUp = Math.max(0, ...state.players
    .filter((p) => p.id !== (winner || {}).id).map((p) => p.legsWon));
  $('overlay-sub').textContent = isMatch
    ? `Match remporté ${plural(winner ? winner.legsWon : 0, 'manche', 'manches')} à ${runnerUp}.`
    : `Manche ${state.legNumber} remportée.`;

  $('overlay-stats').innerHTML = [...state.players]
    .sort((a, b) => b.stats.avg - a.stats.avg)
    .map((p) => `<li><span>${esc(p.name)}</span><span class="v">moy. ${avgText(p.stats)} · meilleure ${p.stats.best} · ${plural(p.stats.darts, 'fléchette', 'fléchettes')}</span></li>`)
    .join('');

  $('btn-next-leg').hidden = isMatch || !amHost;
  $('btn-rematch').hidden = !isMatch || !amHost;
  if (winner && winner.id === S.playerId) buzz([60, 50, 60, 50, 120]);
}

// ---------------------------------------------------------------------------
// Évènements
// ---------------------------------------------------------------------------

function wire() {
  buildKeypad();

  $('name-input').value = store.name;
  $('btn-create').onclick = createMatch;
  $('btn-join').onclick = () => joinMatch();
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinMatch(); });
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('code-input').focus(); });

  $('btn-share').onclick = async () => {
    const url = `${location.origin}/${S.code}`;
    const text = `Rejoins ma partie de 301 — code ${S.code} : ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: '301 — Fléchettes', text, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié !', true); }
    } catch { /* partage annulé */ }
  };

  $('lobby-players').addEventListener('click', (e) => {
    const id = e.target.dataset.kick;
    if (id) action('kick', { playerId: id });
  });

  el('#lobby-settings-card').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    const key = btn.parentElement.dataset.setting;
    let value = btn.dataset.value;
    if (value === 'true' || value === 'false') value = value === 'true';
    else if (/^\d+$/.test(value)) value = Number(value);
    action('settings', { settings: { ...S.state.settings, [key]: value } });
  });

  const addPlayer = () => {
    const name = $('add-player-name').value.trim();
    if (!name) return;
    $('add-player-name').value = '';
    action('add-player', { name });
  };
  $('btn-add-player').onclick = addPlayer;
  $('add-player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });

  $('waiting').addEventListener('click', (e) => {
    if (!e.target.closest('#btn-take-over')) return;
    S.scoreForAll = true;
    store.setScoreForAll(S.code, true);
    render(S.state);
  });

  $('btn-start').onclick = () => action('start');
  $('btn-shuffle').onclick = () => action('shuffle');
  $('btn-leave-lobby').onclick = leaveMatch;

  $('mult-row').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mult]');
    if (!b) return;
    S.mult = b.dataset.mult;
    for (const x of $('mult-row').children) x.classList.toggle('on', x === b);
  });

  const throwSeg = (segId) => {
    S.mult = 'S';
    const target = S.state && S.state.turnPlayerId;
    action('throw', { segment: segId, playerId: target !== S.playerId ? target : undefined });
  };
  $('quick-row').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-seg]');
    if (b) throwSeg(b.dataset.seg);
  });
  $('number-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.seg) throwSeg(b.dataset.seg);
    else if (b.dataset.num) throwSeg(`${S.mult}${b.dataset.num}`);
  });
  $('btn-undo-dart').onclick = () => action('undo-dart');

  $('btn-menu').onclick = () => { $('menu').hidden = !$('menu').hidden; };
  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-menu]');
    if (!b) return;
    $('menu').hidden = true;
    switch (b.dataset.menu) {
      case 'undo-turn': action('undo-turn'); break;
      case 'advice': {
        const order = ['off', 'checkout', 'full'];
        const next = order[(order.indexOf(S.state.settings.advice) + 1) % order.length];
        action('settings', { settings: { ...S.state.settings, advice: next } });
        break;
      }
      case 'scorer':
        S.scoreForAll = !S.scoreForAll;
        store.setScoreForAll(S.code, S.scoreForAll);
        render(S.state);
        break;
      case 'lobby': action('lobby'); break;
      case 'leave': leaveMatch(); break;
      default: break;
    }
  });

  $('btn-next-leg').onclick = () => { S.overlayDismissed = null; action('next-leg'); };
  $('btn-rematch').onclick = () => { S.overlayDismissed = null; action('rematch'); };
  $('btn-overlay-close').onclick = () => {
    const st = S.state;
    S.overlayDismissed = st.matchWinner ? `match:${st.matchWinner}` : `leg:${st.legNumber}:${st.legWinner}`;
    $('overlay').hidden = true;
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.code && (!S.es || S.es.readyState === 2)) connect();
  });
}

async function boot() {
  wire();
  const codeFromUrl = (location.pathname.replace(/\//g, '') || '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(codeFromUrl)) {
    const sess = store.session(codeFromUrl);
    $('code-input').value = codeFromUrl;
    if (sess && store.name) {
      await joinMatch(codeFromUrl);
      return;
    }
    showScreen('home');
    $('name-input').focus();
    return;
  }
  showScreen('home');
}

boot();
