import raw from "../data/airports.json";
import rawAirlines from "../data/airlines.json";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
  major: boolean;
  keywords: string;
}

type Row = [string, string, string, string, number, number, string, number, string];

export const AIRPORTS: Airport[] = (raw as Row[]).map(([iata, name, city, country, lat, lon, tz, major, keywords]) => ({
  iata, name, city, country, lat, lon, tz, major: major === 1, keywords,
}));

const byIata = new Map(AIRPORTS.map((a) => [a.iata, a]));
export const airport = (iata: string | undefined) => (iata ? byIata.get(iata.toUpperCase()) : undefined);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const index = AIRPORTS.map((a) => ({ a, hay: norm(`${a.iata} ${a.city} ${a.name} ${a.keywords}`), city: norm(a.city) }));

export function searchAirports(q: string, limit = 8): Airport[] {
  const n = norm(q.trim());
  if (!n) return [];
  const scored: { a: Airport; s: number }[] = [];
  for (const { a, hay, city } of index) {
    let s = -1;
    if (a.iata.toLowerCase() === n) s = 100;
    else if (city.startsWith(n)) s = 60;
    else if (hay.includes(` ${n}`) || hay.startsWith(n)) s = 40;
    else if (n.length >= 3 && hay.includes(n)) s = 20;
    if (s >= 0) scored.push({ a, s: s + (a.major ? 10 : 0) });
  }
  return scored.sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" });
  } catch {
    return null;
  }
})();
export const countryName = (cc: string) => countryNames?.of(cc) ?? cc;

/** Short, human city label: "Paris (Roissy-en-France…)" -> "Paris". */
export function cityLabel(a: Airport | undefined): string {
  if (!a) return "";
  return a.city.replace(/\s*\(.*\)\s*$/, "").trim() || a.name;
}

export function distanceKm(a: Airport, b: Airport): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough block time: taxi/climb/descent overhead + cruise; tail/head wind by direction. */
export function estimateBlockMinutes(a: Airport, b: Airport): number {
  const km = distanceKm(a, b);
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const eastward = dLon > 0;
  const speed = km < 1500 ? 700 : eastward ? 900 : 820; // km/h incl. jet stream effect
  return Math.round((35 + (km / speed) * 60) / 5) * 5;
}

export interface Airline {
  iata: string;
  icao: string;
  name: string;
}
export const AIRLINES: Airline[] = (rawAirlines as [string, string, string][]).map(([iata, icao, name]) => ({ iata, icao, name }));
const airlineByIata = new Map(AIRLINES.map((a) => [a.iata, a]));
const airlineByIcao = new Map(AIRLINES.map((a) => [a.icao, a]));
export const airlineFor = (code: string) =>
  code.length === 2 ? airlineByIata.get(code.toUpperCase()) : airlineByIcao.get(code.toUpperCase());

export const isValidIata = (s: string) => !!airport(s);
