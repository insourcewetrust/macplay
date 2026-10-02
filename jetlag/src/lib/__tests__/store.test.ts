import { describe, expect, it } from "vitest";
import { mergeRoundTrips } from "../store";
import type { Trip } from "../types";

const base = { toAirport: { mode: "vtc" as const, minutes: 45 }, airportBuffer: 150, fromAirport: { mode: "taxi" as const, minutes: 45 }, preDays: 0, createdAt: 0 };

describe("mergeRoundTrips", () => {
  it("joins an outbound trip and its separate return", () => {
    const out: Trip = { ...base, id: "a", returnDate: "2026-10-14", legs: [{ id: "1", from: "CDG", to: "HND", dep: "2026-10-10T19:30", arr: "2026-10-11T15:05", cabin: "eco" }] };
    const back: Trip = { ...base, id: "b", legs: [{ id: "2", from: "HND", to: "ORY", dep: "2026-10-14T10:25", arr: "2026-10-14T17:40", cabin: "eco" }] };
    const other: Trip = { ...base, id: "c", legs: [{ id: "3", from: "CDG", to: "JFK", dep: "2026-12-01T10:00", arr: "2026-12-01T12:30", cabin: "eco" }] };
    const r = mergeRoundTrips([out, back, other]);
    expect(r.map((t) => t.id)).toEqual(["a", "c"]);
    expect(r[0].returnLegs?.[0].id).toBe("2");
  });
});
