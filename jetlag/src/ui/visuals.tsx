import type { EventKind, Plan, PlanDay, PlanEvent } from "../lib/engine";
import { zoned, HOUR, mod } from "../lib/time";

export const KIND_META: Record<EventKind, { icon: string; tone: string }> = {
  sleep: { icon: "moon", tone: "sleep" },
  nap: { icon: "moon", tone: "sleep" },
  "light-seek": { icon: "sun", tone: "sun" },
  "light-avoid": { icon: "shades", tone: "shade" },
  melatonin: { icon: "pill", tone: "mela" },
  caffeine: { icon: "cup", tone: "coffee" },
  "caffeine-boost": { icon: "bolt", tone: "coffee" },
  transport: { icon: "car", tone: "accent" },
  airport: { icon: "gate", tone: "accent" },
  boarding: { icon: "suitcase", tone: "accent" },
  takeoff: { icon: "takeoff", tone: "accent" },
  meal: { icon: "meal", tone: "accent" },
  flight: { icon: "plane", tone: "accent" },
  landing: { icon: "landing", tone: "accent" },
  arrival: { icon: "building", tone: "accent" },
  layover: { icon: "layover", tone: "accent" },
  move: { icon: "walk", tone: "mela" },
  tip: { icon: "spark", tone: "accent" },
};

/** A calm horizontal bar showing the day's windows at a glance. */
export function DayStrip({ day, plan, now }: { day: PlanDay; plan: Plan; now: number }) {
  // Show a full local day for normal days, the actual span for the travel day.
  const start = day.phase === "travel" ? Math.min(day.start, plan.leaveHome - 2 * HOUR) : day.start;
  const end = day.end;
  const rangeStart = day.phase === "travel" ? start : day.end - 24 * HOUR;
  const span = end - rangeStart;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - rangeStart) / span) * 100))}%`;
  const width = (s: number, e: number) => `${Math.max(0, ((Math.min(e, end) - Math.max(s, rangeStart)) / span) * 100)}%`;
  const inRange = (e: PlanEvent) => (e.end ?? e.start) > rangeStart && e.start < end;
  const evs = plan.events.filter(inRange);
  const ticks = 5;
  const tickLabels = Array.from({ length: ticks }, (_, i) => zoned(rangeStart + (span * i) / (ticks - 1), day.tz).hm);

  return (
    <div className="strip" aria-hidden="true">
      <div className="strip-track">
        {evs
          .filter((e) => e.kind === "flight")
          .map((e) => (
            <div key={e.id} className="strip-band air" style={{ left: pct(e.start), width: width(e.start, e.end!) }} />
          ))}
        {evs
          .filter((e) => e.kind === "sleep" || e.kind === "nap")
          .map((e) => (
            <div key={e.id} className={`strip-band ${e.kind}`} style={{ left: pct(e.start), width: width(e.start, e.end!) }} />
          ))}
        {evs
          .filter((e) => e.kind === "light-seek" || e.kind === "light-avoid")
          .map((e) => (
            <div key={e.id} className={`strip-band ${e.kind === "light-seek" ? "seek" : "avoid"}`} style={{ left: pct(e.start), width: width(e.start, e.end!) }} />
          ))}
        {evs
          .filter((e) => e.kind === "caffeine")
          .map((e) => (
            <div key={e.id} className="strip-caf" style={{ left: pct(e.start), width: width(e.start, e.end!) }} />
          ))}
        {evs
          .filter((e) => e.kind === "melatonin")
          .map((e) => (
            <div key={e.id} className="strip-dot" style={{ left: pct(e.start) }} />
          ))}
        {now >= rangeStart && now < end && <div className="strip-now" style={{ left: pct(now) }} />}
      </div>
      <div className="strip-ticks">
        {tickLabels.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span>
        <i style={{ background: "color-mix(in srgb, var(--sleep) 55%, transparent)" }} />
        Sommeil
      </span>
      <span>
        <i style={{ background: "color-mix(in srgb, var(--sun) 55%, transparent)" }} />
        Lumière
      </span>
      <span>
        <i style={{ background: "repeating-linear-gradient(135deg, var(--shade) 0 2px, transparent 2px 4px)" }} />
        Pas de lumière
      </span>
      <span>
        <i style={{ background: "var(--coffee)", height: 3, borderRadius: 2, verticalAlign: 3 }} />
        Caféine OK
      </span>
      <span>
        <i style={{ background: "var(--mela)", borderRadius: "50%" }} />
        Mélatonine
      </span>
    </div>
  );
}

/** Two-hand 24 h dial: local time vs the time your body thinks it is. */
export function BodyDial({ localMin, bodyMin, size = 76, bed, wake }: { localMin: number; bodyMin: number; size?: number; bed: number; wake: number }) {
  const r = size / 2 - 5;
  const c = size / 2;
  const pt = (min: number, rr: number) => {
    const a = (mod(min, 1440) / 1440) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(a) * rr, c + Math.sin(a) * rr];
  };
  // Body night arc, drawn on the local dial where the body's night currently falls.
  const delta = localMin - bodyMin;
  const nightStart = bed + delta;
  const nightLen = mod(wake - bed, 1440);
  const [sx, sy] = pt(nightStart, r);
  const [ex, ey] = pt(nightStart + nightLen, r);
  const large = nightLen > 720 ? 1 : 0;
  const [lx, ly] = pt(localMin, r - 10);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="6" />
      <path d={`M${sx},${sy} A${r},${r} 0 ${large} 1 ${ex},${ey}`} fill="none" stroke="var(--sleep)" strokeWidth="6" strokeLinecap="round" opacity="0.8" />
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = pt(h * 60, r - 12);
        return <circle key={h} cx={x} cy={y} r="1.2" fill="var(--faint)" />;
      })}
      <line x1={c} y1={c} x2={lx} y2={ly} stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={c} cy={c} r="3" fill="var(--text)" />
    </svg>
  );
}
