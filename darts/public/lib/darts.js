/**
 * Moteur de fléchettes : segments, règles de sortie et conseils de stratégie.
 *
 * Tout est pur (pas d'état global mutable hors caches de calcul) : le même fichier
 * sert au serveur Node et au navigateur (y compris hors ligne dans l'APK).
 */

(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    global.Darts301 = global.Darts301 || {};
    global.Darts301.darts = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

/** @typedef {{id: string, label: string, value: number, ring: 'S'|'D'|'T'|'MISS', number: number}} Segment */

/** @type {Segment[]} */
const SEGMENTS = [];

SEGMENTS.push({ id: 'MISS', label: 'Raté', spoken: 'raté', value: 0, ring: 'MISS', number: 0 });
for (let n = 1; n <= 20; n++) {
  SEGMENTS.push({ id: `S${n}`, label: `${n}`, spoken: `le ${n}`, value: n, ring: 'S', number: n });
  SEGMENTS.push({ id: `D${n}`, label: `D${n}`, spoken: `double ${n}`, value: n * 2, ring: 'D', number: n });
  SEGMENTS.push({ id: `T${n}`, label: `T${n}`, spoken: `triple ${n}`, value: n * 3, ring: 'T', number: n });
}
SEGMENTS.push({ id: 'S25', label: '25', spoken: 'le 25', value: 25, ring: 'S', number: 25 });
SEGMENTS.push({ id: 'D25', label: 'Bull', spoken: 'le bull', value: 50, ring: 'D', number: 25 });

const SEGMENT_BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));

/** Segments réellement jouables comme cible (on ne « vise » jamais un raté). */
const TARGETS = SEGMENTS.filter((s) => s.value > 0);

/** Nombres impossibles à terminer en 3 fléchettes avec sortie double. */
const BOGEY_NUMBERS = new Set([169, 168, 166, 165, 163, 162, 159]);

/**
 * Ordre de préférence des doubles de sortie (le premier est le plus confortable).
 * D20/D16 d'abord — on peut se rattraper en cas de raté ; D2/D1 en dernier —
 * une fléchette trop courte laisse 1 point, c'est-à-dire rien.
 */
const DOUBLE_PREFERENCE = [
  'D20', 'D16', 'D18', 'D12', 'D10', 'D8', 'D14', 'D6', 'D4', 'D19',
  'D17', 'D13', 'D25', 'D15', 'D11', 'D9', 'D7', 'D5', 'D3', 'D2', 'D1',
];
const DOUBLE_RANK = new Map(DOUBLE_PREFERENCE.map((id, i) => [id, i]));

function segment(id) {
  const s = SEGMENT_BY_ID.get(id);
  if (!s) throw new Error(`Segment inconnu : ${id}`);
  return s;
}

function isDouble(seg) {
  return seg.ring === 'D';
}

// ---------------------------------------------------------------------------
// Recherche de finish (checkout)
// ---------------------------------------------------------------------------

/**
 * Difficulté d'une cible pour un joueur amateur : un simple est une grosse zone,
 * un triple/double est une lame de 8 mm. Sert à choisir la route la moins risquée
 * à nombre de fléchettes égal (la somme des points, elle, est imposée par le score).
 */
function difficulty(seg) {
  if (seg.id === 'D25') return 12;
  if (seg.id === 'S25') return 9;
  if (seg.ring === 'T') return seg.number >= 16 ? 6 + (20 - seg.number) * 0.5 : 13;
  if (seg.ring === 'D') return 16;
  return seg.number >= 16 ? 0 : 2;
}

/** Coût de la fléchette de sortie : D20 / D16 en sortie double, grosse zone en sortie simple. */
function finishCost(seg, doubleOut) {
  if (!doubleOut) {
    if (seg.ring === 'S') return 0;
    return seg.ring === 'D' ? 4 : 6;
  }
  const rank = DOUBLE_RANK.has(seg.id) ? DOUBLE_RANK.get(seg.id) : 24;
  return 16 + rank * 1.2;
}

const checkoutCache = new Map();

/**
 * Meilleur chemin de sortie pour `score` en au plus `darts` fléchettes.
 * @returns {Segment[]|null} le chemin (ordre de lancer) ou null si impossible.
 */
function checkout(score, darts, doubleOut = true) {
  if (!Number.isInteger(score) || score <= 0 || darts <= 0) return null;
  const key = `${score}|${darts}|${doubleOut ? 1 : 0}`;
  const cached = checkoutCache.get(key);
  if (cached !== undefined) return cached;

  let best = null;
  let bestCost = Infinity;

  // Sortie en une fléchette.
  for (const seg of TARGETS) {
    if (seg.value !== score) continue;
    if (doubleOut && !isDouble(seg)) continue;
    const cost = 1000 + finishCost(seg, doubleOut);
    if (cost < bestCost) {
      bestCost = cost;
      best = [seg];
    }
  }

  // Sortie en plusieurs fléchettes.
  if (darts > 1) {
    for (const seg of TARGETS) {
      const rest = score - seg.value;
      if (rest <= 0) continue;
      if (doubleOut && rest === 1) continue;
      const tail = checkout(rest, darts - 1, doubleOut);
      if (!tail) continue;
      const path = [seg, ...tail];
      const cost = 1000 * path.length + pathCost(path, doubleOut);
      if (cost < bestCost) {
        bestCost = cost;
        best = path;
      }
    }
  }

  checkoutCache.set(key, best);
  return best;
}

