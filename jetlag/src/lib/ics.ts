import type { Plan, PlanEvent } from "./engine";

const EXPORTED: PlanEvent["kind"][] = ["sleep", "nap", "light-seek", "light-avoid", "melatonin", "caffeine", "transport", "boarding"];

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");

// RFC 5545: fold lines longer than 75 octets.
const fold = (line: string) => {
  const out: string[] = [];
  let cur = line;
  while (cur.length > 74) {
    out.push(cur.slice(0, 74));
    cur = " " + cur.slice(74);
  }
  out.push(cur);
  return out.join("\r\n");
};

export function planToIcs(plan: Plan): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fuseau//Jet lag plan//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:Fuseau · ${plan.dest.iata}`];
  const now = stamp(Date.now());
  for (const e of plan.events) {
    if (!EXPORTED.includes(e.kind)) continue;
    // A caffeine window becomes a single "last coffee" reminder.
    const isCaf = e.kind === "caffeine";
    const start = isCaf ? e.end! - 30 * 60_000 : e.start;
    const end = isCaf ? e.end! : e.end ?? e.start + 15 * 60_000;
    const title = isCaf ? `Dernier café ou thé (limite ${e.title.split("jusqu'à ")[1] ?? ""})` : e.title;
    const desc = [e.detail, ...(e.bullets ?? [])].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${plan.trip.id}-${e.id}@fuseau`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${esc(title)}`),
      ...(desc ? [fold(`DESCRIPTION:${esc(desc)}`)] : []),
      "TRANSP:TRANSPARENT",
    );
    if (e.kind !== "sleep") lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "TRIGGER:-PT0M", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(plan: Plan) {
  const blob = new Blob([planToIcs(plan)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fuseau-${plan.home.iata}-${plan.dest.iata}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
