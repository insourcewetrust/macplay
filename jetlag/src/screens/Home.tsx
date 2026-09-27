import { cityLabel } from "../lib/airports";
import type { Plan } from "../lib/engine";
import { dayShort, greeting, relDays, signed } from "../lib/format";
import { nowInfo } from "../lib/now";
import { useStore } from "../lib/store";
import { useNow, usePlans } from "../lib/usePlan";
import { Icon, Mark } from "../ui/Icon";
import { go } from "../ui/router";
import { NowCard } from "./NowCard";
import { useState } from "react";

export function Home() {
  const { profile, trips } = useStore();
  const now = useNow();
  const plans = usePlans(profile, trips).sort((a, b) => a.plan.departure - b.plan.departure);
  const active = plans.find((p) => now >= p.plan.start && now <= p.plan.end);
  const upcoming = plans.filter((p) => p !== active && p.plan.start > now);
  const past = plans.filter((p) => p !== active && p.plan.end < now).reverse();
  const [showPast, setShowPast] = useState(false);
  const tz = active?.plan && now > active.plan.arrival ? active.plan.destTz : Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="screen">
      <div className="topbar">
        <span className="brand">
          <Mark size={26} /> Fuseau
        </span>
        <span className="spacer" />
        <button className="fab" aria-label="Ajouter un voyage" onClick={() => go("/new")}>
          <Icon name="plus" size={22} />
        </button>
      </div>

      <div className="hello">
        <div className="eyebrow">{dayShort(now, tz)}</div>
        <h1>
          {greeting(now, tz)}
          {profile.name ? `, ${profile.name}` : ""}.
        </h1>
      </div>

      {active && <NowCard plan={active.plan} now={now} />}

      {!plans.length && (
        <div className="card empty">
          <svg className="art" width="140" height="84" viewBox="0 0 140 84" aria-hidden="true">
            <path d="M8 70 C 40 10, 100 10, 132 70" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="4 6" />
            <circle cx="8" cy="70" r="6" fill="var(--sun)" />
            <circle cx="132" cy="70" r="6" fill="var(--sleep)" />
            <g transform="translate(62 18) rotate(20)" color="var(--text)">
              <path
                d="M17.8 19.2 16 11l3.5-3.5A2.12 2.12 0 0 0 16.5 4.5L13 8 4.8 6.2a.5.5 0 0 0-.5.2l-.6.6a.5.5 0 0 0 .1.8L10 11l-3 3H4l-1 1 3 2 2 3 1-1v-3l3-3 3.2 6.2a.5.5 0 0 0 .8.1l.6-.6a.5.5 0 0 0 .2-.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </g>
          </svg>
          <h3 style={{ fontSize: 20 }}>Où pars-tu ?</h3>
          <p className="muted" style={{ margin: "8px auto 20px", maxWidth: 320 }}>
            Entre ton numéro de vol ou colle ta confirmation de réservation. Ton plan est prêt en quelques secondes.
          </p>
          <button className="btn accent" onClick={() => go("/new")}>
            <Icon name="plus" size={18} /> Ajouter un voyage
          </button>
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <h2>{active ? "Ensuite" : "À venir"}</h2>
          <div className="stack">
            {upcoming.map(({ trip, plan }) => (
              <TripCard key={trip.id} plan={plan} now={now} />
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2>
            <button className="row" style={{ gap: 6, font: "inherit", color: "inherit", letterSpacing: "inherit" }} onClick={() => setShowPast(!showPast)}>
              Passés ({past.length}) <Icon name={showPast ? "down" : "chevron"} size={14} />
            </button>
          </h2>
          {showPast && (
            <div className="stack">
              {past.map(({ trip, plan }) => (
                <TripCard key={trip.id} plan={plan} now={now} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function TripCard({ plan, now }: { plan: Plan; now: number }) {
  const info = nowInfo(plan, now);
  const prepStart = plan.days[0];
  const isPast = info.after;
  const legs = plan.trip.legs.length;
  return (
    <button className="card tap" onClick={() => go(`/trip/${plan.trip.id}`)} style={isPast ? { opacity: 0.7 } : undefined}>
      <div className="row between small muted">
        <span>{dayShort(plan.departure, plan.homeTz)}</span>
        <span>{isPast ? "Terminé" : relDays(plan.departure, now)}</span>
      </div>
      <div className="route" style={{ marginTop: 10 }}>
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
      <div className="trip-meta">
        {plan.strategy === "none" ? (
          <span className="pill ghost">Pas de décalage</span>
        ) : (
          <span className={`pill ${plan.shiftH > 0 ? "sun" : "sleep"}`}>
            {signed(plan.shiftH)} · {plan.shiftH > 0 ? "vers l'est" : "vers l'ouest"}
          </span>
        )}
        {plan.strategy === "stay" && <span className="pill ghost">Séjour court</span>}
        {(plan.strategy === "advance" || plan.strategy === "delay") && <span className="pill ghost">~{Math.max(1, plan.adaptDays)} j d'adaptation</span>}
        {legs > 1 && <span className="pill ghost">{legs - 1} escale{legs > 2 ? "s" : ""}</span>}
        {!isPast && plan.trip.preDays > 0 && prepStart && prepStart.start > now && (
          <span className="pill ghost">Prépa dès {dayShort(prepStart.start, plan.homeTz)}</span>
        )}
      </div>
    </button>
  );
}
