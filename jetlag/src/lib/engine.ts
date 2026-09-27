// Jet lag plan engine.
//
// Model (see src/content/guide.ts "Sources" for references):
// - The body clock is tracked as an offset (hours) from the home time zone.
// - Core body temperature minimum (CBTmin) sits ~2.5 h before habitual wake time.
// - Light after CBTmin advances the clock, light before it delays it (Khalsa 2003).
// - Natural re-entrainment: ~1 h/day eastward, ~1.5 h/day westward (Eastman & Burgess 2009).
//   Following light/melatonin guidance is assumed to speed that up modestly.
// - Eastward shifts of 10 h or more are planned as delays (antidromic re-entrainment risk).
// - Caffeine keeps disturbing sleep 6 h before bed (Drake 2013): default cutoff 8 h.

import { airport, cityLabel, type Airport } from "./airports";
import { isDaylight } from "./sun";
import { DAY, HOUR, MIN, addDaysKey, fromZoned, hmToMin, mod, startOfDay, tzOffset, zoned } from "./time";
import type { Leg, Profile, TransportMode, Trip } from "./types";

export type EventKind =
  | "sleep"
  | "nap"
  | "light-seek"
  | "light-avoid"
  | "melatonin"
  | "caffeine"
  | "caffeine-boost"
  | "transport"
  | "airport"
  | "boarding"
  | "takeoff"
  | "meal"
  | "flight"
  | "landing"
  | "arrival"
  | "layover"
  | "move"
  | "tip";

export type Place = "home" | "transport" | "airport" | "air" | "layover" | "dest";

export interface PlanEvent {
  id: string;
  kind: EventKind;
  start: number;
  end?: number;
  title: string;
  detail?: string;
  bullets?: string[];
  place: Place;
  tz: string;
  optional?: boolean;
  legId?: string;
}

export type Strategy = "none" | "stay" | "advance" | "delay";

export interface PlanDay {
  key: string; // stable id
  label: string; // "J-2", "Départ", "Jour 1"
  dateKey: string;
  tz: string;
  start: number;
  end: number;
  phase: "prep" | "travel" | "adapt";
  progress: number; // 0..1 body clock alignment at end of day
  events: PlanEvent[];
  focus: string; // one-line headline
}

export interface Plan {
  trip: Trip;
  home: Airport;
  dest: Airport;
  homeTz: string;
  destTz: string;
  shiftH: number; // destination minus home, (-12, 12]
  strategy: Strategy;
  targetH: number; // body clock shift to perform, signed (+ = advance)
  preShiftH: number;
  rateH: number;
  rateNoPlanH: number;
  adaptDays: number;
  adaptDaysNoPlan: number;
  departure: number;
  arrival: number;
  leaveHome: number;
  atAirport: number;
  reachHotel: number;
  start: number;
  end: number;
  shortTrip: boolean;
  events: PlanEvent[];
  days: PlanDay[];
  bodyOffsetAt: (t: number) => number;
  bodyMinutesAt: (t: number) => number;
  placeAt: (t: number) => Place;
  flightSleepMin: number;
}

interface Interval {
  start: number;
  end: number;
}

const TRANSPORT_LABEL: Record<TransportMode, string> = {
  vtc: "VTC",
  taxi: "taxi",
  train: "train",
  metro: "métro / RER",
  car: "voiture (passager)",
  drive: "voiture (tu conduis)",
  bus: "navette / bus",
  walk: "à pied",
};
export const transportLabel = (m: TransportMode) => TRANSPORT_LABEL[m];

const fmtDur = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
};
export { fmtDur };

function overlap(a: Interval, b: Interval): Interval | null {
  const s = Math.max(a.start, b.start), e = Math.min(a.end, b.end);
  return e > s ? { start: s, end: e } : null;
}

function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (c.end <= p.start || c.start >= p.end) next.push(p);
      else {
        if (c.start > p.start) next.push({ start: p.start, end: c.start });
        if (c.end < p.end) next.push({ start: c.end, end: p.end });
      }
    }
    parts = next;
  }
  return parts;
}

export function normalizeShift(h: number) {
  let x = mod(h, 24);
  if (x > 12) x -= 24;
  return x;
}

export function legTimes(leg: Leg) {
  const a = airport(leg.from), b = airport(leg.to);
  if (!a || !b) return null;
  return { dep: fromZoned(leg.dep, a.tz), arr: fromZoned(leg.arr, b.tz), from: a, to: b };
}

