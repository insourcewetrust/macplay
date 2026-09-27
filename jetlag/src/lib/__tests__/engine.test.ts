import { describe, expect, it } from "vitest";
import { buildPlan } from "../engine";
import { zoned } from "../time";
import type { Profile, Trip } from "../types";

const profile: Profile = {
  bedtime: "23:00", wake: "07:00", caffeineDrink: "coffee", caffeineSensitive: false,
  melatonin: true, lightGlasses: false, sunglasses: true, onboarded: true,
};

const trip = (legs: Trip["legs"], extra: Partial<Trip> = {}): Trip => ({
  id: "t", legs, toAirport: { mode: "vtc", minutes: 45 }, airportBuffer: 150,
  fromAirport: { mode: "taxi", minutes: 60 }, preDays: 2, createdAt: 0, ...extra,
});

function dump(t: Trip) {
  const p = buildPlan(profile, t)!;
  const lines = [`shift ${p.shiftH} strategy ${p.strategy} target ${p.targetH} adapt ${p.adaptDays} (no plan ${p.adaptDaysNoPlan})`];
  for (const d of p.days) {
    lines.push(`== ${d.label} ${d.dateKey} (${Math.round(d.progress * 100)}%) ${d.focus}`);
    for (const e of d.events) {
      const s = zoned(e.start, e.tz), en = e.end ? zoned(e.end, e.tz) : null;
      lines.push(`  ${s.dateKey.slice(5)} ${s.hm}${en ? "-" + en.hm : "      "} [${e.place}] ${e.kind}: ${e.title}`);
    }
  }
  return { p, text: lines.join("\n") };
}

describe("engine", () => {
  it("Paris -> Tokyo overnight, eastward advance", () => {
    const { p, text } = dump(trip([{ id: "l1", from: "CDG", to: "HND", dep: "2026-10-10T19:30", arr: "2026-10-11T15:05", cabin: "eco", flightNumber: "AF274" }]));
    console.log(text);
    expect(p.strategy).toBe("advance");
    expect(p.shiftH).toBe(7);
    expect(p.events.some((e) => e.kind === "sleep" && e.place === "air")).toBe(true);
  });

  it("Paris -> New York, westward delay", () => {
    const { p, text } = dump(trip([{ id: "l1", from: "CDG", to: "JFK", dep: "2026-10-10T10:30", arr: "2026-10-10T12:45", cabin: "eco" }]));
    console.log(text);
    expect(p.strategy).toBe("delay");
    expect(p.shiftH).toBe(-6);
  });

  it("Paris -> Sydney via Dubai, big eastward planned as delay", () => {
    const { p, text } = dump(trip([
      { id: "l1", from: "CDG", to: "DXB", dep: "2026-11-10T21:30", arr: "2026-11-11T06:30", cabin: "eco" },
      { id: "l2", from: "DXB", to: "SYD", dep: "2026-11-11T09:30", arr: "2026-11-12T05:30", cabin: "eco" },
    ]));
    console.log(text);
    expect(p.shiftH).toBe(10);
    expect(p.strategy).toBe("delay");
  });

  it("short trip to NYC stays on home time", () => {
    const { p } = dump(trip([{ id: "l1", from: "CDG", to: "JFK", dep: "2026-10-10T10:30", arr: "2026-10-10T12:45", cabin: "eco" }], { returnDate: "2026-10-12" }));
    expect(p.strategy).toBe("stay");
  });

  it("domestic flight has no shift", () => {
    const { p } = dump(trip([{ id: "l1", from: "ORY", to: "NCE", dep: "2026-10-10T10:30", arr: "2026-10-10T11:50", cabin: "eco" }]));
    expect(p.strategy).toBe("none");
  });
});
