import { useSyncExternalStore } from "react";
import { airport } from "./airports";
import type { Leg, Profile, Trip } from "./types";

export interface Settings {
  aerodataboxKey?: string;
  theme: "auto" | "light" | "dark";
}

export interface State {
  profile: Profile;
  trips: Trip[];
  settings: Settings;
}

const KEY = "fuseau.v1";

export const defaultProfile: Profile = {
  bedtime: "23:00",
  wake: "07:00",
  caffeineDrink: "coffee",
  caffeineSensitive: false,
  melatonin: false,
  lightGlasses: false,
  sunglasses: true,
  onboarded: false,
};

function load(): State {
  const base: State = { profile: defaultProfile, trips: [], settings: { theme: "auto" } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<State>;
    return {
      profile: { ...defaultProfile, ...s.profile },
      trips: Array.isArray(s.trips) ? mergeRoundTrips(s.trips) : [],
      settings: { ...base.settings, ...s.settings },
    };
  } catch {
    return base;
  }
}

/** Same city or same country: CDG and ORY both count as "Paris". */
function samePlace(a: string, b: string) {
  if (a === b) return true;
  const x = airport(a), y = airport(b);
  return !!x && !!y && x.tz === y.tz && x.country === y.country;
}

const firstDep = (legs: Leg[]) => [...legs].sort((a, b) => a.dep.localeCompare(b.dep))[0];
const lastArr = (legs: Leg[]) => [...legs].sort((a, b) => a.dep.localeCompare(b.dep))[legs.length - 1];

/**
 * Older versions created the outbound and the return as two trips. Merge a one-way trip with the
 * next one-way trip that flies back from its destination to its origin within 60 days.
 */
export function mergeRoundTrips(trips: Trip[]): Trip[] {
  const out = [...trips];
  const removed = new Set<string>();
  const sorted = [...out].sort((a, b) => (firstDep(a.legs)?.dep ?? "").localeCompare(firstDep(b.legs)?.dep ?? ""));
  for (const t of sorted) {
    if (removed.has(t.id) || t.returnLegs?.length || !t.legs.length) continue;
    const o = firstDep(t.legs), d = lastArr(t.legs);
    const back = sorted.find((r) => {
      if (r === t || removed.has(r.id) || r.returnLegs?.length || !r.legs.length) return false;
      const ro = firstDep(r.legs), rd = lastArr(r.legs);
      const gap = (Date.parse(ro.dep.slice(0, 10)) - Date.parse(d.arr.slice(0, 10))) / 86_400_000;
      return samePlace(ro.from, d.to) && samePlace(rd.to, o.from) && gap >= 0 && gap <= 60;
    });
    if (!back) continue;
    const i = out.findIndex((x) => x.id === t.id);
    out[i] = { ...t, returnLegs: back.legs, returnDate: undefined };
    removed.add(back.id);
  }
  return out.filter((t) => !removed.has(t.id));
}

let state = load();
save(); // persist migrations
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode or storage full: keep working in memory */
  }
}

export function setState(fn: (s: State) => State) {
  state = fn(state);
  save();
  listeners.forEach((l) => l());
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getState = () => state;

export const updateProfile = (p: Partial<Profile>) => setState((s) => ({ ...s, profile: { ...s.profile, ...p } }));
export const updateSettings = (p: Partial<Settings>) => setState((s) => ({ ...s, settings: { ...s.settings, ...p } }));
export const saveTrip = (t: Trip) =>
  setState((s) => ({ ...s, trips: s.trips.some((x) => x.id === t.id) ? s.trips.map((x) => (x.id === t.id ? t : x)) : [...s.trips, t] }));
export const deleteTrip = (id: string) => setState((s) => ({ ...s, trips: s.trips.filter((t) => t.id !== id) }));

export function exportData(): string {
  return JSON.stringify({ app: "fuseau", version: 1, ...state }, null, 2);
}

export function importData(json: string) {
  const d = JSON.parse(json);
  if (!d || !Array.isArray(d.trips) || !d.profile) throw new Error("Fichier non reconnu");
  setState(() => ({ profile: { ...defaultProfile, ...d.profile }, trips: d.trips, settings: { theme: "auto", ...d.settings } }));
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** `?now=2026-10-11T08:00Z` in the URL freezes the clock (handy for previews). */
export function nowMs(): number {
  const q = new URLSearchParams(location.search).get("now");
  const t = q ? Date.parse(q) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}
