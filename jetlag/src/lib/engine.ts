// Jet lag plan engine, for a whole trip: outbound, stay, way back, re-adaptation at home.
//
// Model (see src/content/guide.ts "Sources" for references):
// - The body clock is tracked as an offset (hours) from the home time zone, simulated every 30 min.
// - Core body temperature minimum (CBTmin) sits ~2.5 h before habitual wake time.
// - Light after CBTmin advances the clock, light before it delays it (Khalsa 2003).
// - Re-entrainment: ~1 h/day eastward, ~1.5 h/day westward without help (Eastman & Burgess 2009);
//   following light/melatonin guidance is assumed to speed that up modestly.
// - Shifts of 10 h or more eastward are planned as delays (antidromic re-entrainment risk).
// - Pre-flight adjustment is deliberately gentle: 30 min per night, 1 h 30 at most, within
//   liveable bedtimes. Eastman 2005 / Burgess 2003 show most of the gain comes from morning light.
// - Stays of 3 nights or less keep the body on home time (Waterhouse 2007).
// - Caffeine keeps disturbing sleep 6 h before bed (Drake 2013): default cutoff 8 h.

import { airport, cityLabel, type Airport } from "./airports";
import { isDaylight } from "./sun";
import { DAY, HOUR, MIN, addDaysKey, fromZoned, hmToMin, mod, startOfDay, tzOffset, zoned } from "./time";
import type { GroundTransport, Leg, Profile, TransportMode, Trip } from "./types";

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
  optional?: boolean;
  legId?: string;
}

export type Strategy = "none" | "stay" | "advance" | "delay";

export interface PlanDay {
  key: string;
  label: string; // "J-2", "Aller", "Jour 3", "Retour", "J+1"
  dateKey: string;
  tz: string; // times on this day are shown in this zone…
  altTz?: string; // …with this one in small
  start: number;
  end: number;
  phase: "prep" | "out" | "stay" | "back" | "home";
  progress: number; // 0..1 body clock alignment with where you are, at the end of the day
  events: PlanEvent[];
  focus: string;
}

export interface JourneyInfo {
  kind: "out" | "back";
  from: Airport;
  to: Airport;
  departure: number;
  arrival: number;
  leaveDoor: number;
  atAirport: number;
  exitAirport: number;
  reachDoor: number;
  shiftH: number; // arrival zone minus departure zone, (-12, 12]
  strategy: Strategy;
  targetH: number; // body clock shift to perform, signed (+ = advance)
  adaptDays: number; // with the plan, after landing
  adaptDaysNoPlan: number;
  preDays: number;
}

