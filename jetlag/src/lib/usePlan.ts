import { useEffect, useMemo, useState } from "react";
import { buildPlan, type Plan } from "./engine";
import { nowMs } from "./store";
import type { Profile, Trip } from "./types";

const cache = new WeakMap<Trip, { profile: Profile; plan: Plan | null }>();

export function planFor(profile: Profile, trip: Trip): Plan | null {
  const c = cache.get(trip);
  if (c && c.profile === profile) return c.plan;
  let plan: Plan | null = null;
  try {
    plan = buildPlan(profile, trip);
  } catch (e) {
    console.error(e);
  }
  cache.set(trip, { profile, plan });
  return plan;
}

export function usePlans(profile: Profile, trips: Trip[]) {
  return useMemo(
    () => trips.map((t) => ({ trip: t, plan: planFor(profile, t) })).filter((x): x is { trip: Trip; plan: Plan } => !!x.plan),
    [profile, trips],
  );
}

/** Current time, refreshed every 30 s. */
export function useNow() {
  const [n, setN] = useState(nowMs);
  useEffect(() => {
    const t = setInterval(() => setN(nowMs()), 30_000);
    const vis = () => document.visibilityState === "visible" && setN(nowMs());
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  return n;
}
