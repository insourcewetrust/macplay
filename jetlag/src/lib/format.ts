import { zoned } from "./time";

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function df(tz: string, opts: Intl.DateTimeFormatOptions) {
  const k = tz + JSON.stringify(opts);
  let f = dateFmt.get(k);
  if (!f) dateFmt.set(k, (f = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...opts })));
  return f;
}

export const hm = (ms: number, tz: string) => zoned(ms, tz).hm.replace(":", " h ").replace(/ h 00$/, " h").replace(/^0(\d)/, "$1");
export const hmShort = (ms: number, tz: string) => zoned(ms, tz).hm;
export const dayShort = (ms: number, tz: string) => df(tz, { weekday: "short", day: "numeric", month: "short" }).format(ms);
export const dayLong = (ms: number, tz: string) => df(tz, { weekday: "long", day: "numeric", month: "long" }).format(ms);
export const dateOnly = (ms: number, tz: string) => df(tz, { day: "numeric", month: "long" }).format(ms);

export function relDays(target: number, now: number) {
  const d = Math.round((target - now) / 86_400_000);
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "demain";
  if (d === -1) return "hier";
  if (d > 1) return `dans ${d} jours`;
  return `il y a ${-d} jours`;
}

export function relTime(target: number, now: number) {
  const min = Math.round((target - now) / 60_000);
  if (Math.abs(min) < 60) return min >= 0 ? `dans ${min} min` : `il y a ${-min} min`;
  const h = Math.round(min / 60);
  if (Math.abs(h) < 36) return h >= 0 ? `dans ${h} h` : `il y a ${-h} h`;
  return relDays(target, now);
}

export const signed = (h: number) => `${h > 0 ? "+" : h < 0 ? "−" : ""}${Math.abs(h) % 1 ? Math.abs(h).toFixed(1).replace(".", ",") : Math.abs(h)} h`;

export function greeting(now: number, tz: string) {
  const h = zoned(now, tz).h;
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}
