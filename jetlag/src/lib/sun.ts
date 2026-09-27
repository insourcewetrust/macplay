// Approximate solar elevation (degrees), good to ~1°, enough to know if it's daylight outside.
const rad = Math.PI / 180;

export function sunElevation(ms: number, lat: number, lon: number): number {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon - ra) * rad;
  const la = lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)) / rad;
}

/** True when there is usable daylight outside (sun above ~ -3°, i.e. past civil twilight's bright half). */
export const isDaylight = (ms: number, lat: number, lon: number) => sunElevation(ms, lat, lon) > -3;
