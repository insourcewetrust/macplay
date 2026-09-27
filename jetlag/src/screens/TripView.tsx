import { useEffect, useRef, useState } from "react";
import { cityLabel } from "../lib/airports";
import type { Plan, PlanDay, PlanEvent } from "../lib/engine";
import { dayLong, dayShort, hmShort, signed } from "../lib/format";
import { downloadIcs } from "../lib/ics";
import { deleteTrip, useStore } from "../lib/store";
import { planFor, useNow } from "../lib/usePlan";
import { MIN } from "../lib/time";
import { Icon } from "../ui/Icon";
import { go } from "../ui/router";
import { DayStrip, KIND_META, Legend } from "../ui/visuals";
import { NowCard } from "./NowCard";
import { Toast } from "../ui/controls";

export function TripView({ id }: { id: string }) {
  const { profile, trips } = useStore();
  const trip = trips.find((t) => t.id === id);
  const now = useNow();
  const plan = trip ? planFor(profile, trip) : null;
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const todayIdx = plan ? plan.days.findIndex((d) => now >= d.start && now < d.end) : -1;
  const [sel, setSel] = useState(() => Math.max(0, todayIdx));
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [sel]);

  if (!trip || !plan) {
    return (
      <div className="screen">
        <div className="topbar">
          <button className="icon-btn" aria-label="Retour" onClick={() => go("/")}>
            <Icon name="back" />
          </button>
        </div>
        <div className="card empty">
          <h3>Voyage introuvable</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Il a peut-être été supprimé.
          </p>
        </div>
      </div>
    );
  }

  const day = plan.days[Math.min(sel, plan.days.length - 1)];
  const active = now >= plan.start && now <= plan.end;
  const overall = plan.targetH ? Math.min(1, Math.abs(plan.bodyOffsetAt(now)) / Math.abs(plan.targetH)) : 1;

  return (
    <div className="screen">
      <div className="topbar" style={{ position: "relative" }}>
        <button className="icon-btn" aria-label="Retour" onClick={() => go("/")}>
          <Icon name="back" />
        </button>
        <div className="grow topbar-title">{cityLabel(plan.dest)}</div>
        <button className="icon-btn" aria-label="Options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="more" />
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => go(`/edit/${trip.id}`)}>
              <Icon name="edit" size={18} /> Modifier le voyage
            </button>
            <button
              role="menuitem"
              onClick={() => {
                downloadIcs(plan);
                setMenu(false);
                setToast("Fichier calendrier créé. Ouvre-le pour ajouter les rappels.");
              }}
            >
              <Icon name="calendar" size={18} /> Ajouter à mon calendrier
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                if (confirm("Supprimer ce voyage et son plan ?")) {
                  deleteTrip(trip.id);
                  go("/");
                }
              }}
            >
              <Icon name="trash" size={18} /> Supprimer
            </button>
          </div>
        )}
      </div>

      <div className="card hero">
        <div className="row between small muted">
          <span>
            {dayShort(plan.departure, plan.homeTz)} → {dayShort(plan.arrival, plan.destTz)}
          </span>
          <span className="tnum">{trip.legs.map((l) => l.flightNumber).filter(Boolean).join(" · ")}</span>
        </div>
        <div className="route" style={{ marginTop: 12 }}>
          <div>
            <div className="code">{plan.home.iata}</div>
            <div className="xsmall muted">{cityLabel(plan.home)}</div>
          </div>
          <div className="line">
            <Icon name="plane" size={22} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="code">{plan.dest.iata}</div>
            <div className="xsmall muted">{cityLabel(plan.dest)}</div>
          </div>
        </div>
        <div className="hero-grid">
          <div className="shift" style={{ color: plan.shiftH > 0 ? "var(--sun)" : plan.shiftH < 0 ? "var(--sleep)" : "var(--muted)" }}>
            {signed(plan.shiftH)}
          </div>
          <div className="small">
            <b>{strategyTitle(plan)}</b>
            <div className="muted">{strategyLine(plan)}</div>
            {(plan.strategy === "advance" || plan.strategy === "delay") && (
              <>
                <div className="adapt-bar" aria-label={`Horloge alignée à ${Math.round(overall * 100)} %`}>
                  <span style={{ width: `${Math.max(3, overall * 100)}%` }} />
                </div>
                <div className="xsmall faint" style={{ marginTop: 4 }}>
                  {active || now > plan.end ? `Horloge alignée à ${Math.round(overall * 100)} %` : "Ton horloge interne, jour après jour"}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {active && (
        <div style={{ marginTop: 12 }}>
          <NowCard plan={plan} now={now} onClick={() => todayIdx >= 0 && setSel(todayIdx)} />
        </div>
      )}

      <h2>Jour par jour</h2>
      <div className="days" ref={chipsRef} role="group" aria-label="Jours du plan">
        {plan.days.map((d, i) => (
          <button key={d.key} className="day-chip" aria-pressed={i === sel} onClick={() => setSel(i)}>
            <span className="l">{d.label}</span>
            <span className="d">{d.phase === "travel" ? dayShort(plan.departure, plan.homeTz).replace(/\.$/, "") : shortDate(d)}</span>
            <ProgressDot value={d.progress} today={i === todayIdx} />
          </button>
        ))}
      </div>

      <DayPanel plan={plan} day={day} now={now} />

      <div className="stack" style={{ marginTop: 24 }}>
        <button
          className="btn soft block"
          onClick={() => {
            downloadIcs(plan);
            setToast("Fichier calendrier créé. Ouvre-le pour ajouter les rappels.");
          }}
        >
          <Icon name="calendar" size={18} /> Ajouter les rappels à mon calendrier
        </button>
        <HowItWorks plan={plan} />
      </div>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function shortDate(d: PlanDay) {
  const [, m, dd] = d.dateKey.split("-").map(Number);
  return `${dd}/${String(m).padStart(2, "0")}`;
}

function ProgressDot({ value, today }: { value: number; today: boolean }) {
  const r = 7, c = 2 * Math.PI * r;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={value >= 0.999 ? "var(--mela)" : "currentColor"} strokeWidth="2.5" strokeDasharray={`${c * value} ${c}`} strokeLinecap="round" transform="rotate(-90 10 10)" />
      {today && <circle cx="10" cy="10" r="2.5" fill="var(--mela)" />}
    </svg>
  );
}

function strategyTitle(p: Plan) {
  switch (p.strategy) {
    case "none":
      return "Pas de décalage à gérer";
    case "stay":
      return "Séjour court : on ne bouge pas ton horloge";
    case "advance":
      return `Avancer ton horloge de ${signed(p.targetH).replace("+", "")}`;
    case "delay":
      return `Reculer ton horloge de ${signed(-p.targetH).replace("+", "")}`;
  }
}

function strategyLine(p: Plan) {
  if (p.strategy === "none") return "On s'occupe surtout de ton vol et de ta forme.";
  if (p.strategy === "stay") return `Garde l'heure de ${cityLabel(p.home)} autant que possible.`;
  const days = Math.max(1, p.adaptDays);
  return `~${days} jour${days > 1 ? "s" : ""} avec le plan, ~${p.adaptDaysNoPlan} sans.`;
}

function DayPanel({ plan, day, now }: { plan: Plan; day: PlanDay; now: number }) {
  const [legend, setLegend] = useState(false);
  const travel = day.phase === "travel";
  const events = day.events;
  const place = day.tz === plan.destTz ? plan.dest : plan.home;
  return (
    <section aria-label={day.label}>
      <div className="day-head">
        <div>
          <div className="small muted" style={{ textTransform: "capitalize" }}>
            {dayLong(day.start, day.tz)}
          </div>
        </div>
        <span className="xsmall faint">{travel ? `heures de ${cityLabel(plan.home)} puis ${cityLabel(plan.dest)}` : `heure de ${cityLabel(place)}`}</span>
      </div>
      <p className="focus">{day.focus}</p>
      <button className="row xsmall muted" style={{ marginTop: 10, gap: 4 }} onClick={() => setLegend(!legend)} aria-expanded={legend}>
        <Icon name="info" size={14} /> {legend ? "Masquer la légende" : "Lire la frise"}
      </button>
      <DayStrip day={day} plan={plan} now={now} />
      {legend && <Legend />}
      <div className="timeline">
        {events.length === 0 && <p className="muted small">Rien de particulier ce jour-là.</p>}
        {events.map((e) => (
          <EventRow key={e.id} e={e} plan={plan} now={now} travel={travel} />
        ))}
      </div>
    </section>
  );
}

function EventRow({ e, plan, now, travel }: { e: PlanEvent; plan: Plan; now: number; travel: boolean }) {
  const meta = KIND_META[e.kind];
  const [open, setOpen] = useState(false);
  const past = (e.end ?? e.start + 30 * MIN) < now;
  const current = e.end ? e.start <= now && now < e.end : false;
  const hasMore = !!e.bullets?.length;
  const otherTz = e.tz === plan.destTz ? plan.homeTz : plan.destTz;
  const dur = e.end ? e.end - e.start : 0;
  return (
    <button
      className={`ev${past ? " past" : ""}${current ? " current" : ""}`}
      onClick={() => hasMore && setOpen(!open)}
      aria-expanded={hasMore ? open : undefined}
      style={{ cursor: hasMore ? "pointer" : "default" }}
    >
      <div className="time">
        {hmShort(e.start, e.tz)}
        {travel && plan.homeTz !== plan.destTz ? (
          <small title="Même instant, autre fuseau">
            {hmShort(e.start, otherTz)} {otherTz === plan.homeTz ? plan.home.iata : plan.dest.iata}
          </small>
        ) : (
          e.end && dur >= 30 * MIN && <small>{hmShort(e.end, e.tz)}</small>
        )}
      </div>
      <div className={`ico tone-${meta.tone}`}>
        <Icon name={meta.icon} size={18} />
      </div>
      <div className="body">
        <div className="title">
          {e.title}
          {e.optional && <span className="opt">optionnel</span>}
        </div>
        {travel && e.end && dur >= 30 * MIN && <div className="sub tnum">jusqu'à {hmShort(e.end, e.tz)}</div>}
        {e.detail && <div className="sub">{e.detail}</div>}
        {hasMore && !open && <div className="sub" style={{ color: "var(--accent)", marginTop: 4 }}>{e.bullets!.length > 1 ? `${e.bullets!.length} conseils` : "Voir le conseil"}</div>}
        {hasMore && open && (
          <ul className="more">
            {e.bullets!.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </button>
  );
}

function HowItWorks({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const east10 = plan.strategy === "delay" && plan.shiftH > 0;
  return (
    <div className="card flat" style={{ padding: 16 }}>
      <button className="row between" style={{ width: "100%" }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="row" style={{ gap: 8, fontWeight: 600 }}>
          <Icon name="info" size={18} /> Comment ce plan est calculé
        </span>
        <Icon name={open ? "down" : "chevron"} size={16} />
      </button>
      {open && (
        <div className="prose small" style={{ marginTop: 12, fontSize: 15 }}>
          <p>
            On part de tes horaires ({plan.trip.legs.length > 1 ? "avec tes escales, " : ""}coucher et réveil habituels) pour situer ton point bas de température, environ 2 h 30 avant ton réveil. La lumière reçue après ce point avance ton horloge, celle reçue avant la retarde.
          </p>
          {plan.strategy === "advance" && <p>Ici ton horloge doit avancer : on cherche la lumière juste après ce point et on l'évite juste avant. Ces fenêtres glissent chaque jour, à mesure que ton corps s'adapte.</p>}
          {plan.strategy === "delay" && !east10 && <p>Ici ton horloge doit reculer : lumière en fin de journée, pas de lumière vive tôt le matin.</p>}
          {east10 && (
            <p>
              Avancer de {signed(plan.shiftH).replace("+", "")} est risqué : ton horloge pourrait partir dans le mauvais sens. On la fait plutôt reculer de {signed(-plan.targetH).replace("+", "")}, plus long sur le papier, mais bien plus doux.
            </p>
          )}
          <p>
            Rythme estimé : {String(plan.rateH).replace(".", ",")} h par jour en suivant le plan ({String(plan.rateNoPlanH).replace(".", ",")} h sans). Le sommeil en vol n'est proposé que s'il est réaliste : ni à la porte, ni au décollage, et seulement quand c'est la nuit à destination (ou quand ta dette de sommeil devient trop grosse).
          </p>
          <p>
            <a href="#/guide">Tout le détail et les sources dans le Guide</a>.
          </p>
        </div>
      )}
    </div>
  );
}
