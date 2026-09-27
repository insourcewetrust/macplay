// Flight lookup. Two sources:
// - AeroDataBox (RapidAPI, free tier, needs a key): real schedules with times, by flight number or by route.
// - adsbdb.com (free, no key): origin/destination for a callsign; times are then estimated.
import { airlineFor, airport, estimateBlockMinutes } from "./airports";
import { fromZoned, toLocalInput, MIN } from "./time";

export interface FoundFlight {
  flightNumber: string;
  airline?: string;
  from: string;
  to: string;
  dep?: string; // local "YYYY-MM-DDTHH:mm"
  arr?: string;
  aircraft?: string;
  source: "aerodatabox" | "adsbdb";
}

export function parseFlightNumber(input: string): { code: string; number: string; iata?: string; icao?: string; name?: string } | null {
  const m = /^\s*([A-Z0-9]{2}|[A-Z]{3})\s*-?\s*(\d{1,4}[A-Z]?)\s*$/i.exec(input.toUpperCase());
  if (!m) return null;
  const code = m[1];
  // Two-char codes like "U2" are IATA; three letters are ICAO.
  const al = airlineFor(code);
  return {
    code,
    number: m[2].replace(/^0+(?=\d)/, ""),
    iata: code.length === 2 ? code : al?.iata,
    icao: code.length === 3 ? code : al?.icao,
    name: al?.name,
  };
}

const ADB = "https://aerodatabox.p.rapidapi.com";

async function adbFetch(path: string, key: string) {
  const r = await fetch(ADB + path, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
  });
  if (r.status === 204) return [];
  if (r.status === 401 || r.status === 403) throw new Error("Clé AeroDataBox refusée. Vérifie-la dans Réglages.");
  if (r.status === 429) throw new Error("Quota AeroDataBox atteint pour ce mois.");
  if (!r.ok) throw new Error(`AeroDataBox : erreur ${r.status}`);
  return r.json();
}

// "2026-10-10 13:25+02:00" -> "2026-10-10T13:25"
const localOf = (s?: string) => (s ? s.replace(" ", "T").slice(0, 16) : undefined);

function fromAdb(f: any): FoundFlight | null {
  const dep = f.departure ?? f.movement;
  const arr = f.arrival;
  const from = dep?.airport?.iata;
  const to = arr?.airport?.iata;
  if (!from || !to) return null;
  return {
    flightNumber: String(f.number ?? "").replace(/\s+/g, ""),
    airline: f.airline?.name,
    from,
    to,
    dep: localOf(dep?.scheduledTime?.local ?? dep?.revisedTime?.local),
    arr: localOf(arr?.scheduledTime?.local ?? arr?.revisedTime?.local),
    aircraft: f.aircraft?.model,
    source: "aerodatabox",
  };
}

export async function lookupFlight(flight: string, date: string, key?: string): Promise<FoundFlight[]> {
  const p = parseFlightNumber(flight);
  if (!p) throw new Error("Numéro de vol non reconnu. Exemple : AF 276");
  if (key) {
    const data = await adbFetch(`/flights/number/${p.iata ?? p.code}${p.number}/${date}?withAircraftImage=false&withLocation=false`, key);
    const list = (Array.isArray(data) ? data : []).map(fromAdb).filter(Boolean) as FoundFlight[];
    if (list.length) return list;
  }
  if (!p.icao) throw new Error("Compagnie inconnue : entre le trajet à la main.");
  const r = await fetch(`https://api.adsbdb.com/v0/callsign/${p.icao}${p.number}`);
  if (!r.ok) throw new Error("Vol introuvable. Entre le trajet à la main, ça prend 20 secondes.");
  const j = await r.json();
  const route = j?.response?.flightroute;
  const from = route?.origin?.iata_code, to = route?.destination?.iata_code;
  if (!from || !to || !airport(from) || !airport(to)) throw new Error("Vol introuvable. Entre le trajet à la main.");
  return [{ flightNumber: `${p.iata ?? p.code}${p.number}`, airline: route?.airline?.name ?? p.name, from, to, source: "adsbdb" }];
}

/** All flights from `from` to `to` on `date` (AeroDataBox only). */
export async function searchRoute(from: string, to: string, date: string, key: string): Promise<FoundFlight[]> {
  const q = "?withLeg=true&direction=Departure&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false";
  const halves = [`${date}T00:00/${date}T11:59`, `${date}T12:00/${date}T23:59`];
  const out: FoundFlight[] = [];
  for (const h of halves) {
    const d = await adbFetch(`/flights/airports/iata/${from}/${h}${q}`, key);
    for (const f of d?.departures ?? []) {
      const x = fromAdb(f);
      if (x && x.to === to.toUpperCase()) out.push({ ...x, from: from.toUpperCase() });
    }
  }
  return out.sort((a, b) => (a.dep ?? "").localeCompare(b.dep ?? ""));
}

/** Estimated local arrival for a given local departure. */
export function estimateArrival(from: string, to: string, depLocal: string): string | undefined {
  const a = airport(from), b = airport(to);
  if (!a || !b) return undefined;
  const dep = fromZoned(depLocal, a.tz);
  return toLocalInput(dep + estimateBlockMinutes(a, b) * MIN, b.tz);
}