export function isInternational(trip: Trip) {
  const a = airport(trip.legs[0]?.from), b = airport(trip.legs[trip.legs.length - 1]?.to);
  return !!a && !!b && a.country !== b.country;
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

export function buildPlan(profile: Profile, trip: Trip): Plan | null {
  seq = 0;
  const legs = trip.legs
    .map((l) => ({ leg: l, t: legTimes(l) }))
    .filter((x): x is { leg: Leg; t: NonNullable<ReturnType<typeof legTimes>> } => !!x.t)
    .sort((a, b) => a.t.dep - b.t.dep);
  if (!legs.length) return null;

  const home = legs[0].t.from;
  const dest = legs[legs.length - 1].t.to;
  const homeTz = home.tz, destTz = dest.tz;
  const departure = legs[0].t.dep;
  const arrival = legs[legs.length - 1].t.arr;
  const homeOff = tzOffset(departure, homeTz);
  const destOff = tzOffset(arrival, destTz);
  const shiftH = normalizeShift((destOff - homeOff) / 60);
  const intl = home.country !== dest.country;

  // Short stay detection.
  const arrivalKey = zoned(arrival, destTz).dateKey;
  const nights = trip.returnDate ? Math.round((Date.parse(trip.returnDate) - Date.parse(arrivalKey)) / DAY) : Infinity;
  const shortTrip = nights <= 3 && Math.abs(shiftH) >= 3;

  let strategy: Strategy;
  if (Math.abs(shiftH) < 1) strategy = "none";
  else if (shortTrip && trip.stayOnHomeTime !== false) strategy = "stay";
  else if (shiftH > 0 && shiftH < 10) strategy = "advance";
  else strategy = "delay";

  const targetH = strategy === "advance" ? shiftH : strategy === "delay" ? (shiftH < 0 ? shiftH : shiftH - 24) : 0;
  const sign = Math.sign(targetH);
  const rateNoPlanH = sign > 0 ? 1 : 1.5;
  const rateH = sign > 0 ? 1.25 + (profile.melatonin ? 0.25 : 0) : 1.75;
  const preDays = strategy === "advance" || strategy === "delay" ? Math.min(trip.preDays, 3) : 0;
  const preShiftH = sign * Math.min(preDays, Math.abs(targetH));
  const remaining = Math.abs(targetH) - Math.abs(preShiftH);
  const adaptDays = Math.ceil(remaining / rateH - 0.15);
  const adaptDaysNoPlan = Math.ceil(Math.abs(targetH) / rateNoPlanH - 0.15);

  // Door to door.
  const firstLeg = legs[0];
  const atAirport = departure - trip.airportBuffer * MIN;
  const leaveHome = atAirport - trip.toAirport.minutes * MIN;
  const exitAirport = arrival + (intl ? 60 : 30) * MIN;
  const reachHotel = exitAirport + trip.fromAirport.minutes * MIN;

  // Sleep habits.
  const B = hmToMin(profile.bedtime);
  const W = hmToMin(profile.wake);
  const sleepDur = mod(W - B, 1440) || 480;
  const cbtClock = W - 150;

  const depKey = zoned(departure, homeTz).dateKey;
  const wakeRamp = fromZoned(`${addDaysKey(depKey, -preDays)}T${profile.wake}`, homeTz);

  const bodyOffsetAt = (t: number): number => {
    if (!sign) return 0;
    if (t < arrival) {
      if (!preDays) return 0;
      return sign * Math.min(Math.abs(preShiftH), Math.max(0, (t - wakeRamp) / DAY));
    }
    const v = Math.abs(preShiftH) + (rateH * (t - arrival)) / DAY;
    return sign * Math.min(Math.abs(targetH), v);
  };
  // Minutes since midnight on the body's own clock (the "time your body thinks it is").
  const bodyMinutesAt = (t: number) => mod(t / MIN + homeOff + bodyOffsetAt(t) * 60, 1440);

  const prepShown = Math.max(preDays, 1);
  const startKey = addDaysKey(depKey, -prepShown);
  const start = startOfDay(fromZoned(`${startKey}T12:00`, homeTz), homeTz);
  const endKey = addDaysKey(arrivalKey, Math.max(adaptDays, strategy === "stay" ? nights : 1) + (strategy === "none" ? 0 : 1));
  const end = fromZoned(`${endKey}T23:59`, destTz);

  const events: PlanEvent[] = [];
  const push = (e: Omit<PlanEvent, "id">) => {
    const ev = { ...e, id: uid(e.kind) };
    events.push(ev);
    return ev;
  };

  // ---------- Places over time ----------
  const segments: { start: number; end: number; place: Place }[] = [];
  segments.push({ start: -Infinity, end: leaveHome, place: "home" });
  segments.push({ start: leaveHome, end: atAirport, place: "transport" });
  segments.push({ start: atAirport, end: firstLeg.t.dep, place: "airport" });
  legs.forEach(({ t }, i) => {
    segments.push({ start: t.dep, end: t.arr, place: "air" });
    const next = legs[i + 1];
    if (next) segments.push({ start: t.arr, end: next.t.dep, place: "layover" });
  });
  segments.push({ start: arrival, end: exitAirport, place: "airport" });
  segments.push({ start: exitAirport, end: reachHotel, place: "transport" });
  segments.push({ start: reachHotel, end: Infinity, place: "dest" });
  const placeAt = (t: number): Place => segments.find((s) => t >= s.start && t < s.end)?.place ?? "dest";
  // Travellers switch their watch to destination time at boarding.
  const boardingFirst = departure - 40 * MIN;
  const tzAt = (t: number) => (t < boardingFirst ? homeTz : destTz);
  const geoAt = (t: number) => {
    if (t < departure) return home;
    if (t >= arrival) return dest;
    const legIdx = legs.findIndex(({ t: lt }) => t < lt.arr);
    const l = legs[Math.max(0, legIdx)];
    if (t < l.t.dep) return l.t.from;
    const f = (t - l.t.dep) / (l.t.arr - l.t.dep);
    return { lat: l.t.from.lat + (l.t.to.lat - l.t.from.lat) * f, lon: l.t.from.lon + (l.t.to.lon - l.t.from.lon) * f };
  };
  const daylight = (t: number) => {
    const g = geoAt(t);
    return isDaylight(t, g.lat, g.lon);
  };

  // ---------- Main sleep ----------
  const sleeps: (Interval & { place: Place; note?: string; kind: "sleep" | "nap"; legId?: string })[] = [];
  const bedFor = (dateKey: string, tz: string, shiftMin = 0) => {
    // A bedtime after midnight belongs to the following calendar date.
    const key = B < 12 * 60 ? addDaysKey(dateKey, 1) : dateKey;
    return fromZoned(`${key}T${profile.bedtime}`, tz) + shiftMin * MIN;
  };

  // Home nights before departure (with optional pre-adjustment).
  for (let k = prepShown + 1; k >= 0; k--) {
    const dk = addDaysKey(depKey, -k);
    const s = k === 0 ? preDays : Math.max(0, Math.min(preDays - k + 1, Math.abs(targetH)));
    const shiftMin = -sign * Math.min(s, Math.abs(targetH)) * 60;
    const latestWake = leaveHome - 60 * MIN;
    const habitual = bedFor(dk, homeTz);
    let bed = bedFor(dk, homeTz, shiftMin);
    // Early departure: don't push bedtime later than what still fits, and allow up to 1 h earlier.
    if (bed + sleepDur * MIN > latestWake) bed = Math.min(bed, Math.max(latestWake - sleepDur * MIN, habitual - HOUR));
    let wake = bed + sleepDur * MIN;
    let note: string | undefined;
    if (bed >= latestWake - 90 * MIN) continue;
    if (wake > latestWake) {
      wake = latestWake;
      note = `Nuit courte (${fmtDur((wake - bed) / MIN)}) à cause du départ. Couche-toi dès que possible, même si tu ne t'endors pas tout de suite.`;
    }
    if (!note && Math.abs(bed - habitual) >= 30 * MIN) {
      note = bed < habitual && sign < 0
        ? `Couche-toi ${fmtDur((habitual - bed) / MIN)} plus tôt : départ matinal demain.`
        : bed < habitual
        ? `Coucher ${fmtDur(Math.abs(bed - habitual) / MIN)} plus tôt que d'habitude : ton corps commence à avancer vers l'heure de ${cityLabel(dest)}.`
        : `Coucher ${fmtDur(Math.abs(bed - habitual) / MIN)} plus tard que d'habitude : ton corps commence à reculer vers l'heure de ${cityLabel(dest)}.`;
    }
    sleeps.push({ start: bed, end: wake, place: "home", note, kind: "sleep" });
  }

  // Destination nights (or home-time nights on a short stay).
  const sleepTz = strategy === "stay" ? homeTz : destTz;
  const blockTz = sleepTz;
  const destNights: Interval[] = [];
  for (let k = -1; ; k++) {
    const dk = addDaysKey(zoned(arrival, sleepTz).dateKey, k);
    let bed = bedFor(dk, sleepTz);
    const wake = bed + sleepDur * MIN;
    if (bed > end) break;
    if (wake <= reachHotel + 60 * MIN) continue;
    let note: string | undefined;
    if (bed < reachHotel + 30 * MIN) {
      if (wake - (reachHotel + 30 * MIN) < 3 * HOUR) continue;
      bed = reachHotel + 30 * MIN;
      note = "Couche-toi dès ton arrivée, en gardant ton heure de réveil habituelle demain.";
    }
    destNights.push({ start: bed, end: wake });
    sleeps.push({ start: bed, end: wake, place: "dest", note, kind: "sleep" });
  }

  // ---------- Flight legs ----------
  let flightSleepMin = 0;
  // Night windows the traveller should ideally sleep in, on the target schedule.
  const targetNights: Interval[] = [];
  for (let k = -3; k < 3; k++) {
    const dk = addDaysKey(zoned(departure, sleepTz).dateKey, k);
    const bed = bedFor(dk, sleepTz);
    targetNights.push({ start: bed - 30 * MIN, end: bed + (sleepDur + 30) * MIN });
  }

  const firstDestBed = destNights[0]?.start ?? end;
  let lastSleepEnd = Math.max(...sleeps.filter((x) => x.place === "home").map((x) => x.end), start);
  // Is the body clock in a state where sleep is plausible (evening to morning, body time)?
  const bodySleepable = (t: number) => mod(bodyMinutesAt(t) - (B - 180), 1440) < sleepDur + 180;
  const clipBy = (iv: Interval, ok: (t: number) => boolean): Interval[] => {
    const out: Interval[] = [];
    let cur: number | null = null;
    for (let t = iv.start; t <= iv.end; t += 5 * MIN) {
      if (ok(t) && t < iv.end) cur ??= t;
      else if (cur !== null) {
        out.push({ start: cur, end: t });
        cur = null;
      }
    }
    return out;
  };

  const kitLine = "Kit sommeil : masque, bouchons ou casque à réduction de bruit, tour de cou, chaussettes chaudes, un pull.";

  legs.forEach(({ leg, t }, i) => {
    const from = t.from, to = t.to;
    const durMin = (t.arr - t.dep) / MIN;
    const isLong = durMin >= 6 * 60;
    const takeoff = t.dep + 20 * MIN;
    const mealEnd = takeoff + (durMin > 150 ? 90 : 40) * MIN;
    const descent = t.arr - 40 * MIN;
    const breakfast = isLong ? t.arr - 100 * MIN : undefined;
    const legLabel = `${leg.flightNumber ? leg.flightNumber + " · " : ""}${from.iata} → ${to.iata}`;

    // Realistic in-flight sleep block.
    let block: Interval | null = null;
    type Why = "night" | "debt" | "recovery";
    let blockWhy: Why = "night";
    let skipMeal = false;
    let skipBreakfast = false;
    const usable = { start: takeoff + 25 * MIN, end: descent };
    const longGap = firstDestBed - lastSleepEnd > 24 * HOUR;
    const candidates: { iv: Interval; why: Why }[] = [];
    for (const n of targetNights) {
      const o = overlap(usable, n);
      if (!o) continue;
      for (const iv of clipBy(o, bodySleepable)) candidates.push({ iv, why: "night" });
      if (longGap && o.start - lastSleepEnd >= 8 * HOUR) candidates.push({ iv: o, why: "debt" });
    }
    if (longGap) for (const iv of clipBy(usable, bodySleepable)) candidates.push({ iv, why: "recovery" });
    for (const { iv, why } of candidates) {
      if ((iv.end - iv.start) / MIN < 60) continue;
      if (block) break;
      let s = iv.start, e = iv.end;
      if (s < mealEnd) {
        // Night already started: eat before boarding and skip the first service.
        if (mealEnd - s > 30 * MIN) skipMeal = true;
        else s = mealEnd;
      }
      if (breakfast && e > breakfast) {
        if (e - breakfast > 45 * MIN) skipBreakfast = true;
        else e = breakfast;
      }
      if (e - s >= 60 * MIN) {
        block = { start: s, end: e };
        blockWhy = why;
      }
    }
    if (!block) {
      skipMeal = false;
      skipBreakfast = false;
    } else lastSleepEnd = block.end;

    if (i === 0) {
      push({
        kind: "transport", start: leaveHome, end: atAirport, place: "transport", tz: homeTz, legId: leg.id,
        title: `Départ pour l'aéroport · ${transportLabel(trip.toAirport.mode)}`,
        detail: `${fmtDur(trip.toAirport.minutes)} de trajet, arrivée à ${from.iata} ${fmtDur(trip.airportBuffer)} avant le décollage.`,
      });
      const gateBullets: string[] = [];
      const soonSleep = block && block.start - t.dep < 2 * HOUR;
      if (soonSleep) {
        gateBullets.push("Mange léger avant d'embarquer : tu vas sauter le premier repas pour dormir plus tôt.");
        gateBullets.push("Ne cherche pas à dormir à la porte : c'est bruyant et éclairé. Repos calme : assis, yeux fermés, respiration lente, écran en luminosité minimum.");
        gateBullets.push("Pas de café ni de thé à partir de maintenant.");
      } else {
        gateBullets.push("Hydrate-toi, marche dans le terminal plutôt que de rester assis(e).");
      }
      gateBullets.push("Passe aux toilettes juste avant l'embarquement, remplis ta gourde après la sécurité.");
      if (isLong) gateBullets.push(kitLine);
      push({ kind: "airport", start: atAirport, end: t.dep - 40 * MIN, place: "airport", tz: homeTz, legId: leg.id, title: `À l'aéroport · ${from.iata}`, bullets: gateBullets });
    }

    push({
      kind: "boarding", start: t.dep - 40 * MIN, place: "airport", tz: tzAt(t.dep - HOUR), legId: leg.id,
      title: `Embarquement · ${legLabel}`,
      detail: block ? "Installe ton kit tout de suite : chaussures enlevées, masque et bouchons à portée, couverture prête." : undefined,
    });

    push({
      kind: "flight", start: t.dep, end: t.arr, place: "air", tz: tzAt(t.dep), legId: leg.id,
      title: `Vol ${legLabel}`,
      detail: `${fmtDur(durMin)} de vol.`,
    });

    if (durMin >= 90) {
      push({
        kind: "takeoff", start: takeoff, place: "air", tz: tzAt(t.dep), legId: leg.id,
        title: "Décollage : pas la peine d'essayer de dormir",
        bullets: [
          "Annonces, roulage, lumière de cabine et montée : personne ne dort vraiment à ce moment-là. C'est normal.",
          block
            ? "Mets ta ceinture par-dessus la couverture pour que l'équipage ne te réveille pas."
            : "Profite de ce moment pour régler ton écran en luminosité adaptée et choisir quoi regarder.",
        ],
      });
    }

    if (durMin > 150) {
      push({
        kind: "meal", start: takeoff + 45 * MIN, place: "air", tz: tzAt(t.dep), legId: leg.id,
        title: skipMeal ? "Repas à bord : saute-le" : "Repas à bord",
        detail: skipMeal
          ? "Préviens l'équipage que tu ne veux pas être réveillé(e). Tu as mangé avant d'embarquer, ton sommeil est la priorité."
          : block
            ? "Mange léger et sans alcool, puis lance-toi dans ta phase de sommeil juste après."
            : "Mange à l'heure de ta destination autant que possible. Évite l'alcool : il fragmente le sommeil et baisse l'oxygénation en altitude.",
      });
    }

    if (block) {
      const len = (block.end - block.start) / MIN;
      flightSleepMin += len;
      const flat = leg.cabin === "business" || leg.cabin === "first";
      const why =
        blockWhy === "night"
          ? `C'est la nuit à ${cityLabel(blockTz === destTz ? dest : home)}. `
          : blockWhy === "debt"
            ? `C'est la nuit à ${cityLabel(dest)} et tu as déjà une bonne dette de sommeil : profites-en. `
            : "Long voyage : ce sommeil de récupération passe avant le reste. ";
      sleeps.push({ start: block.start, end: block.end, place: "air", kind: "sleep", legId: leg.id,
        note: why + (flat
          ? `Siège-lit : vise un vrai bloc de sommeil. Même 3 à 4 h changent tout à l'arrivée.`
          : `En classe éco, compte plutôt ${fmtDur(Math.min(len * 0.55, 300))} de vrai sommeil sur ${fmtDur(len)} : c'est normal. Garde les yeux fermés même éveillé(e), le repos compte aussi.`),
      });
    } else if (durMin >= 4 * 60) {
      push({
        kind: "tip", start: mealEnd, place: "air", tz: tzAt(t.dep), legId: leg.id,
        title: "Reste éveillé(e) pendant ce vol",
        detail: `C'est la journée à ${cityLabel(dest)}. Si tu cales vraiment, une micro-sieste de 20 min maximum, de préférence en début de vol.`,
      });
    }

    if (durMin >= 3 * 60) {
      push({
        kind: "move", start: block ? block.end : mealEnd + 30 * MIN, place: "air", tz: tzAt(t.dep), legId: leg.id,
        title: "Bouge et bois de l'eau",
        bullets: [
          "Un verre d'eau par heure éveillé(e). Pas d'alcool.",
          "Toutes les 1 à 2 h : lève-toi, marche dans l'allée, fais des rotations de chevilles.",
          durMin >= 4 * 60 ? "Chaussettes de contention conseillées pour les vols de plus de 4 h." : "",
        ].filter(Boolean),
      });
    }

    if (breakfast) {
      push({
        kind: "meal", start: breakfast, place: "air", tz: destTz, legId: leg.id,
        title: skipBreakfast ? "Service avant l'atterrissage : dors encore" : "Service avant l'atterrissage",
        detail: skipBreakfast
          ? "Si tu dors, laisse passer ce repas. Tu mangeras à l'heure locale en arrivant."
          : `Il est ${zoned(breakfast, to.tz).hm} à ${cityLabel(to)} : c'est ton repas à l'heure locale.`,
      });
    }

    push({
      kind: "landing", start: t.arr, place: "air", tz: to.tz, legId: leg.id,
      title: `Atterrissage · ${cityLabel(to)} ${zoned(t.arr, to.tz).hm}`,
    });

    const next = legs[i + 1];
    if (next) {
      push({
        kind: "layover", start: t.arr, end: next.t.dep, place: "layover", tz: to.tz, legId: leg.id,
        title: `Escale · ${cityLabel(to)} (${fmtDur((next.t.dep - t.arr) / MIN)})`,
        bullets: [
          "Marche plutôt que de rester assis(e) : c'est ta meilleure occasion de te dégourdir.",
          "Remplis ta gourde, mange léger à l'heure de ta destination finale.",
        ],
      });
    }
  });

  push({
    kind: "arrival", start: arrival, end: exitAirport, place: "airport", tz: destTz,
    title: intl ? "Immigration et bagages" : "Bagages et sortie",
  });

  const arriveLocal = zoned(reachHotel, destTz);
  push({
    kind: "transport", start: exitAirport, end: reachHotel, place: "transport", tz: destTz,
    title: `Vers ton logement · ${transportLabel(trip.fromAirport.mode)}`,
    detail:
      trip.fromAirport.mode === "drive"
        ? "Attention : conduire après un long vol et une nuit courte, c'est risqué. Si tu te sens partir, arrête-toi pour une sieste de 20 min ou prends un taxi."
        : `${fmtDur(trip.fromAirport.minutes)} de trajet.`,
  });

  const firstDay: string[] = [];
  if (arriveLocal.minutes < 15 * 60 && arriveLocal.minutes > 6 * 60) {
    firstDay.push("Chambre pas prête avant 15 h en général : dépose tes bagages, douche (salon ou hôtel), et sors.");
  }
  if (strategy !== "stay") firstDay.push("Cale tes repas sur l'heure locale dès maintenant, même si tu n'as pas faim : ça aide tes horloges internes.");
  if (strategy === "stay") firstDay.push("Séjour court : on garde l'heure de chez toi autant que possible. Planifie tes rendez-vous importants sur tes heures de forme habituelles.");
  firstDay.push("Évite les décisions importantes et la conduite si tu te sens dans le brouillard.");
  push({ kind: "tip", start: reachHotel, place: "dest", tz: destTz, title: `Arrivé(e) à ${cityLabel(dest)}`, bullets: firstDay });

  // ---------- Naps on arrival ----------
  const napDays = strategy === "none" ? 0 : Math.min(2, adaptDays + 1);
  for (let j = 0; j < napDays; j++) {
    const dk = addDaysKey(arrivalKey, j);
    const earliest = Math.max(fromZoned(`${dk}T12:30`, destTz), reachHotel + 30 * MIN);
    const latest = fromZoned(`${dk}T16:00`, destTz);
    const nextBed = destNights.find((n) => n.start > earliest)?.start ?? Infinity;
    if (earliest > latest) continue;
    const napStart = earliest;
    if (nextBed - napStart < 7 * HOUR) continue;
    if (sleeps.some((s) => overlap(s, { start: napStart, end: napStart + 25 * MIN }))) continue;
    if (j > 0 && flightSleepMin > 5 * 60) continue;
    sleeps.push({ start: napStart, end: napStart + 25 * MIN, place: "dest", kind: "nap", note: "Seulement si tu en as besoin. Mets une alarme. Au-delà de 30 min, tu tombes en sommeil profond et tu te réveilles plus fatigué(e), avec une nuit plus difficile." });
  }

  sleeps.sort((a, b) => a.start - b.start);
  for (const s of sleeps) {
    const inAir = s.place === "air";
    const isNap = s.kind === "nap";
    push({
      kind: s.kind, start: s.start, end: s.end, place: s.place, tz: tzAt(s.start), legId: s.legId,
      title: isNap ? "Sieste courte · 20 à 25 min" : inAir ? "Dors dans l'avion" : "Sommeil",
      optional: isNap || undefined,
      detail: s.note,
    });
  }

  // ---------- Awake time ----------
  // Naps are optional: light windows ignore them so the advice stays in one piece.
  const awake = subtract({ start, end }, sleeps.filter((x) => x.kind === "sleep"));

  // ---------- Light windows ----------
  if (sign) {
    // CBTmin instances across the plan (fixed-point per day since the offset drifts slowly).
    const cbts: number[] = [];
    const d0 = Math.floor(start / DAY) - 1;
    let t = d0 * DAY + mod(cbtClock - homeOff - bodyOffsetAt(d0 * DAY) * 60, 1440) * MIN;
    while (t < end + DAY) {
      cbts.push(t);
      let next = t + DAY;
      for (let it = 0; it < 4; it++) next = t + DAY - (bodyOffsetAt(next) - bodyOffsetAt(t)) * HOUR;
      t = next;
    }
    const addWindow = (w: Interval, seek: boolean, cbt: number) => {
      // Stop once the body clock has reached the target and it's past arrival.
      if (cbt > arrival && Math.abs(bodyOffsetAt(cbt) - targetH) < 0.25) return;
      for (const a of awake) {
        const o = overlap(w, a);
        if (!o) continue;
        // Split by place so the advice fits where you are.
        let cur = o.start;
        while (cur < o.end) {
          const place = placeAt(cur);
          const seg = segments.find((s) => cur >= s.start && cur < s.end)!;
          const segEnd = Math.min(o.end, seg.end);
          if (segEnd - cur >= 15 * MIN) lightEvent(seek, { start: cur, end: segEnd }, place);
          cur = segEnd;
        }
      }
    };
    for (const cbt of cbts) {
      if (sign > 0) {
        addWindow({ start: cbt + 30 * MIN, end: cbt + 6 * HOUR }, true, cbt);
        addWindow({ start: cbt - 5 * HOUR, end: cbt + 30 * MIN }, false, cbt);
      } else {
        addWindow({ start: cbt - 7 * HOUR, end: cbt - 30 * MIN }, true, cbt);
        addWindow({ start: cbt - 30 * MIN, end: cbt + 5 * HOUR }, false, cbt);
      }
    }
  }

  function lightEvent(seek: boolean, w: Interval, place: Place) {
    const day = daylight(w.start + (w.end - w.start) / 2);
    const bullets: string[] = [];
    let title: string;
    if (seek) {
      title = "Cherche la lumière";
      switch (place) {
        case "home":
        case "dest":
          if (day) {
            bullets.push("Sors dehors au moins 30 à 60 min dans cette fenêtre. Même par temps gris, c'est 10 à 50 fois plus de lumière qu'en intérieur.");
            bullets.push(sign > 0 ? "Idéal pour marcher, courir ou prendre un café en terrasse (si c'est avant ta limite caféine)." : "Bon moment pour du sport ou une balade en fin de journée, dehors.");
          } else {
            bullets.push("Il fait nuit dehors : allume franchement la lumière, installe-toi près de la lampe la plus puissante.");
          }
          if (profile.lightGlasses) bullets.push("Tes lunettes de luminothérapie : 30 min dans cette fenêtre.");
          break;
        case "transport":
          if (day) {
            bullets.push(`Dans le ${transportLabel(w.start < arrival ? trip.toAirport.mode : trip.fromAirport.mode)}, installe-toi côté fenêtre et garde les lunettes de soleil dans la poche.`);
            bullets.push("Les vitres teintées filtrent beaucoup : si tu peux marcher 10 min dehors avant ou après, fais-le.");
          } else bullets.push("Il fait nuit : allume la lumière intérieure si possible, ou garde ton téléphone en luminosité haute.");
          if (profile.lightGlasses) bullets.push("C'est le moment parfait pour tes lunettes de luminothérapie.");
          break;
        case "airport":
        case "layover":
          bullets.push(day ? "Installe-toi près des grandes baies vitrées plutôt que dans un salon sombre, et marche." : "Reste dans les zones les plus éclairées du terminal.");
          if (profile.lightGlasses) bullets.push("Lunettes de luminothérapie : 30 min.");
          break;
        case "air":
          bullets.push(day ? "Ouvre le hublot si c'est possible et garde la lumière de lecture allumée." : "Allume ta lumière de lecture, écran en luminosité haute.");
          if (profile.lightGlasses) bullets.push("Les lunettes de luminothérapie s'utilisent très bien en vol.");
          break;
      }
    } else {
      title = "Évite la lumière vive";
      switch (place) {
        case "home":
        case "dest":
          if (day) {
            bullets.push(profile.sunglasses ? "Dehors, lunettes de soleil bien couvrantes et casquette. Tu peux sortir, protège juste tes yeux." : "Dehors, protège tes yeux (lunettes de soleil, casquette) et reste à l'ombre.");
            bullets.push("À l'intérieur, lumière douce, pas de place face à la fenêtre.");
          } else bullets.push("Lumière tamisée, écrans en mode nuit et luminosité basse.");
          break;
        case "transport":
          bullets.push(day ? "Lunettes de soleil dans la voiture, côté ombre si tu peux choisir. Tu peux fermer les yeux." : "Lumière intérieure éteinte, téléphone en mode nuit.");
          break;
        case "airport":
        case "layover":
          bullets.push("Oui, les lunettes de soleil dans le terminal, ça se fait. Évite les baies vitrées.");
          bullets.push("Téléphone en mode nuit et luminosité au minimum.");
          break;
        case "air":
          bullets.push("Hublot fermé, masque sur les yeux ou lunettes, écran en mode sombre.");
          break;
      }
    }
    push({ kind: seek ? "light-seek" : "light-avoid", start: w.start, end: w.end, place, tz: tzAt(w.start), title, bullets });
  }

  // ---------- Melatonin ----------
  const mainSleeps = sleeps.filter((s) => s.kind === "sleep");
  if (profile.melatonin && strategy === "advance") {
    for (const s of mainSleeps) {
      const behind = Math.abs(targetH - bodyOffsetAt(s.start));
      const isPre = s.place === "home" && s.start < departure && Math.abs(bodyOffsetAt(s.start + 8 * HOUR)) > 0.4;
      if (!(isPre || (s.place !== "home" && behind >= 1))) continue;
      const inAir = s.place === "air";
      push({
        kind: "melatonin", start: s.start - (inAir ? 0 : 30) * MIN, place: s.place, tz: tzAt(s.start), optional: inAir,
        title: inAir ? "Mélatonine (optionnel) · 0,5 à 1 mg" : "Mélatonine · 0,5 à 1 mg",
        detail: inAir
          ? "Seulement si tu vas vraiment dormir maintenant et pas conduire à l'arrivée."
          : "Une faible dose suffit pour déplacer l'horloge. Lumière tamisée après la prise.",
      });
    }
  }
  if (profile.melatonin && strategy === "delay") {
    for (const s of mainSleeps.filter((x) => x.place === "dest").slice(0, Math.min(3, adaptDays))) {
      push({
        kind: "melatonin", start: s.start + 4 * HOUR, place: "dest", tz: destTz, optional: true,
        title: "Réveil en pleine nuit ? Mélatonine 0,5 mg",
        detail: "Seulement si tu te réveilles et qu'il reste au moins 5 h avant ton réveil. Sinon, pas de prise : reste au calme dans le noir.",
      });
    }
  }

  // ---------- Caffeine ----------
  if (profile.caffeineDrink !== "none") {
    const cutoffH = profile.caffeineSensitive ? 10 : 8;
    const drinks =
      profile.caffeineDrink === "tea"
        ? "thé"
        : profile.caffeineDrink === "coffee"
          ? "café"
          : "café ou thé";
    const awakeMain = subtract({ start, end }, sleeps.filter((x) => x.kind === "sleep"));
    for (const a of awakeMain) {
      if (a.end - a.start < 2 * HOUR) continue;
      const nextSleep = sleeps.find((s) => s.kind === "sleep" && s.start >= a.end - MIN);
      if (!nextSleep) continue;
      const cutoff = Math.min(a.end, nextSleep.start - cutoffH * HOUR);
      if (cutoff - a.start < 45 * MIN) continue;
      push({
        kind: "caffeine", start: a.start, end: cutoff, place: placeAt(a.start), tz: tzAt(a.start),
        title: `${drinks[0].toUpperCase()}${drinks.slice(1)} OK jusqu'à ${zoned(cutoff, tzAt(cutoff)).hm}`,
        detail: `Après, la caféine (et la théine, c'est la même molécule) grignote ton sommeil : elle agit encore ${cutoffH} h plus tard.`,
      });
      // Strategic boost: awake while the body is in its biological night, on travel/arrival days.
      if (a.start >= departure - 6 * HOUR && a.start < reachHotel + 2 * DAY && sign) {
        for (let t = a.start; t < cutoff; t += 30 * MIN) {
          const bm = bodyMinutesAt(t);
          const bodyNight = mod(bm - B, 1440) < sleepDur;
          if (bodyNight && placeAt(t) !== "air") {
            push({
              kind: "caffeine-boost", start: t, place: placeAt(t), tz: tzAt(t),
              title: "Coup de pouce caféine",
              detail: `Ton corps est en pleine nuit (il croit qu'il est ${hmFromMin(bm)}). Un espresso ou deux tasses de thé noir (~80 à 100 mg) t'aident à tenir. Petite dose, pas un grand gobelet.`,
            });
            break;
          }
        }
      }
    }
  }

  // ---------- Pre-trip tips ----------
  const prepDay = fromZoned(`${addDaysKey(depKey, -1)}T18:00`, homeTz);
  push({
    kind: "tip", start: Math.min(prepDay, leaveHome - 6 * HOUR), place: "home", tz: homeTz,
    title: "Prépare ton sac malin",
    bullets: [
      kitLine,
      profile.sunglasses ? "Lunettes de soleil dans le sac cabine (pas en soute) : elles servent en vol, en transit et dans le taxi." : "Achète des lunettes de soleil couvrantes : c'est ton meilleur outil pour éviter la lumière au mauvais moment.",
      "Une gourde vide pour passer la sécurité.",
      profile.melatonin && sign ? "Mélatonine en petite dose (0,5 à 1 mg) dans le sac cabine." : "",
      "Ne fais pas de nuit blanche avant de partir : arriver déjà en dette de sommeil rend le décalage pire.",
    ].filter(Boolean),
  });

  events.sort((a, b) => a.start - b.start || kindOrder(a.kind) - kindOrder(b.kind));

  // ---------- Days ----------
  const depDayStart = startOfDay(departure, homeTz);
  const days: PlanDay[] = [];
  for (let k = prepShown; k >= 1; k--) {
    const dk = addDaysKey(depKey, -k);
    const s = fromZoned(`${dk}T00:00`, homeTz);
    const e = fromZoned(`${addDaysKey(dk, 1)}T00:00`, homeTz);
    days.push({ key: `p${k}`, label: `J-${k}`, dateKey: dk, tz: homeTz, start: s, end: Math.min(e, depDayStart), phase: "prep", progress: 0, events: [], focus: "" });
  }
  days.push({ key: "t", label: "Départ", dateKey: depKey, tz: homeTz, start: depDayStart, end: reachHotel, phase: "travel", progress: 0, events: [], focus: "" });
  for (let j = 0; ; j++) {
    const dk = addDaysKey(arrivalKey, j);
    const s = j === 0 ? reachHotel : fromZoned(`${dk}T00:00`, destTz);
    const e = fromZoned(`${addDaysKey(dk, 1)}T00:00`, destTz);
    if (s >= end) break;
    if (e - s < 2 * HOUR && j === 0) continue;
    days.push({ key: `d${j + 1}`, label: `Jour ${days.filter((d) => d.phase === "adapt").length + 1}`, dateKey: dk, tz: destTz, start: s, end: e, phase: "adapt", progress: 0, events: [], focus: "" });
  }
  for (const ev of events) {
    const d = days.find((x) => ev.start >= x.start && ev.start < x.end) ?? (ev.start < days[0].start ? days[0] : days[days.length - 1]);
    d.events.push(ev);
  }
  for (const d of days) {
    d.progress = targetH ? Math.min(1, Math.abs(bodyOffsetAt(d.end)) / Math.abs(targetH)) : 1;
    d.focus = dayFocus(d, strategy, sign, events);
  }

  return {
    trip, home, dest, homeTz, destTz, shiftH, strategy, targetH, preShiftH, rateH, rateNoPlanH,
    adaptDays, adaptDaysNoPlan, departure, arrival, leaveHome, atAirport, reachHotel, start, end, shortTrip,
    events, days, bodyOffsetAt, bodyMinutesAt, placeAt, flightSleepMin,
  };
}

function hmFromMin(m: number) {
  const x = Math.round(mod(m, 1440));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}
export { hmFromMin };

const ORDER: EventKind[] = ["tip", "transport", "airport", "boarding", "flight", "takeoff", "meal", "melatonin", "sleep", "nap", "light-avoid", "light-seek", "caffeine", "caffeine-boost", "move", "landing", "layover", "arrival"];
const kindOrder = (k: EventKind) => ORDER.indexOf(k);

function dayFocus(d: PlanDay, strategy: Strategy, sign: number, _all: PlanEvent[]): string {
  if (d.phase === "travel") return "Jour du voyage : on dort (ou pas) au bon moment, on gère la lumière dans les transports.";
  if (strategy === "none") return "Pas de décalage à gérer : garde tes horaires habituels.";
  if (strategy === "stay") return "Séjour court : tu restes calé(e) sur l'heure de chez toi.";
  const seek = d.events.filter((e) => e.kind === "light-seek");
  const avoid = d.events.filter((e) => e.kind === "light-avoid");
  const hm = (t: number) => zoned(t, d.tz).hm;
  if (d.phase === "prep") {
    if (!seek.length && !avoid.length) return "Dernière journée normale : dors bien, prépare ton sac.";
    return sign > 0 ? "On avance doucement l'horloge : coucher plus tôt, lumière dès le réveil." : "On recule doucement l'horloge : coucher plus tard, lumière en soirée.";
  }
  if (!seek.length && !avoid.length) {
    if (d.progress < 0.95) return "Soirée calme : lumière douce, dîner à l'heure locale, au lit à l'heure prévue.";
    return "Ton horloge est alignée. Vis à l'heure locale.";
  }
  const s = seek[0], a = avoid[0];
  if (a && s) return a.start < s.start ? `Lumière douce jusqu'à ${hm(a.end!)}, puis dehors à partir de ${hm(s.start)}.` : `Dehors à partir de ${hm(s.start)}, lumière douce après ${hm(a.start)}.`;
  if (s) return `Dehors entre ${hm(s.start)} et ${hm(s.end!)}.`;
  return `Protège tes yeux de ${hm(a!.start)} à ${hm(a!.end!)}.`;
}
