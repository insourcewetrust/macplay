export type TransportMode = "vtc" | "taxi" | "train" | "metro" | "car" | "drive" | "bus" | "walk";
export type Cabin = "eco" | "premium" | "business" | "first";

export interface Profile {
  name?: string;
  bedtime: string; // "23:00"
  wake: string; // "07:00"
  caffeineDrink: "coffee" | "tea" | "both" | "none";
  caffeineSensitive: boolean;
  melatonin: boolean; // open to taking melatonin
  lightGlasses: boolean; // owns light-therapy glasses (Luminette, AYO…)
  sunglasses: boolean;
  onboarded: boolean;
}

export interface Leg {
  id: string;
  flightNumber?: string; // "AF276"
  airline?: string;
  from: string; // IATA
  to: string; // IATA
  dep: string; // local wall time at `from`, "YYYY-MM-DDTHH:mm"
  arr: string; // local wall time at `to`
  cabin: Cabin;
  aircraft?: string;
  source?: "manual" | "estimate" | "aerodatabox" | "adsbdb";
}

export interface GroundTransport {
  mode: TransportMode;
  minutes: number;
}

export interface Trip {
  id: string;
  legs: Leg[]; // outbound
  returnLegs?: Leg[]; // way back, same trip
  returnPreDays?: number; // 0..3 days easing back to home time before flying home
  toAirport: GroundTransport;
  airportBuffer: number; // minutes at the airport before departure
  fromAirport: GroundTransport;
  preDays: number; // 0..3 days of pre-adjustment at home
  returnDate?: string; // "YYYY-MM-DD", used when the return flight isn't known yet
  stayOnHomeTime?: boolean; // user choice for short trips
  createdAt: number;
}