/** À coût égal, on préfère mettre la grosse zone en premier (plus de marge derrière). */
function pathCost(path, doubleOut) {
  let cost = 0;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    cost += i === path.length - 1
      ? finishCost(seg, doubleOut)
      : difficulty(seg) - seg.value * (0.06 / (i + 1));
  }
  return cost;
}

/** Le score est-il « finissable » avec ce nombre de fléchettes ? */
function canCheckout(score, darts, doubleOut = true) {
  return checkout(score, darts, doubleOut) !== null;
}

// ---------------------------------------------------------------------------
// Qualité d'un reliquat et conseil de placement
// ---------------------------------------------------------------------------

/**
 * Note (0-100) d'un score qu'on laisse derrière soi et qu'il faudra attaquer
 * avec trois fléchettes. Sert à choisir quoi laisser quand on ne peut pas finir.
 */
function leaveQuality(score, doubleOut = true) {
  if (score <= 0) return -1000;
  if (doubleOut && score === 1) return -1000;

  if (!doubleOut) {
    if (score <= 20) return 100;
    if (score <= 40) return 92;
    if (score <= 60) return 84;
  } else if (score <= 40 && score % 2 === 0) {
    const rank = DOUBLE_RANK.get(`D${score / 2}`) ?? 20;
    return 100 - rank * 1.5; // 40 → D20, 32 → D16, …
  } else if (score === 50) {
    return 80; // bull : jouable, mais c'est une cible de 12 mm
  } else if (score <= 40) {
    return 62; // impair : il faut deux fléchettes pour rentrer sur un double
  }

  if (canCheckout(score, 2, doubleOut)) return 80 - (score - 41) * 0.03;
  if (canCheckout(score, 3, doubleOut)) return 72 - (score - 60) * 0.03;
  if (score <= 170) return 18; // bogey numbers : 169, 168, 166, 165, 163, 162, 159
  return 50 - (score - 170) * 0.3; // trop haut : ce qui compte, c'est de descendre
}

/**
 * Conseil pour la prochaine fléchette.
 *
 * @param {number} score  points restants
 * @param {number} dartsLeft  fléchettes restantes dans la volée (1..3)
 * @param {boolean} doubleOut
 * @returns {{kind: 'checkout'|'setup'|'none', target: Segment|null, path: Segment[]|null,
 *            leave: number|null, leaveCheckout: Segment[]|null,
 *            headline: string, detail: string, text: string}}
 */
function advise(score, dartsLeft, doubleOut = true) {
  if (score <= 0 || dartsLeft <= 0) {
    return {
      kind: 'none', target: null, path: null, leave: null, leaveCheckout: null,
      headline: '', detail: '', text: '',
    };
  }

  const path = checkout(score, dartsLeft, doubleOut);
  if (path) {
    const headline = `Vise ${path[0].spoken}`;
    const detail = path.length === 1
      ? `${score} pile : c'est la sortie.`
      : `Sortie en ${path.length} : ${path.map((x) => x.label).join(' → ')}.`;
    return {
      kind: 'checkout',
      target: path[0],
      path,
      leave: score - path[0].value,
      leaveCheckout: path.slice(1),
      headline,
      detail,
      text: `${headline} — ${detail}`,
    };
  }

  // Pas de finish possible : soit on marque le plus gros possible (il reste des
  // fléchettes pour placer), soit — sur la dernière fléchette — on soigne le
  // reliquat qu'on laisse pour la volée suivante.
  const lastDart = dartsLeft === 1;
  let best = null;
  let bestScore = -Infinity;
  for (const seg of TARGETS) {
    const rest = score - seg.value;
    if (rest <= 0) continue;
    if (doubleOut && rest === 1) continue;
    const q = lastDart
      ? leaveQuality(rest, doubleOut) - difficulty(seg) + seg.value * 0.03
      : seg.value - difficulty(seg) * 0.5;
    if (q > bestScore) {
      bestScore = q;
      best = seg;
    }
  }

  if (!best) {
    return {
      kind: 'none',
      target: null,
      path: null,
      leave: null,
      leaveCheckout: null,
      headline: 'Volée perdue',
      detail: 'Aucune fléchette ne passe sans dépasser 0.',
      text: 'Aucune fléchette ne passe sans dépasser 0.',
    };
  }

  const leave = score - best.value;
  const leaveCheckout = checkout(leave, 3, doubleOut);
  const finishHint = leaveCheckout ? `, à finir en ${leaveCheckout.map((x) => x.label).join(' ')}` : '';
  const pts = `${best.value} point${best.value > 1 ? 's' : ''}`;
  const headline = `Vise ${best.spoken}`;
  const detail = lastDart
    ? `Dernière fléchette : ${pts} pour laisser ${leave}${finishHint}.`
    : `${pts} → reste ${leave}${finishHint}.`;

  return {
    kind: 'setup', target: best, path: null, leave, leaveCheckout, headline, detail,
    text: `${headline} — ${detail}`,
  };
}

/** Conseil « début de volée » : ce que le joueur devrait tenter avec 3 fléchettes. */
function adviseTurn(score, doubleOut = true) {
  return advise(score, 3, doubleOut);
}

  return {
    SEGMENTS,
    TARGETS,
    BOGEY_NUMBERS,
    segment,
    isDouble,
    checkout,
    canCheckout,
    leaveQuality,
    advise,
    adviseTurn,
  };
}));
