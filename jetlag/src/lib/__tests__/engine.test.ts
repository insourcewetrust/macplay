declare const process: { env: Record<string, string | undefined> };
import { describe, expect, it } from "vitest";
import { buildPlan, type Plan } from "../engine";
import { hmToMin, zoned } from "../time";
import type { Profile, Trip } from "../types";

const profile: Profile = {
  bedtime: "23:00", wake: "07:00", caffeineDrink: "coffee", caffeineSensitive: false,
  melatonin: true, lightGlasses: false, sunglasses: true, onboarded: true,
};

const trip = (legs: Trip["legs"], extra: Partial<Trip> = {}): Trip => ({
  id: "t", legs, toAirport: { mode: "vtc", minutes: 45 }, airportBuffer: 150,
  fromAirport: { mode: "taxi", minutes: 60 }, preDays: 2, createdAt: 0, ...extra,
});

const TYO = { id: "o1", from: "CDG", to: "HND", dep: "2026-10-10T19:30", arr: "2026-10-11T15:05", cabin: "eco" as const, flightNumber: "AF274" };
const TYO_BACK = (date: string) => ({ id: "r1", from: "HND", to: "CDG", dep: `${date}T10:25`, arr: `${date}T17:40`, cabin: "eco" as const, flightNumber: "AF279" });

function dump(p: Plan) {
  const lines = [`shift ${p.shiftH} ${p.strategy} target ${p.targetH} adapt ${p.adaptDays} back ${p.back?.strategy} ${p.back?.targetH.toFixed(1)} ${p.back?.adaptDays}d aligned@return ${p.alignedAtReturn?.toFixed(2)}`];
  for (const d of p.days) {
    lines.push(`== ${d.label} ${d.dateKey} [${d.tz}${d.altTz ? " / " + d.altTz : ""}] ${Math.round(d.progress * 100)}% · ${d.focus}`);
    for (const e of d.events) {
      const s = zoned(e.start, d.tz), en = e.end ? zoned(e.end, d.tz) : null;
      lines.push(`  ${s.dateKey.slice(5)} ${s.hm}${en ? "-" + en.hm : "      "} [${e.place}] ${e.kind}: ${e.title}`);
    }
  }
  return lines.join("\n");
}

/** Local bedtimes (minutes, after-midnight as > 1440) of main sleeps on the ground. */
const bedtimes = (p: Plan) =>
  p.events.filter((e) => e.kind === "sleep" && e.place !== "air" && !e.detail?.startsWith("Couche-toi dès")).map((e) => {
    const m = zoned(e.start, p.tzAt(e.start)).minutes;
    return m < 12 * 60 ? m + 1440 : m;
  });

describe("engine", () => {
  it("Paris -> Tokyo, one way", () => {
    const p = buildPlan(profile, trip([TYO]))!;
    if (process.env.DUMP) console.log(dump(p));
    expect(p.strategy).toBe("advance");
    expect(p.shiftH).toBe(7);
    expect(p.events.some((e) => e.kind === "sleep" && e.place === "air")).toBe(true);
  });

  it("never asks for unliveable bedtimes, even with 3 days of preparation", () => {
    for (const legs of [[TYO], [{ id: "n", from: "CDG", to: "JFK", dep: "2026-10-10T10:30", arr: "2026-10-10T12:45", cabin: "eco" as const }]]) {
      const p = buildPlan(profile, trip(legs, { preDays: 3 }))!;
      for (const m of bedtimes(p)) {
        expect(m).toBeGreaterThanOrEqual(hmToMin("21:30") - 60); // early-flight nights may start 1 h earlier
        expect(m).toBeLessThanOrEqual(hmToMin("00:30") + 1440);
      }
    }
  });

  it("outbound day is displayed in home time", () => {
    const p = buildPlan(profile, trip([TYO]))!;
    const out = p.days.find((d) => d.phase === "out")!;
    expect(out.tz).toBe("Europe/Paris");
    expect(out.altTz).toBe("Asia/Tokyo");
    expect(p.tzAt(p.arrival + 30 * 60_000)).toBe("Europe/Paris");
  });

  it("round trip with 4 nights: partial adaptation, then back home", () => {
    const p = buildPlan(profile, trip([TYO], { returnLegs: [TYO_BACK("2026-10-15")], returnPreDays: 1 }))!;
    if (process.env.DUMP) console.log(dump(p));
    expect(p.back).toBeDefined();
    expect(p.alignedAtReturn!).toBeLessThan(1);
    expect(p.back!.strategy).toBe("delay");
    expect(p.days.some((d) => d.phase === "back")).toBe(true);
    expect(p.days.some((d) => d.phase === "home")).toBe(true);
    // The stay never claims to be fully aligned right before the return.
    const lastStay = p.days.filter((d) => d.phase === "stay").pop()!;
    expect(lastStay.focus).toMatch(/retour approche/);
  });

  it("round trip of 2 nights stays on home time", () => {
    const nyc = { id: "n", from: "CDG", to: "JFK", dep: "2026-10-10T10:30", arr: "2026-10-10T12:45", cabin: "eco" as const };
    const back = { id: "b", from: "JFK", to: "CDG", dep: "2026-10-12T18:00", arr: "2026-10-13T07:30", cabin: "eco" as const };
    const p = buildPlan(profile, trip([nyc], { returnLegs: [back] }))!;
    if (process.env.DUMP) console.log(dump(p));
    expect(p.strategy).toBe("stay");
    expect(p.stayNights).toBe(2);
    expect(Math.abs(p.bodyOffsetAt(p.back!.departure))).toBeLessThan(0.5);
  });

  it("Paris -> Sydney via Dubai is planned as a delay", () => {
    const p = buildPlan(profile, trip([
      { id: "l1", from: "CDG", to: "DXB", dep: "2026-11-10T21:30", arr: "2026-11-11T06:30", cabin: "eco" },
      { id: "l2", from: "DXB", to: "SYD", dep: "2026-11-11T09:30", arr: "2026-11-12T05:30", cabin: "eco" },
    ]))!;
    expect(p.shiftH).toBe(10);
    expect(p.strategy).toBe("delay");
  });

  it("legacy trips holding the return inside legs are split", () => {
    const p = buildPlan(profile, trip([TYO, TYO_BACK("2026-10-20")]))!;
    expect(p.back).toBeDefined();
    expect(p.dest.iata).toBe("HND");
  });

  it("domestic flight has no shift", () => {
    const p = buildPlan(profile, trip([{ id: "l1", from: "ORY", to: "NCE", dep: "2026-10-10T10:30", arr: "2026-10-10T11:50", cabin: "eco" }]))!;
    expect(p.strategy).toBe("none");
  });
});
