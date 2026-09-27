// Time-zone helpers built on Intl (IANA zones, DST-aware). All instants are epoch ms.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface Zoned {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  dow: number; // 0 = Sunday
  dateKey: string; // YYYY-MM-DD
  hm: string; // HH:mm
  minutes: number; // minutes since local midnight
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n: number) => String(n).padStart(2, "0");

export function zoned(ms: number, tz: string): Zoned {
  const p: Record<string, string> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  const y = +p.year, m = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute;
  return {
    y, m, d, h, mi,
    dow: DOW[p.weekday] ?? 0,
    dateKey: `${y}-${pad(m)}-${pad(d)}`,
    hm: `${pad(h)}:${pad(mi)}`,
    minutes: h * 60 + mi,
  };
}

/** UTC offset of `tz` at instant `ms`, in minutes (Paris summer = +120). */
export function tzOffset(ms: number, tz: string): number {
  const z = zoned(ms, tz);
  const p: Record<string, string> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
}

/** Wall-clock "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD HH:mm") in `tz` -> epoch ms. */
export function fromZoned(local: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(local);
  if (!m) throw new Error(`Bad local time: ${local}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = guess - tzOffset(guess, tz) * MIN;
  const off2 = tzOffset(ms, tz);
  ms = guess - off2 * MIN;
  return ms;
}

/** Local midnight of the calendar day containing `ms` in `tz`. */
export function startOfDay(ms: number, tz: string): number {
  return fromZoned(`${zoned(ms, tz).dateKey}T00:00`, tz);
}

export function addDaysKey(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToHm(min: number): string {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
}

export function toLocalInput(ms: number, tz: string): string {
  const z = zoned(ms, tz);
  return `${z.dateKey}T${z.hm}`;
}

export function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}
