import type { Plan, PlanDay, PlanEvent } from "./engine";

// What matters right now, in priority order.
const PRIORITY: PlanEvent["kind"][] = ["sleep", "nap", "flight", "transport", "airport", "light-avoid", "light-seek", "caffeine"];

export interface NowInfo {
  active: boolean;
  before: boolean;
  after: boolean;
  day?: PlanDay;
  current: PlanEvent[];
  main?: PlanEvent;
  next: PlanEvent[];
  caffeine?: PlanEvent;
}

export function nowInfo(plan: Plan, now: number): NowInfo {
  const before = now < plan.start;
  const after = now > plan.end;
  const day = plan.days.find((d) => now >= d.start && now < d.end) ?? (before ? plan.days[0] : undefined);
  const current = plan.events.filter((e) => e.end && e.start <= now && now < e.end);
  const ranked = [...current].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const main = ranked.find((e) => PRIORITY.includes(e.kind) && e.kind !== "caffeine");
  const next = plan.events.filter((e) => e.start > now && e.kind !== "caffeine").slice(0, 3);
  const caffeine = current.find((e) => e.kind === "caffeine") ?? plan.events.find((e) => e.kind === "caffeine" && e.start > now);
  return { active: !before && !after, before, after, day, current, main, next, caffeine };
}
