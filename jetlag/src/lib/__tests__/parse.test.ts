import { describe, expect, it } from "vitest";
import { parseBooking } from "../parseBooking";
import { parseFlightNumber } from "../flights";

describe("parseBooking", () => {
  it("reads an Air France style confirmation", () => {
    const txt = `Votre voyage
Aller · samedi 10 octobre 2026
AF 274 Paris (CDG) 19:30 → Tokyo (HND) 15:05 +1
Retour · 20 octobre 2026
AF 279 Tokyo (HND) 10:25 → Paris (CDG) 17:40`;
    const legs = parseBooking(txt, Date.parse("2026-09-01"));
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ flightNumber: "AF274", from: "CDG", to: "HND", dep: "2026-10-10T19:30", arr: "2026-10-11T15:05" });
    expect(legs[1]).toMatchObject({ flightNumber: "AF279", from: "HND", to: "CDG", dep: "2026-10-20T10:25", arr: "2026-10-20T17:40" });
  });

  it("reads English formats", () => {
    const legs = parseBooking("Flight DL 263, Oct 12, 2026. Depart JFK 18:40, arrive CDG 07:55", Date.parse("2026-09-01"));
    expect(legs[0]).toMatchObject({ flightNumber: "DL263", from: "JFK", to: "CDG", dep: "2026-10-12T18:40", arr: "2026-10-13T07:55" });
  });
});

describe("parseFlightNumber", () => {
  it("handles spacing and ICAO", () => {
    expect(parseFlightNumber("af 0276")).toMatchObject({ iata: "AF", icao: "AFR", number: "276" });
    expect(parseFlightNumber("U2 4521")).toMatchObject({ iata: "U2", icao: "EZY" });
    expect(parseFlightNumber("hello")).toBeNull();
  });
});
