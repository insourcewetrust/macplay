import { useSyncExternalStore } from "react";
import type { Profile, Trip } from "./types";

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
      trips: Array.isArray(s.trips) ? s.trips : [],
      settings: { ...base.settings, ...s.settings },
    };
  } catch {
    return base;
  }
}

let state = load();
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
