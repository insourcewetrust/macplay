// Best-effort extraction of flights from a pasted booking confirmation (email, PDF text, app share).
import { airlineFor, airport, estimateBlockMinutes } from "./airports";
import { addDaysKey, fromZoned, MIN } from "./time";

export interface ParsedLeg {
  flightNumber?: string;
  airline?: string;
  from?: string;
  to?: string;
  dep?: string;
  arr?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1,
  feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, juillet: 7, july: 7,
  aug: 8, aou: 8, aout: 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dec: 12, decembre: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

interface Found<T> {
  at: number;
  v: T;
}

function findDates(text: string, fallbackYear: number): Found<string>[] {
  const out: Found<string>[] = [];
  const t = strip(text).toLowerCase();
  let m: RegExpExecArray | null;
  const iso = /\b(20\d\d)-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(t))) out.push({ at: m.index, v: `${m[1]}-${m[2]}-${m[3]}` });
  const dmy = /\b(\d{1,2})[./](\d{1,2})[./](20\d\d|\d\d)\b/g;
  while ((m = dmy.exec(t))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[2] <= 12 && +m[1] <= 31) out.push({ at: m.index, v: `${y}-${pad(+m[2])}-${pad(+m[1])}` });
  }
  const named = /\b(\d{1,2})(?:er)?\s*([a-z]{3,9})\.?,?\s*(20\d\d)?\b/g;
  while ((m = named.exec(t))) {
    const mo = MONTHS[m[2]] ?? MONTHS[m[2].slice(0, 4)] ?? MONTHS[m[2].slice(0, 3)];
    if (!mo || +m[1] > 31) continue;
    out.push({ at: m.index, v: `${m[3] ?? fallbackYear}-${pad(mo)}-${pad(+m[1])}` });
  }
  const mdy = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d\d)\b/g;
  while ((m = mdy.exec(t))) {
    const mo = MONTHS[m[1]] ?? MONTHS[m[1].slice(0, 3)];
    if (mo) out.push({ at: m.index, v: `${m[3]}-${pad(mo)}-${pad(+m[2])}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

function findTimes(text: string): Found<string>[] {
  const out: Found<string>[] = [];
  const re = /\b([01]?\d|2[0-3])\s?[:hH]\s?([0-5]\d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ at: m.index, v: `${pad(+m[1])}:${m[2]}` });
  return out;
}

function findAirports(text: string): Found<string>[] {
  const out: Found<string>[] = [];
  const re = /\b([A-Z]{3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = airport(m[1]);
    if (!a) continue;
    const before = text[m.index - 1], after = text[m.index + 3];
    const strong = before === "(" || after === ")" || /[→>\-–]/.test(text.slice(m.index - 3, m.index) + text.slice(m.index + 3, m.index + 6));
    if (strong || a.major) out.push({ at: m.index, v: m[1] });
  }
  return out;
}

function findFlights(text: string): Found<{ code: string; num: string; name?: string }>[] {
  const out: Found<{ code: string; num: string; name?: string }>[] = [];
  const re = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const al = airlineFor(m[1]);
    if (al) out.push({ at: m.index, v: { code: m[1], num: m[2].replace(/^0+(?=\d)/, ""), name: al.name } });
  }
  return out;
}

export function parseBooking(text: string, now = Date.now()): ParsedLeg[] {
  const year = new Date(now).getFullYear();
  const flights = findFlights(text);
  const airports = findAirports(text);
  const times = findTimes(text);
  const dates = findDates(text, year);

  const anchors = flights.length ? flights.map((f) => f.at) : airports.length >= 2 ? [airports[0].at] : [];
  const legs: ParsedLeg[] = [];
  anchors.forEach((at, i) => {
    // Route and times usually follow the flight number; a leading date may precede it.
    const prev = i === 0 ? -1 : anchors[i - 1];
    const lo = i === 0 ? Math.max(0, at - 160) : at;
    const hi = anchors[i + 1] ?? text.length;
    const inWin = <T,>(xs: Found<T>[]) => xs.filter((x) => x.at >= lo && x.at < hi);
    const aps = [...new Set(inWin(airports).map((x) => x.v))];
    const ts = inWin(times).map((x) => x.v);
    const before = dates.filter((d) => d.at > prev && d.at < at).map((x) => x.v);
    const ds = [...before.slice(-1), ...inWin(dates).map((x) => x.v)];
    const f = flights[i]?.v;
    const leg: ParsedLeg = {
      flightNumber: f ? `${f.code}${f.num}` : undefined,
      airline: f?.name,
      from: aps[0],
      to: aps[1],
    };
    const date = ds[0] ?? dates.filter((d) => d.at < at).pop()?.v;
    if (date && ts[0]) leg.dep = `${date}T${ts[0]}`;
    if (leg.dep && ts[1] && leg.from && leg.to) {
      const a = airport(leg.from)!, b = airport(leg.to)!;
      const dep = fromZoned(leg.dep, a.tz);
      const est = estimateBlockMinutes(a, b);
      // Pick the arrival date that makes the duration closest to the estimate.
      const cands = [0, 1, 2, -1].map((k) => {
        const key = ds[1] && k === 0 ? ds[1] : addDaysKey(date!, k);
        return { local: `${key}T${ts[1]}`, ms: fromZoned(`${key}T${ts[1]}`, b.tz) };
      });
      const best = cands.filter((c) => c.ms > dep).sort((x, y) => Math.abs((x.ms - dep) / MIN - est) - Math.abs((y.ms - dep) / MIN - est))[0];
      if (best) leg.arr = best.local;
    }
    if (leg.from || leg.flightNumber) legs.push(leg);
  });
  // Drop duplicates (same flight repeated in the email).
  return legs.filter((l, i) => legs.findIndex((x) => x.flightNumber === l.flightNumber && x.from === l.from && x.dep === l.dep) === i);
}