export interface Plan {
  trip: Trip;
  home: Airport;
  dest: Airport;
  homeTz: string;
  destTz: string;
  shiftH: number;
  strategy: Strategy; // outbound
  targetH: number;
  adaptDays: number;
  adaptDaysNoPlan: number;
  rateH: number;
  rateNoPlanH: number;
  out: JourneyInfo;
  back?: JourneyInfo;
  stayNights: number; // Infinity when unknown
  alignedAtReturn?: number; // 0..1 how adapted to the destination when flying back
  departure: number;
  arrival: number;
  leaveHome: number;
  reachHotel: number;
  start: number;
  end: number;
  shortTrip: boolean;
  events: PlanEvent[];
  days: PlanDay[];
  bodyOffsetAt: (t: number) => number;
  bodyMinutesAt: (t: number) => number;
  alignmentAt: (t: number) => number; // 0..1
  placeAt: (t: number) => Place;
  tzAt: (t: number) => string;
  altTzAt: (t: number) => string | undefined;
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

export function fmtDur(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function hmFromMin(m: number) {
  const x = Math.round(mod(m, 1440));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

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

/** Signed shortest path for the body clock: advances below 10 h, delays otherwise. Range [-14, 10). */
const clockPath = (h: number) => mod(h + 14, 24) - 14;

export function legTimes(leg: Leg) {
  const a = airport(leg.from), b = airport(leg.to);
  if (!a || !b || !/T\d{2}:\d{2}$/.test(leg.dep) || !/T\d{2}:\d{2}$/.test(leg.arr)) return null;
  return { dep: fromZoned(leg.dep, a.tz), arr: fromZoned(leg.arr, b.tz), from: a, to: b };
}

export function isInternational(trip: Trip) {
  const a = airport(trip.legs[0]?.from), b = airport(trip.legs[trip.legs.length - 1]?.to);
  return !!a && !!b && a.country !== b.country;
}

type TimedLeg = { leg: Leg; t: NonNullable<ReturnType<typeof legTimes>> };

function timed(legs: Leg[] | undefined): TimedLeg[] {
  return (legs ?? [])
    .map((l) => ({ leg: l, t: legTimes(l) }))
    .filter((x): x is TimedLeg => !!x.t)
    .sort((a, b) => a.t.dep - b.t.dep);
}

/** Split legs where the traveller stays 24 h or more. */
export function splitJourneys(legs: TimedLeg[]): TimedLeg[][] {
  const groups: TimedLeg[][] = [];
  for (const l of legs) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && l.t.dep - prev.t.arr < DAY) g.push(l);
    else groups.push([l]);
  }
  return groups;
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

// Liveable sleep windows (local clock, minutes after midnight, allowing values > 1440).
const EARLIEST_BED = 21 * 60 + 30;
const EARLIEST_WAKE = 5 * 60 + 30;
const LATEST_BED = 24 * 60 + 30;
const LATEST_WAKE = 8 * 60 + 30;

export function buildPlan(profile: Profile, trip: Trip): Plan | null {
  seq = 0;
  let outLegs = timed(trip.legs);
  let backLegs = timed(trip.returnLegs);
  if (!outLegs.length) return null;
  // Older trips may hold the way back inside `legs`.
  if (!backLegs.length) {
    const groups = splitJourneys(outLegs);
    if (groups.length > 1) {
      outLegs = groups[0];
      backLegs = groups[1];
    }
  }
  if (backLegs.length && backLegs[0].t.dep < outLegs[outLegs.length - 1].t.arr) backLegs = [];

  const home = outLegs[0].t.from;
  const dest = outLegs[outLegs.length - 1].t.to;
  const homeTz = home.tz, destTz = dest.tz;

  // ---------- Profile ----------
  const B = hmToMin(profile.bedtime);
  const W = hmToMin(profile.wake);
  const sleepDur = mod(W - B, 1440) || 480;
  const cbtClock = W - 150;
  const rateAdv = 1.25 + (profile.melatonin ? 0.25 : 0);
  const rateDel = 1.75;
  const ratePre = 0.5;
  // On a short stay you still live with local daylight: even when trying to hold home time,
  // the clock drifts toward local time. Conservative estimate, half the slowest natural rate.
  const rateDrift = 0.5;

  // ---------- Journeys (door to door) ----------
  const mkJourney = (kind: "out" | "back", legs: TimedLeg[], toAir: GroundTransport, fromAir: GroundTransport) => {
    const departure = legs[0].t.dep;
    const arrival = legs[legs.length - 1].t.arr;
    const from = legs[0].t.from, to = legs[legs.length - 1].t.to;
    const atAirport = departure - trip.airportBuffer * MIN;
    const exitAirport = arrival + (from.country !== to.country ? 60 : 30) * MIN;
    return {
      kind, legs, from, to, departure, arrival, toAir, fromAir, atAirport,
      leaveDoor: atAirport - toAir.minutes * MIN,
      exitAirport,
      reachDoor: exitAirport + fromAir.minutes * MIN,
    };
  };
  const J1 = mkJourney("out", outLegs, trip.toAirport, trip.fromAirport);
  const J2 = backLegs.length ? mkJourney("back", backLegs, trip.fromAirport, trip.toAirport) : undefined;
  const journeys = J2 ? [J1, J2] : [J1];

  const homeOff = tzOffset(J1.departure, homeTz);
  const destOff = tzOffset(J1.arrival, destTz);
  const S = normalizeShift((destOff - homeOff) / 60);

  // ---------- Stay ----------
  const arrivalKey = zoned(J1.arrival, destTz).dateKey;
  const backKey = J2 ? zoned(J2.departure, destTz).dateKey : trip.returnDate;
  const stayNights = backKey ? Math.max(0, Math.round((Date.parse(backKey) - Date.parse(arrivalKey)) / DAY)) : Infinity;
  const shortTrip = stayNights <= 3 && Math.abs(S) >= 2;
  const stayMode = Math.abs(S) >= 1 && ((shortTrip && trip.stayOnHomeTime !== false) || (trip.stayOnHomeTime === true && stayNights <= 5));
  const outStrategy: Strategy = Math.abs(S) < 1 ? "none" : stayMode ? "stay" : clockPath(S) > 0 ? "advance" : "delay";
  const outTarget = outStrategy === "advance" || outStrategy === "delay" ? clockPath(S) : 0;
  const preOut = outStrategy === "advance" || outStrategy === "delay" ? Math.min(3, trip.preDays) : 0;
  const preBack = J2 && !stayMode && Math.abs(S) >= 1 ? Math.min(3, trip.returnPreDays ?? (stayNights >= 3 && Math.abs(S) >= 4 ? 1 : 0)) : 0;

  const depKey = zoned(J1.departure, homeTz).dateKey;
  const preOutStart = fromZoned(`${addDaysKey(depKey, -preOut)}T${profile.wake}`, homeTz);
  // Easing back starts the afternoon before, so that morning's light advice already points home.
  const preBackStart = J2 ? fromZoned(`${addDaysKey(zoned(J2.departure, destTz).dateKey, -preBack - 1)}T14:00`, destTz) : Infinity;

  // Where you are, as an offset from home (hours).
  const locOffsetAt = (t: number) => (t < J1.arrival ? 0 : J2 && t >= J2.arrival ? 0 : S);

  // ---------- Body clock simulation ----------
  const prepShown = Math.max(preOut, 1);
  const start = startOfDay(fromZoned(`${addDaysKey(depKey, -prepShown)}T12:00`, homeTz), homeTz);
  const simEnd = (J2 ? J2.arrival : J1.arrival) + 16 * DAY;
  const STEP = 30 * MIN;
  const bArr: number[] = [];
  let b = 0;
  for (let t = start; t <= simEnd + STEP; t += STEP) {
    bArr.push(b);
    let desired: number | null = null;
    let rate = 0;
    if (t >= preOutStart && t < J1.departure && preOut) {
      desired = S;
      rate = ratePre;
    } else if (t >= J1.arrival && (!J2 || t < J2.departure)) {
      if (J2 && t >= preBackStart && preBack) {
        desired = 0;
        rate = ratePre;
      } else {
        desired = S;
        rate = stayMode ? rateDrift : 0; // 0: chosen by direction below
      }
    } else if (J2 && t >= J2.arrival) desired = 0;
    if (desired === null) continue;
    const d = clockPath(desired - b);
    if (Math.abs(d) < 0.01) continue;
    const r = rate || (d > 0 ? rateAdv : rateDel);
    const stepH = (r * STEP) / DAY;
    b += Math.sign(d) * Math.min(Math.abs(d), stepH);
  }
  const bodyOffsetAt = (t: number) => {
    const x = (t - start) / STEP;
    if (x <= 0) return bArr[0];
    const i = Math.floor(x);
    if (i >= bArr.length - 1) return bArr[bArr.length - 1];
    return bArr[i] + (bArr[i + 1] - bArr[i]) * (x - i);
  };
  const bodyMinutesAt = (t: number) => mod(t / MIN + homeOff + bodyOffsetAt(t) * 60, 1440);
  const misalignAt = (t: number) => Math.abs(clockPath(locOffsetAt(t) - bodyOffsetAt(t)));
  const dirAt = (t: number) => {
    const d = bodyOffsetAt(t + 3 * HOUR) - bodyOffsetAt(t - 3 * HOUR);
    return Math.abs(d) < 0.02 ? 0 : Math.sign(d);
  };

  const alignedAfter = (from: number) => {
    for (let t = from; t < simEnd; t += STEP) if (misalignAt(t) < 0.5) return t;
    return simEnd;
  };
  const outAligned = stayMode ? J1.arrival : alignedAfter(J1.arrival);
  // With a return, pre-return easing interferes: use the pure adaptation rate instead.
  const outRemaining = Math.abs(clockPath(S - bodyOffsetAt(J1.arrival)));
  const outAdaptDays =
    outStrategy === "advance" || outStrategy === "delay"
      ? Math.max(1, J2 ? Math.ceil(outRemaining / (outTarget > 0 ? rateAdv : rateDel) - 0.1) : Math.ceil((outAligned - J1.arrival) / DAY - 0.1))
      : 0;
  const outNoPlan = Math.ceil(Math.abs(outTarget) / (outTarget > 0 ? 1 : 1.5) - 0.15);
  const backShift = -S;
  const backNeed = J2 ? clockPath(0 - bodyOffsetAt(J2.departure)) : 0;
  const backStrategy: Strategy = !J2 || Math.abs(backNeed) < 0.75 ? (stayMode ? "stay" : "none") : backNeed > 0 ? "advance" : "delay";
  const backAligned = J2 ? alignedAfter(J2.arrival) : 0;
  const backAdaptDays = J2 && Math.abs(backNeed) >= 0.75 ? Math.max(1, Math.ceil((backAligned - J2.arrival) / DAY - 0.1)) : 0;
  const alignedAtReturn = J2 && !stayMode && Math.abs(S) >= 1 ? Math.max(0, 1 - Math.abs(clockPath(S - bodyOffsetAt(J2.departure))) / Math.abs(outTarget || 1)) : undefined;

  const endAnchor = J2 ? Math.max(backAligned, J2.reachDoor + DAY) : stayMode && Number.isFinite(stayNights) ? J1.arrival + stayNights * DAY : Math.max(outAligned, J1.reachDoor + DAY);
  const endTz = J2 ? homeTz : destTz;
  const end = fromZoned(`${addDaysKey(zoned(endAnchor, endTz).dateKey, 1)}T23:59`, endTz);

  // ---------- Places & display zones ----------
  const segments: { start: number; end: number; place: Place; j?: typeof J1 }[] = [];
  let cursor = -Infinity;
  journeys.forEach((j, idx) => {
    segments.push({ start: cursor, end: j.leaveDoor, place: idx === 0 ? "home" : "dest" });
    segments.push({ start: j.leaveDoor, end: j.atAirport, place: "transport", j });
    segments.push({ start: j.atAirport, end: j.departure, place: "airport", j });
    j.legs.forEach(({ t }, i) => {
      segments.push({ start: t.dep, end: t.arr, place: "air", j });
      const next = j.legs[i + 1];
      if (next) segments.push({ start: t.arr, end: next.t.dep, place: "layover", j });
    });
    segments.push({ start: j.arrival, end: j.exitAirport, place: "airport", j });
    segments.push({ start: j.exitAirport, end: j.reachDoor, place: "transport", j });
    cursor = j.reachDoor;
  });
  segments.push({ start: cursor, end: Infinity, place: J2 ? "home" : "dest" });
  const segAt = (t: number) => segments.find((s) => t >= s.start && t < s.end) ?? segments[segments.length - 1];
  const placeAt = (t: number): Place => segAt(t).place;

  // Journey days read in the departure city's time (the outbound in home time), the other zone in small.
  const J1DayStart = startOfDay(J1.departure, homeTz);
  const J2DayStart = J2 ? startOfDay(J2.departure, destTz) : Infinity;
  const tzAt = (t: number) => {
    if (t < J1.reachDoor) return homeTz;
    if (!J2 || t < J2DayStart) return destTz;
    if (t < J2.reachDoor) return destTz;
    return homeTz;
  };
  const altTzAt = (t: number) => {
    if (homeTz === destTz) return undefined;
    if (t < J1DayStart) return undefined;
    if (t < J1.reachDoor) return destTz;
    if (J2 && t >= J2.reachDoor) return undefined;
    return homeTz;
  };

  const geoAt = (t: number) => {
    const s = segAt(t);
    if (!s.j) return s.place === "home" ? home : dest;
    if (t < s.j.departure) return s.j.from;
    if (t >= s.j.arrival) return s.j.to;
    const l = s.j.legs.find(({ t: lt }) => t < lt.arr) ?? s.j.legs[s.j.legs.length - 1];
    if (t < l.t.dep) return l.t.from;
    const f = (t - l.t.dep) / (l.t.arr - l.t.dep);
    return { lat: l.t.from.lat + (l.t.to.lat - l.t.from.lat) * f, lon: l.t.from.lon + (l.t.to.lon - l.t.from.lon) * f };
  };
  const daylight = (t: number) => {
    const g = geoAt(t);
    return isDaylight(t, g.lat, g.lon);
  };

  const events: PlanEvent[] = [];
  const push = (e: Omit<PlanEvent, "id">) => {
    const ev = { ...e, id: uid(e.kind) };
    events.push(ev);
    return ev;
  };

  // ---------- Planned main sleep ----------
  type Sleep = Interval & { place: Place; note?: string; kind: "sleep" | "nap"; legId?: string };
  const sleeps: Sleep[] = [];

  // A night on the local clock of `tz`, bedtime moved by `shiftMin` (+ = later) within liveable bounds.
  const nightAt = (dateKey: string, tz: string, shiftMin: number): Interval & { habitual: number } => {
    const key = B < 12 * 60 ? addDaysKey(dateKey, 1) : dateKey;
    const habitual = fromZoned(`${key}T${profile.bedtime}`, tz);
    const bedClock = B < 12 * 60 ? B + 1440 : B;
    let target = bedClock + shiftMin;
    if (shiftMin < 0) target = Math.max(target, Math.min(bedClock, EARLIEST_BED), Math.min(bedClock, EARLIEST_WAKE + 1440 - sleepDur));
    if (shiftMin > 0) target = Math.min(target, Math.max(bedClock, LATEST_BED), Math.max(bedClock, LATEST_WAKE + 1440 - sleepDur));
    const bed = habitual + (target - bedClock) * MIN;
    return { start: bed, end: bed + sleepDur * MIN, habitual };
  };

  const shiftNote = (bed: number, habitual: number, towards: string) => {
    const diff = Math.round((bed - habitual) / MIN);
    if (Math.abs(diff) < 15) return undefined;
    return diff < 0
      ? `Coucher ${fmtDur(-diff)} plus tôt que d'habitude pour glisser doucement vers l'heure de ${towards}. Si tu ne dors pas tout de suite, pas grave : lève-toi quand même à l'heure prévue.`
      : `Coucher ${fmtDur(diff)} plus tard que d'habitude pour glisser doucement vers l'heure de ${towards}.`;
  };

  // Nights before leaving a place: gentle pre-adjustment, and a cut if the departure is early.
  const nightsBefore = (j: typeof J1, tz: string, preDays: number, dir: number, towards: string, place: Place, fromKey: string, baseShift = 0) => {
    const depDayKey = zoned(j.departure, tz).dateKey;
    for (let dk = fromKey; dk <= depDayKey; dk = addDaysKey(dk, 1)) {
      const k = Math.round((Date.parse(depDayKey) - Date.parse(dk)) / DAY); // 1 = the night before departure day
      const steps = preDays ? Math.max(0, preDays - k + 1) : 0;
      const n = nightAt(dk, tz, baseShift + dir * Math.min(steps, preDays) * 30);
      const latestWake = j.leaveDoor - 60 * MIN;
      let bed = n.start, wake = n.end;
      if (bed >= latestWake - 90 * MIN) continue;
      let note = steps && !baseShift ? shiftNote(bed, n.habitual, towards) : undefined;
      if (wake > latestWake) {
        // Early departure: go to bed up to 1 h earlier, then cut the night.
        bed = Math.min(bed, Math.max(latestWake - sleepDur * MIN, n.habitual - HOUR));
        wake = latestWake;
        note =
          wake - bed < (sleepDur - 30) * MIN
            ? `Nuit courte (${fmtDur((wake - bed) / MIN)}) à cause du départ. Couche-toi dès que possible, même si tu ne t'endors pas tout de suite.`
            : `Couche-toi ${fmtDur(Math.round((n.habitual - bed) / MIN))} plus tôt que d'habitude : départ matinal demain.`;
      }
      sleeps.push({ start: bed, end: wake, place, note, kind: "sleep" });
    }
  };

  // Nights after arriving somewhere.
  const nightsAfter = (arriveDoor: number, until: number, tz: string, shiftMin: number, place: Place, note?: string) => {
    const list: Interval[] = [];
    for (let dk = addDaysKey(zoned(arriveDoor, tz).dateKey, -1); ; dk = addDaysKey(dk, 1)) {
      const n = nightAt(dk, tz, shiftMin);
      if (n.start >= until) break;
      if (n.end <= arriveDoor + 60 * MIN) continue;
      let bed = n.start;
      let nNote = list.length === 0 ? note : undefined;
      if (bed < arriveDoor + 30 * MIN) {
        if (n.end - (arriveDoor + 30 * MIN) < 3 * HOUR) continue;
        bed = arriveDoor + 30 * MIN;
        nNote = "Couche-toi dès ton arrivée, en gardant ton heure de réveil habituelle demain.";
      }
      list.push({ start: bed, end: n.end });
      sleeps.push({ start: bed, end: n.end, place, note: nNote, kind: "sleep" });
    }
    return list;
  };

  const outDir = Math.sign(clockPath(S)); // + advance: bed earlier at home
  nightsBefore(J1, homeTz, preOut, -outDir, cityLabel(dest), "home", addDaysKey(depKey, -prepShown - 1));

  // At destination: local habits, or a compromise schedule on a short stay.
  const stayShiftMin = stayMode ? Math.max(-150, Math.min(150, S * 60)) : 0;
  const stayNote = stayMode
    ? `Séjour court : on garde ton corps proche de l'heure de ${cityLabel(home)}. Horaires de compromis, ${stayShiftMin < 0 ? "plus tôt" : "plus tard"} que d'habitude mais vivables sur place.`
    : undefined;
  const destUntil = J2 ? J2.leaveDoor : end;
  if (J2) {
    // Dest nights up to the ones handled by the pre-return schedule.
    const backDayKey = zoned(J2.departure, destTz).dateKey;
    const firstPre = addDaysKey(backDayKey, -Math.max(preBack, 1) - 1);
    nightsAfter(J1.reachDoor, fromZoned(`${firstPre}T12:00`, destTz), destTz, stayShiftMin, "dest", stayNote);
    const backDir = Math.sign(clockPath(-S)); // + advance: bed earlier at destination
    nightsBefore(J2, destTz, preBack, -backDir, cityLabel(home), "dest", firstPre, stayShiftMin);
    nightsAfter(J2.reachDoor, end, homeTz, 0, "home");
  } else {
    nightsAfter(J1.reachDoor, destUntil, destTz, stayShiftMin, "dest", stayNote);
  }

  // ---------- Flights ----------
  const kitLine = "Kit sommeil : masque, bouchons ou casque à réduction de bruit, tour de cou, chaussettes chaudes, un pull.";
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

  for (const j of journeys) {
    const out = j.kind === "out";
    const arrPlace: Place = out ? "dest" : "home";
    const arrTz = j.to.tz;
    const arrShift = out ? stayShiftMin : 0;
    const arrCity = cityLabel(j.to);
    // Nights at the arrival place, on its planned schedule, around the flight.
    const targetNights: Interval[] = [];
    for (let k = -3; k < 3; k++) {
      const n = nightAt(addDaysKey(zoned(j.departure, arrTz).dateKey, k), arrTz, arrShift);
      targetNights.push({ start: n.start - 30 * MIN, end: n.end + 30 * MIN });
    }
    const firstBedAfter = sleeps.filter((s) => s.place === arrPlace && s.start >= j.arrival).sort((a, c) => a.start - c.start)[0]?.start ?? j.arrival + DAY;
    let lastSleepEnd = Math.max(start, ...sleeps.filter((s) => s.end <= j.departure).map((s) => s.end));
    let flightSleepMin = 0;

    j.legs.forEach(({ leg, t }, i) => {
      const from = t.from, to = t.to;
      const durMin = (t.arr - t.dep) / MIN;
      const isLong = durMin >= 6 * 60;
      const takeoff = t.dep + 20 * MIN;
      const mealEnd = takeoff + (durMin > 150 ? 90 : 40) * MIN;
      const descent = t.arr - 40 * MIN;
      const breakfast = isLong ? t.arr - 100 * MIN : undefined;
      const legLabel = `${leg.flightNumber ? leg.flightNumber + " · " : ""}${from.iata} → ${to.iata}`;

      // Realistic in-flight sleep: never at the gate or during take-off, only when it's night where
      // you land and your body can follow, unless the sleep debt gets too big on a very long trip.
      type Why = "night" | "debt" | "recovery";
      let block: Interval | null = null;
      let blockWhy: Why = "night";
      let skipMeal = false;
      let skipBreakfast = false;
      const usable = { start: takeoff + 25 * MIN, end: descent };
      const longGap = firstBedAfter - lastSleepEnd > 24 * HOUR;
      const candidates: { iv: Interval; why: Why }[] = [];
      for (const n of targetNights) {
        const o = overlap(usable, n);
        if (!o) continue;
        for (const iv of clipBy(o, bodySleepable)) candidates.push({ iv, why: "night" });
        if (longGap && o.start - lastSleepEnd >= 8 * HOUR) candidates.push({ iv: o, why: "debt" });
      }
      if (longGap) for (const iv of clipBy(usable, bodySleepable)) candidates.push({ iv, why: "recovery" });
      for (const { iv, why } of candidates) {
        if (block) continue;
        let s = iv.start, e = iv.end;
        // Catch-up sleep must not eat into the first night after landing.
        if (why !== "night") e = Math.min(e, firstBedAfter - 7 * HOUR);
        if ((e - s) / MIN < 60) continue;
        let sm = false, sb = false;
        if (s < mealEnd) {
          if (mealEnd - s > 30 * MIN) sm = true;
          else s = mealEnd;
        }
        if (breakfast && e > breakfast) {
          if (e - breakfast > 45 * MIN) sb = true;
          else e = breakfast;
        }
        if (e - s >= 60 * MIN) {
          block = { start: s, end: e };
          blockWhy = why;
          skipMeal = sm;
          skipBreakfast = sb;
        }
      }
      if (block) lastSleepEnd = (block as Interval).end;

      if (i === 0) {
        push({
          kind: "transport", start: j.leaveDoor, end: j.atAirport, place: "transport", legId: leg.id,
          title: `${out ? "Départ pour l'aéroport" : "Direction l'aéroport"} · ${transportLabel(j.toAir.mode)}`,
          detail: `${fmtDur(j.toAir.minutes)} de trajet, arrivée à ${from.iata} ${fmtDur(trip.airportBuffer)} avant le décollage.`,
        });
        const gate: string[] = [];
        if (block && (block as Interval).start - t.dep < 2 * HOUR) {
          gate.push("Mange léger avant d'embarquer : tu vas sauter le premier repas pour dormir plus tôt.");
          gate.push("Ne cherche pas à dormir à la porte : c'est bruyant et éclairé. Repos calme : assis, yeux fermés, respiration lente, écran en luminosité minimum.");
          gate.push("Pas de café ni de thé à partir de maintenant.");
        } else gate.push("Hydrate-toi, marche dans le terminal plutôt que de rester assis(e).");
        gate.push("Passe aux toilettes juste avant l'embarquement, remplis ta gourde après la sécurité.");
        if (isLong) gate.push(kitLine);
        push({ kind: "airport", start: j.atAirport, end: t.dep - 40 * MIN, place: "airport", legId: leg.id, title: `À l'aéroport · ${from.iata}`, bullets: gate });
      }

      push({
        kind: "boarding", start: t.dep - 40 * MIN, place: "airport", legId: leg.id,
        title: `Embarquement · ${legLabel}`,
        detail: block ? "Installe ton kit tout de suite : chaussures enlevées, masque et bouchons à portée, couverture prête." : undefined,
      });
      push({ kind: "flight", start: t.dep, end: t.arr, place: "air", legId: leg.id, title: `Vol ${legLabel}`, detail: `${fmtDur(durMin)} de vol.` });

      if (durMin >= 90) {
        push({
          kind: "takeoff", start: takeoff, place: "air", legId: leg.id,
          title: "Décollage : pas la peine d'essayer de dormir",
          bullets: [
            "Annonces, roulage, lumière de cabine et montée : personne ne dort vraiment à ce moment-là. C'est normal.",
            block ? "Mets ta ceinture par-dessus la couverture pour que l'équipage ne te réveille pas." : "Profite de ce moment pour régler ton écran et choisir quoi regarder.",
          ],
        });
      }
      if (durMin > 150) {
        push({
          kind: "meal", start: takeoff + 45 * MIN, place: "air", legId: leg.id,
          title: skipMeal ? "Repas à bord : saute-le" : "Repas à bord",
          detail: skipMeal
            ? "Préviens l'équipage que tu ne veux pas être réveillé(e). Tu as mangé avant d'embarquer, ton sommeil est la priorité."
            : block
              ? "Mange léger et sans alcool, puis lance-toi dans ta phase de sommeil juste après."
              : "Évite l'alcool : il fragmente le sommeil et baisse l'oxygénation en altitude.",
        });
      }
      if (block) {
        const bl = block as Interval;
        const len = (bl.end - bl.start) / MIN;
        flightSleepMin += len;
        const flat = leg.cabin === "business" || leg.cabin === "first";
        const why =
          blockWhy === "night"
            ? `C'est la nuit à ${arrCity}. `
            : blockWhy === "debt"
              ? `C'est la nuit à ${arrCity} et tu as déjà une bonne dette de sommeil : profites-en. `
              : "Long voyage : ce sommeil de récupération passe avant le reste. ";
        sleeps.push({
          start: bl.start, end: bl.end, place: "air", kind: "sleep", legId: leg.id,
          note: why + (flat
            ? "Siège-lit : vise un vrai bloc de sommeil. Même 3 à 4 h changent tout à l'arrivée."
            : `En classe éco, compte plutôt ${fmtDur(Math.min(len * 0.55, 300))} de vrai sommeil sur ${fmtDur(len)} : c'est normal. Garde les yeux fermés même éveillé(e), le repos compte aussi.`),
        });
      } else if (durMin >= 4 * 60) {
        push({
          kind: "tip", start: mealEnd, place: "air", legId: leg.id,
          title: "Reste éveillé(e) pendant ce vol",
          detail: `C'est la journée à ${arrCity}. Si tu cales vraiment, une micro-sieste de 20 min maximum, de préférence en début de vol.`,
        });
      }
      if (durMin >= 3 * 60) {
        push({
          kind: "move", start: block ? (block as Interval).end : mealEnd + 30 * MIN, place: "air", legId: leg.id,
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
          kind: "meal", start: breakfast, place: "air", legId: leg.id,
          title: skipBreakfast ? "Service avant l'atterrissage : dors encore" : "Service avant l'atterrissage",
          detail: skipBreakfast
            ? "Si tu dors, laisse passer ce repas. Tu mangeras à l'heure locale en arrivant."
            : `Il sera ${zoned(breakfast, to.tz).hm} à ${cityLabel(to)} (heure locale) : mange comme un repas de là-bas.`,
        });
      }
      push({
        kind: "landing", start: t.arr, place: "air", legId: leg.id,
        title: `Atterrissage à ${cityLabel(to)}`,
        detail: `${zoned(t.arr, to.tz).hm} heure locale.`,
      });
      const next = j.legs[i + 1];
      if (next) {
        push({
          kind: "layover", start: t.arr, end: next.t.dep, place: "layover", legId: leg.id,
          title: `Escale · ${cityLabel(to)} (${fmtDur((next.t.dep - t.arr) / MIN)})`,
          bullets: [
            "Marche plutôt que de rester assis(e) : c'est ta meilleure occasion de te dégourdir.",
            `Remplis ta gourde, mange léger à l'heure de ${arrCity}.`,
          ],
        });
      }
    });

    push({ kind: "arrival", start: j.arrival, end: j.exitAirport, place: "airport", title: j.from.country !== j.to.country ? "Immigration et bagages" : "Bagages et sortie" });
    push({
      kind: "transport", start: j.exitAirport, end: j.reachDoor, place: "transport",
      title: `${out ? "Vers ton logement" : "Retour à la maison"} · ${transportLabel(j.fromAir.mode)}`,
      detail:
        j.fromAir.mode === "drive"
          ? "Attention : conduire après un long vol et une nuit courte, c'est risqué. Si tu te sens partir, arrête-toi pour une sieste de 20 min ou prends un taxi."
          : `${fmtDur(j.fromAir.minutes)} de trajet.`,
    });

    const arriveLocal = zoned(j.reachDoor, arrTz);
    const tips: string[] = [];
    if (out && arriveLocal.minutes < 15 * 60 && arriveLocal.minutes > 6 * 60) tips.push("Chambre pas prête avant 15 h en général : dépose tes bagages, douche (salon ou hôtel), et sors.");
    if (out && stayMode) tips.push("Séjour court : on garde l'heure de chez toi autant que possible. Place tes rendez-vous importants sur tes heures de forme habituelles.");
    else tips.push("Cale tes repas sur l'heure locale dès maintenant, même sans faim : ça aide tes horloges internes.");
    if (!out && backStrategy !== "none" && backStrategy !== "stay") {
      tips.push(`Ton corps est encore décalé d'environ ${fmtDur(Math.round(Math.abs(backNeed) * 60))}. Même logique qu'à l'aller : suis les fenêtres de lumière, compte ~${backAdaptDays} jour${backAdaptDays > 1 ? "s" : ""}.`);
    }
    tips.push("Évite les décisions importantes et la conduite si tu te sens dans le brouillard.");
    push({ kind: "tip", start: j.reachDoor, place: arrPlace, title: out ? `Arrivé(e) à ${arrCity}` : "De retour chez toi", bullets: tips });

    // Naps after landing, only while the body is still far off.
    for (let k = 0; k < 2; k++) {
      const dk = addDaysKey(zoned(j.arrival, arrTz).dateKey, k);
      const earliest = Math.max(fromZoned(`${dk}T12:30`, arrTz), j.reachDoor + 30 * MIN);
      const latest = fromZoned(`${dk}T16:00`, arrTz);
      if (earliest > latest) continue;
      if (misalignAt(earliest) < 2) continue;
      if (k > 0 && flightSleepMin > 5 * 60) continue;
      const nextBed = sleeps.filter((s) => s.kind === "sleep" && s.start > earliest).sort((a, c) => a.start - c.start)[0]?.start ?? Infinity;
      if (nextBed - earliest < 7 * HOUR) continue;
      if (sleeps.some((s) => overlap(s, { start: earliest, end: earliest + 25 * MIN }))) continue;
      sleeps.push({ start: earliest, end: earliest + 25 * MIN, place: arrPlace, kind: "nap", note: "Seulement si tu en as besoin. Mets une alarme. Au-delà de 30 min, tu tombes en sommeil profond et tu te réveilles plus fatigué(e), avec une nuit plus difficile." });
    }
  }

  sleeps.sort((a, c) => a.start - c.start);
  for (const s of sleeps) {
    const isNap = s.kind === "nap";
    push({
      kind: s.kind, start: s.start, end: s.end, place: s.place, legId: s.legId,
      title: isNap ? "Sieste courte · 20 à 25 min" : s.place === "air" ? "Dors dans l'avion" : "Sommeil",
      optional: isNap || undefined,
      detail: s.note,
    });
  }
  const mainSleeps = sleeps.filter((x) => x.kind === "sleep");
  const awake = subtract({ start, end }, mainSleeps);

  // ---------- Light windows ----------
  const cbts: number[] = [];
  {
    const d0 = Math.floor(start / DAY) - 1;
    let t = d0 * DAY + mod(cbtClock - homeOff - bodyOffsetAt(d0 * DAY) * 60, 1440) * MIN;
    while (t < end + DAY) {
      cbts.push(t);
      let next = t + DAY;
      for (let it = 0; it < 4; it++) next = t + DAY - (bodyOffsetAt(next) - bodyOffsetAt(t)) * HOUR;
      t = next;
    }
  }
  const lightEvent = (seek: boolean, dir: number, w: Interval, place: Place) => {
    const day = daylight(w.start + (w.end - w.start) / 2);
    const seg = segAt(w.start);
    const mode = seg.j ? (w.start < seg.j.departure ? seg.j.toAir.mode : seg.j.fromAir.mode) : "taxi";
    const bullets: string[] = [];
    let title: string;
    if (seek) {
      title = "Cherche la lumière";
      if (place === "home" || place === "dest") {
        if (day) {
          bullets.push("Sors dehors au moins 30 à 60 min dans cette fenêtre. Même par temps gris, c'est 10 à 50 fois plus de lumière qu'en intérieur.");
          bullets.push(dir > 0 ? "Idéal pour marcher, courir ou prendre un café en terrasse (si c'est avant ta limite caféine)." : "Bon moment pour du sport ou une balade en fin de journée, dehors.");
        } else bullets.push("Il fait nuit dehors : allume franchement la lumière, installe-toi près de la lampe la plus puissante.");
        if (profile.lightGlasses) bullets.push("Tes lunettes de luminothérapie : 30 min dans cette fenêtre.");
      } else if (place === "transport") {
        if (day) {
          bullets.push(`Dans le ${transportLabel(mode)}, installe-toi côté fenêtre et garde les lunettes de soleil dans la poche.`);
          bullets.push("Les vitres teintées filtrent beaucoup : si tu peux marcher 10 min dehors avant ou après, fais-le.");
        } else bullets.push("Il fait nuit : allume la lumière intérieure si possible, ou garde ton téléphone en luminosité haute.");
        if (profile.lightGlasses) bullets.push("C'est le moment parfait pour tes lunettes de luminothérapie.");
      } else if (place === "air") {
        bullets.push(day ? "Ouvre le hublot si c'est possible et garde la lumière de lecture allumée." : "Allume ta lumière de lecture, écran en luminosité haute.");
        if (profile.lightGlasses) bullets.push("Les lunettes de luminothérapie s'utilisent très bien en vol.");
      } else {
        bullets.push(day ? "Installe-toi près des grandes baies vitrées plutôt que dans un salon sombre, et marche." : "Reste dans les zones les plus éclairées du terminal.");
        if (profile.lightGlasses) bullets.push("Lunettes de luminothérapie : 30 min.");
      }
    } else {
      title = "Évite la lumière vive";
      if (place === "home" || place === "dest") {
        if (day) {
          bullets.push(profile.sunglasses ? "Dehors, lunettes de soleil bien couvrantes et casquette. Tu peux sortir, protège juste tes yeux." : "Dehors, protège tes yeux (lunettes de soleil, casquette) et reste à l'ombre.");
          bullets.push("À l'intérieur, lumière douce, pas de place face à la fenêtre.");
        } else bullets.push("Lumière tamisée, écrans en mode nuit et luminosité basse.");
      } else if (place === "transport") {
        bullets.push(day ? "Lunettes de soleil dans la voiture, côté ombre si tu peux choisir. Tu peux fermer les yeux." : "Lumière intérieure éteinte, téléphone en mode nuit.");
      } else if (place === "air") {
        bullets.push("Hublot fermé, masque sur les yeux ou lunettes, écran en mode sombre.");
      } else {
        bullets.push("Oui, les lunettes de soleil dans le terminal, ça se fait. Évite les baies vitrées.");
        bullets.push("Téléphone en mode nuit et luminosité au minimum.");
      }
    }
    push({ kind: seek ? "light-seek" : "light-avoid", start: w.start, end: w.end, place, title, bullets });
  };
  const addWindow = (w: Interval, seek: boolean, dir: number) => {
    for (const a of awake) {
      const o = overlap(w, a);
      if (!o) continue;
      let cur = o.start;
      while (cur < o.end) {
        const seg = segAt(cur);
        const segEnd = Math.min(o.end, seg.end);
        if (segEnd - cur >= 15 * MIN) lightEvent(seek, dir, { start: cur, end: segEnd }, seg.place);
        cur = segEnd;
      }
    }
  };
  for (const cbt of cbts) {
    // Short stay: light advice resists the drift and holds the body near home time.
    const inShortStay = stayMode && cbt >= J1.arrival && (!J2 || cbt < J2.departure);
    const dir = inShortStay ? (Math.abs(clockPath(bodyOffsetAt(cbt))) > 0.3 ? Math.sign(clockPath(-bodyOffsetAt(cbt))) : 0) : dirAt(cbt);
    if (!dir) continue;
    if (dir > 0) {
      addWindow({ start: cbt + 30 * MIN, end: cbt + 6 * HOUR }, true, dir);
      addWindow({ start: cbt - 5 * HOUR, end: cbt + 30 * MIN }, false, dir);
    } else {
      addWindow({ start: cbt - 7 * HOUR, end: cbt - 30 * MIN }, true, dir);
      addWindow({ start: cbt - 30 * MIN, end: cbt + 5 * HOUR }, false, dir);
    }
  }

  // ---------- Melatonin ----------
  if (profile.melatonin) {
    let delayNotes = 0;
    let lastArrival = -Infinity;
    for (const s of mainSleeps) {
      const dir = dirAt(s.start + 4 * HOUR);
      const inAir = s.place === "air";
      const arrivedAt = journeys.filter((j) => j.arrival <= s.start).map((j) => j.arrival).pop() ?? -Infinity;
      if (arrivedAt !== lastArrival) {
        lastArrival = arrivedAt;
        delayNotes = 0;
      }
      const preNight = (s.start > preOutStart && s.start < J1.departure) || (J2 && s.start >= preBackStart && s.start < J2.departure);
      if (dir > 0 && (misalignAt(s.start) >= 1 || preNight)) {
        push({
          kind: "melatonin", start: s.start - (inAir ? 0 : 30) * MIN, place: s.place, optional: inAir || undefined,
          title: inAir ? "Mélatonine (optionnel) · 0,5 à 1 mg" : "Mélatonine · 0,5 à 1 mg",
          detail: inAir ? "Seulement si tu vas vraiment dormir maintenant et que tu ne conduis pas à l'arrivée." : "Une faible dose suffit pour déplacer l'horloge. Lumière tamisée après la prise.",
        });
      } else if (dir < 0 && !inAir && s.start > arrivedAt && misalignAt(s.start) >= 2 && delayNotes < 3 && s.end - (s.start + 4 * HOUR) >= 4 * HOUR) {
        delayNotes++;
        push({
          kind: "melatonin", start: s.start + 4 * HOUR, place: s.place, optional: true,
          title: "Réveil en pleine nuit ? Mélatonine 0,5 mg",
          detail: "Seulement si tu te réveilles et qu'il reste au moins 5 h avant ton réveil. Sinon, pas de prise : reste au calme dans le noir.",
        });
      }
    }
  }

  // ---------- Caffeine ----------
  if (profile.caffeineDrink !== "none") {
    const cutoffH = profile.caffeineSensitive ? 10 : 8;
    const drinks = profile.caffeineDrink === "tea" ? "Thé" : profile.caffeineDrink === "coffee" ? "Café" : "Café ou thé";
    for (const a of awake) {
      if (a.end - a.start < 2 * HOUR) continue;
      const nextSleep = mainSleeps.find((s) => s.start >= a.end - MIN);
      if (!nextSleep) continue;
      const cutoff = Math.min(a.end, nextSleep.start - cutoffH * HOUR);
      if (cutoff - a.start < 45 * MIN) continue;
      const place = placeAt(a.start);
      push({
        kind: "caffeine", start: a.start, end: cutoff, place,
        title: `${drinks} OK jusqu'à ${zoned(cutoff, tzAt(a.start)).hm}`,
        detail: `Après, la caféine (et la théine, c'est la même molécule) grignote ton sommeil : elle agit encore ${cutoffH} h plus tard.`,
      });
      const nearJourney = journeys.some((j) => a.start >= j.departure - 6 * HOUR && a.start < j.reachDoor + 2 * DAY);
      if (nearJourney && misalignAt(a.start) >= 2) {
        for (let t = a.start; t < cutoff; t += 30 * MIN) {
          const bm = bodyMinutesAt(t);
          if (mod(bm - B, 1440) < sleepDur && placeAt(t) !== "air") {
            push({
              kind: "caffeine-boost", start: t, place: placeAt(t),
              title: "Coup de pouce caféine",
              detail: `Ton corps est en pleine nuit (il croit qu'il est ${hmFromMin(bm)}). Un espresso ou deux tasses de thé noir (~80 à 100 mg) t'aident à tenir. Petite dose, pas un grand gobelet.`,
            });
            break;
          }
        }
      }
    }
  }

  // ---------- Packing tips ----------
  for (const j of journeys) {
    const tz = j.from.tz;
    const eve = fromZoned(`${addDaysKey(zoned(j.departure, tz).dateKey, -1)}T18:00`, tz);
    push({
      kind: "tip", start: Math.min(eve, j.leaveDoor - 6 * HOUR), place: j.kind === "out" ? "home" : "dest",
      title: j.kind === "out" ? "Prépare ton sac malin" : "Avant de rentrer",
      bullets: [
        kitLine,
        profile.sunglasses ? "Lunettes de soleil dans le sac cabine (pas en soute) : elles servent en vol, en transit et dans le taxi." : "Des lunettes de soleil couvrantes : ton meilleur outil pour éviter la lumière au mauvais moment.",
        "Une gourde vide pour passer la sécurité.",
        profile.melatonin && Math.abs(S) >= 3 ? "Mélatonine en petite dose (0,5 à 1 mg) dans le sac cabine." : "",
        j.kind === "out" ? "Ne fais pas de nuit blanche avant de partir : arriver déjà en dette de sommeil rend le décalage pire." : "Garde une journée calme après le retour si tu peux.",
      ].filter(Boolean),
    });
  }

  events.sort((a, c) => a.start - c.start || ORDER.indexOf(a.kind) - ORDER.indexOf(c.kind));

  // ---------- Days ----------
  const days: PlanDay[] = [];
  const mkDay = (d: Omit<PlanDay, "events" | "focus" | "progress">) => days.push({ ...d, events: [], focus: "", progress: 0 });
  for (let k = prepShown; k >= 1; k--) {
    const dk = addDaysKey(depKey, -k);
    mkDay({ key: `p${k}`, label: `J-${k}`, dateKey: dk, tz: homeTz, start: fromZoned(`${dk}T00:00`, homeTz), end: fromZoned(`${addDaysKey(dk, 1)}T00:00`, homeTz), phase: "prep" });
  }
  mkDay({ key: "out", label: "Aller", dateKey: depKey, tz: homeTz, altTz: altTzAt(J1.departure), start: J1DayStart, end: J1.reachDoor, phase: "out" });
  const stayEnd = J2 ? J2DayStart : end;
  let n = 0;
  for (let dk = zoned(J1.reachDoor, destTz).dateKey; ; dk = addDaysKey(dk, 1)) {
    const s = Math.max(fromZoned(`${dk}T00:00`, destTz), J1.reachDoor);
    const e = Math.min(fromZoned(`${addDaysKey(dk, 1)}T00:00`, destTz), stayEnd);
    if (s >= stayEnd || s >= end) break;
    if (e - s < 2 * HOUR) continue;
    n++;
    mkDay({ key: `s${n}`, label: `Jour ${n}`, dateKey: dk, tz: destTz, altTz: altTzAt(s), start: s, end: e, phase: "stay" });
  }
  if (J2) {
    const bk = zoned(J2.departure, destTz).dateKey;
    mkDay({ key: "back", label: "Retour", dateKey: bk, tz: destTz, altTz: altTzAt(J2.departure), start: J2DayStart, end: J2.reachDoor, phase: "back" });
    let m = 0;
    for (let dk = zoned(J2.reachDoor, homeTz).dateKey; ; dk = addDaysKey(dk, 1)) {
      const s = Math.max(fromZoned(`${dk}T00:00`, homeTz), J2.reachDoor);
      const e = fromZoned(`${addDaysKey(dk, 1)}T00:00`, homeTz);
      if (s >= end) break;
      if (e - s < 2 * HOUR) continue;
      m++;
      mkDay({ key: `h${m}`, label: `J+${m}`, dateKey: dk, tz: homeTz, start: s, end: e, phase: "home" });
    }
  }
  for (const ev of events) {
    const d = days.find((x) => ev.start >= x.start && ev.start < x.end) ?? (ev.start < days[0].start ? days[0] : days[days.length - 1]);
    d.events.push(ev);
  }

  const alignmentAt = (t: number) => {
    const inBack = J2 && t >= J2.arrival;
    const total = inBack ? Math.abs(backNeed) : Math.abs(outTarget);
    if (!total || (stayMode && !inBack)) return 1;
    if (t < J1.arrival) return Math.min(1, Math.abs(bodyOffsetAt(t)) / total);
    return Math.max(0, 1 - misalignAt(t) / total);
  };
  for (const d of days) {
    d.progress = alignmentAt(d.end - MIN);
    d.focus = dayFocus(d, { stayMode, outStrategy, J2At: J2?.departure, preBackStart, homeCity: cityLabel(home) });
  }

  const outInfo: JourneyInfo = {
    kind: "out", from: J1.from, to: J1.to, departure: J1.departure, arrival: J1.arrival, leaveDoor: J1.leaveDoor, atAirport: J1.atAirport,
    exitAirport: J1.exitAirport, reachDoor: J1.reachDoor, shiftH: S, strategy: outStrategy, targetH: outTarget,
    adaptDays: outAdaptDays, adaptDaysNoPlan: outNoPlan, preDays: preOut,
  };
  const backInfo: JourneyInfo | undefined = J2 && {
    kind: "back", from: J2.from, to: J2.to, departure: J2.departure, arrival: J2.arrival, leaveDoor: J2.leaveDoor, atAirport: J2.atAirport,
    exitAirport: J2.exitAirport, reachDoor: J2.reachDoor, shiftH: backShift, strategy: backStrategy, targetH: backNeed,
    adaptDays: backAdaptDays, adaptDaysNoPlan: Math.ceil(Math.abs(backNeed) / (backNeed > 0 ? 1 : 1.5) - 0.15), preDays: preBack,
  };

  return {
    trip, home, dest, homeTz, destTz, shiftH: S, strategy: outStrategy, targetH: outTarget,
    adaptDays: outAdaptDays, adaptDaysNoPlan: outNoPlan,
    rateH: outTarget > 0 ? rateAdv : rateDel, rateNoPlanH: outTarget > 0 ? 1 : 1.5,
    out: outInfo, back: backInfo, stayNights, alignedAtReturn,
    departure: J1.departure, arrival: J1.arrival, leaveHome: J1.leaveDoor, reachHotel: J1.reachDoor,
    start, end, shortTrip, events, days,
    bodyOffsetAt, bodyMinutesAt, alignmentAt, placeAt, tzAt, altTzAt,
  };
}

const ORDER: EventKind[] = ["tip", "transport", "airport", "boarding", "flight", "takeoff", "meal", "melatonin", "sleep", "nap", "light-avoid", "light-seek", "caffeine", "caffeine-boost", "move", "landing", "layover", "arrival"];

function dayFocus(
  d: PlanDay,
  ctx: { stayMode: boolean; outStrategy: Strategy; J2At?: number; preBackStart: number; homeCity: string },
): string {
  if (d.phase === "out") return "Jour du départ : on dort (ou pas) au bon moment, et on gère la lumière jusque dans le taxi.";
  if (d.phase === "back") return "Jour du retour : même logique qu'à l'aller, dans l'autre sens.";
  if (ctx.outStrategy === "none") return "Pas de décalage à gérer : garde tes horaires habituels.";
  const seek = d.events.filter((e) => e.kind === "light-seek");
  const avoid = d.events.filter((e) => e.kind === "light-avoid");
  const hm = (t: number) => zoned(t, d.tz).hm;
  if (d.phase === "prep") {
    if (!seek.length && !avoid.length) return "Journée normale : dors bien, prépare ton sac.";
    return ctx.outStrategy === "advance" ? "Préparation en douceur : lumière dès le réveil, coucher un peu plus tôt si tu peux." : "Préparation en douceur : lumière en fin de journée, coucher un peu plus tard si tu peux.";
  }
  const preBack = d.phase === "stay" && ctx.J2At && d.start >= ctx.preBackStart - 12 * HOUR;
  const lead =
    ctx.stayMode && d.phase === "stay"
      ? `Séjour court : on reste proche de l'heure de ${ctx.homeCity}. `
      : preBack
        ? `Le retour approche : on revient doucement vers l'heure de ${ctx.homeCity}. `
        : "";
  if (!seek.length && !avoid.length) {
    if (ctx.stayMode && d.phase === "stay") return lead + "Pas de consigne de lumière aujourd'hui : repas à l'heure locale, au lit à l'heure prévue.";
    if (d.progress < 0.9) return lead + "Journée calme : repas à l'heure locale, au lit à l'heure prévue.";
    return lead + (d.phase === "home" ? "Tu es recalé(e) sur l'heure de chez toi." : "Ton horloge est alignée. Vis à l'heure locale.");
  }
  const s = seek[0], a = avoid[0];
  if (a && s) return lead + (a.start < s.start ? `Lumière douce jusqu'à ${hm(a.end!)}, puis lumière vive à partir de ${hm(s.start)}.` : `Lumière vive à partir de ${hm(s.start)}, lumière douce après ${hm(a.start)}.`);
  if (s) return lead + `Cherche la lumière entre ${hm(s.start)} et ${hm(s.end!)}.`;
  return lead + `Protège tes yeux de ${hm(a!.start)} à ${hm(a!.end!)}.`;
}
