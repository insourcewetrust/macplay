import { useMemo, useState } from "react";
import { airport, cityLabel, estimateBlockMinutes, isValidIata } from "../lib/airports";
import { buildPlan, fmtDur, isInternational, legTimes, transportLabel } from "../lib/engine";
import { estimateArrival, lookupFlight, searchRoute, type FoundFlight } from "../lib/flights";
import { signed } from "../lib/format";
import { parseBooking } from "../lib/parseBooking";
import { newId, nowMs, saveTrip, useStore } from "../lib/store";
import { zoned, MIN } from "../lib/time";
import type { Cabin, GroundTransport, Leg, TransportMode, Trip } from "../lib/types";
import { AirportInput, Segmented, Stepper, Switch } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { go } from "../ui/router";

type Method = "number" | "route" | "paste";

const today = () => zoned(nowMs(), Intl.DateTimeFormat().resolvedOptions().timeZone).dateKey;

const emptyLeg = (date = today()): Leg => ({ id: newId(), from: "", to: "", dep: `${date}T`, arr: "", cabin: "eco", source: "estimate" });

function withEstimate(l: Leg): Leg {
  if (l.source !== "estimate") return l;
  if (!airport(l.from) || !airport(l.to) || !/T\d{2}:\d{2}$/.test(l.dep)) return l;
  return { ...l, arr: estimateArrival(l.from, l.to, l.dep) ?? l.arr };
}

function legError(l: Leg): string | null {
  if (!airport(l.from) || !airport(l.to)) return "Choisis les deux aéroports.";
  if (l.from === l.to) return "Départ et arrivée identiques.";
  if (!/T\d{2}:\d{2}$/.test(l.dep)) return "Ajoute l'heure de départ (elle est sur ton billet).";
  if (!/T\d{2}:\d{2}$/.test(l.arr)) return "Ajoute l'heure d'arrivée.";
  const t = legTimes(l);
  if (!t) return "Horaires invalides.";
  const d = (t.arr - t.dep) / MIN;
  if (d <= 15) return "L'arrivée doit être après le départ (heures locales).";
  if (d > 22 * 60) return "Plus de 22 h de vol : vérifie la date d'arrivée.";
  return null;
}

const MODES: { value: TransportMode; label: string }[] = [
  { value: "vtc", label: "VTC" },
  { value: "taxi", label: "Taxi" },
  { value: "train", label: "Train" },
  { value: "metro", label: "Métro / RER" },
  { value: "bus", label: "Navette" },
  { value: "car", label: "Voiture (passager)" },
  { value: "drive", label: "Je conduis" },
  { value: "walk", label: "À pied" },
];

/** Split a list of legs into trips: a new trip starts after a stay of 24 h or more. */
function splitTrips(legs: Leg[]): Leg[][] {
  const sorted = [...legs].filter((l) => legTimes(l)).sort((a, b) => legTimes(a)!.dep - legTimes(b)!.dep);
  const groups: Leg[][] = [];
  for (const l of sorted) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && legTimes(l)!.dep - legTimes(prev)!.arr < 24 * 60 * MIN && prev.to === l.from) g.push(l);
    else groups.push([l]);
  }
  return groups;
}

function defaultTrip(legs: Leg[]): Trip {
  const t: Trip = {
    id: newId(),
    legs,
    toAirport: { mode: "vtc", minutes: 45 },
    airportBuffer: 120,
    fromAirport: { mode: "taxi", minutes: 45 },
    preDays: 0,
    createdAt: Date.now(),
  };
  t.airportBuffer = isInternational(t) ? 150 : 90;
  return t;
}

function recommendedPreDays(shift: number) {
  if (shift >= 4 && shift < 10) return 2;
  if (Math.abs(shift) >= 6) return 1;
  return 0;
}

export function NewTrip({ editId }: { editId?: string }) {
  const { profile, trips, settings } = useStore();
  const editing = editId ? trips.find((t) => t.id === editId) : undefined;
  const [step, setStep] = useState(editing ? 1 : 0);
  const [trip, setTrip] = useState<Trip>(() => editing ?? defaultTrip([emptyLeg()]));
  const [touchedPre, setTouchedPre] = useState(!!editing);

  const setLegs = (legs: Leg[]) => setTrip((t) => ({ ...t, legs }));
  const legsOk = trip.legs.length > 0 && trip.legs.every((l) => !legError(l));

  const plan = useMemo(() => (legsOk ? buildPlan(profile, trip) : null), [profile, trip, legsOk]);

  const goStep = (s: number) => {
    if (s === 2 && !editing) {
      // Sensible door-to-door defaults once we know the route.
      setTrip((t) => ({ ...t, airportBuffer: editing ? t.airportBuffer : isInternational(t) ? 150 : 90 }));
    }
    if (s === 3 && !touchedPre && plan) {
      setTrip((t) => ({ ...t, preDays: recommendedPreDays(plan.shiftH) }));
    }
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  const save = () => {
    saveTrip(trip);
    go(`/trip/${trip.id}`);
  };

  const titles = ["Ton vol", "Vérifie ton itinéraire", "Porte à porte", "Ton séjour"];
  const subs = [
    "Le plus simple : ton numéro de vol. Sinon, le trajet ou ta confirmation de réservation.",
    "Heures locales, comme sur ton billet. Ajoute tes correspondances s'il y en a.",
    "Les trajets et l'attente comptent : c'est là qu'on prend (ou pas) la lumière sans s'en rendre compte.",
    "Deux dernières questions pour caler ton plan.",
  ];

  return (
    <div className="screen" key={step}>
      <div className="topbar">
        <button
          className="icon-btn plain"
          aria-label={step === 0 || (editing && step === 1) ? "Fermer" : "Retour"}
          onClick={() => (step === 0 || (editing && step === 1) ? go(editing ? `/trip/${editing.id}` : "/") : goStep(step - 1))}
        >
          <Icon name={step === 0 || (editing && step === 1) ? "x" : "back"} />
        </button>
        <div className="grow progress-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <div style={{ width: 44 }} />
      </div>

      <div className="wizard-title">{titles[step]}</div>
      <p className="wizard-sub">{subs[step]}</p>

      {step === 0 && (
        <FindFlight
          apiKey={settings.aerodataboxKey}
          onLegs={(legs) => {
            const groups = splitTrips(legs);
            if (groups.length > 1) {
              // Outbound + return pasted together: create every trip, the first one goes through the wizard.
              const [first, ...rest] = groups;
              rest.forEach((g) => saveTrip(defaultTrip(g)));
              const back = groups[1]?.[0];
              setTrip((t) => ({ ...t, legs: first, returnDate: back ? back.dep.slice(0, 10) : t.returnDate }));
            } else setLegs(legs.length ? legs : [emptyLeg()]);
            goStep(1);
          }}
        />
      )}

      {step === 1 && (
        <div className="stack">
          {trip.legs.map((l, i) => (
            <LegEditor
              key={l.id}
              leg={l}
              index={i}
              count={trip.legs.length}
              onChange={(nl) => setLegs(trip.legs.map((x) => (x.id === l.id ? withEstimate(nl) : x)))}
              onRemove={() => setLegs(trip.legs.filter((x) => x.id !== l.id))}
            />
          ))}
          <button
            className="btn soft block"
            onClick={() => {
              const last = trip.legs[trip.legs.length - 1];
              const t = last && legTimes(last);
              const date = t ? zoned(t.arr, t.to.tz).dateKey : today();
              setLegs([...trip.legs, { ...emptyLeg(date), from: last?.to ?? "" }]);
            }}
          >
            <Icon name="plus" size={18} /> Ajouter une correspondance
          </button>
          {plan && <ShiftPreview plan={plan} />}
        </div>
      )}

      {step === 2 && (
        <div className="stack-lg">
          <TransportField
            title={`Pour aller à l'aéroport · ${trip.legs[0].from}`}
            value={trip.toAirport}
            onChange={(v) => setTrip({ ...trip, toAirport: v })}
          />
          <div className="field">
            <span className="label">Arrivée à l'aéroport avant le décollage</span>
            <Stepper value={trip.airportBuffer} step={15} min={30} max={300} onChange={(v) => setTrip({ ...trip, airportBuffer: v })} format={fmtDur} />
          </div>
          <TransportField
            title={`En sortant de l'aéroport · ${trip.legs[trip.legs.length - 1].to}`}
            value={trip.fromAirport}
            onChange={(v) => setTrip({ ...trip, fromAirport: v })}
          />
          {trip.fromAirport.mode === "drive" && (
            <div className="callout tone-warn">
              <Icon name="warn" size={20} />
              <span>Conduire à l'arrivée d'un long vol est un vrai risque de somnolence. Le plan en tiendra compte.</span>
            </div>
          )}
        </div>
      )}

      {step === 3 && plan && (
        <div className="stack-lg">
          <ShiftPreview plan={plan} />
          <div className="field">
            <label htmlFor="ret">Date de retour (optionnel)</label>
            <input
              id="ret"
              className="input"
              type="date"
              value={trip.returnDate ?? ""}
              min={zoned(plan.arrival, plan.destTz).dateKey}
              onChange={(e) => setTrip({ ...trip, returnDate: e.target.value || undefined })}
            />
            <span className="hint">Pour un séjour de 3 nuits ou moins, mieux vaut souvent garder l'heure de chez toi.</span>
          </div>

          {plan.shortTrip && (
            <div className="card flat" style={{ padding: "4px 16px" }}>
              <div className="toggle-row">
                <div className="text">
                  <div style={{ fontWeight: 600 }}>Rester à l'heure de chez moi</div>
                  <div className="small muted">Recommandé pour un séjour court avec {signed(plan.shiftH)} de décalage.</div>
                </div>
                <Switch checked={trip.stayOnHomeTime !== false} onChange={(v) => setTrip({ ...trip, stayOnHomeTime: v })} label="Rester à l'heure de chez moi" />
              </div>
            </div>
          )}

          {(plan.strategy === "advance" || plan.strategy === "delay") && (
            <div className="field">
              <span className="label">Commencer à s'adapter avant de partir ?</span>
              <div className="stack">
                {[0, 1, 2, 3].map((n) => {
                  const rec = recommendedPreDays(plan.shiftH) === n;
                  const dir = plan.targetH > 0 ? "plus tôt" : "plus tard";
                  const desc =
                    n === 0
                      ? "Tout commence le jour du départ."
                      : n === 1
                        ? `La veille, coucher et lever 1 h ${dir}, avec la lumière au bon moment.`
                        : `Pendant ${n} jours, coucher et lever 1 h ${dir} chaque jour (${Math.min(n, Math.abs(plan.targetH))} h au total).${n === 3 ? " Le plus efficace dans les études." : ""}`;
                  return (
                    <button
                      key={n}
                      className="option"
                      aria-pressed={trip.preDays === n}
                      onClick={() => {
                        setTouchedPre(true);
                        setTrip({ ...trip, preDays: n });
                      }}
                    >
                      <span className="t">{n === 0 ? "Non, je pars comme ça" : `${n} jour${n > 1 ? "s" : ""} avant`}</span>
                      {rec ? <span className="pill">Conseillé</span> : <span />}
                      <span className="d">{desc}</span>
                    </button>
                  );
                })}
              </div>
              <span className="hint">Choisis ce qui colle à ton agenda : mieux vaut un plan simple suivi qu'un plan parfait abandonné.</span>
            </div>
          )}
        </div>
      )}

      {step > 0 && (
        <div className="wizard-foot">
          {step < 3 ? (
            <button className="btn block" disabled={!legsOk} onClick={() => goStep(step + 1)}>
              Continuer
            </button>
          ) : (
            <button className="btn block accent" onClick={save}>
              <Icon name="check" size={18} /> {editing ? "Enregistrer" : "Créer mon plan"}
            </button>
          )}
          {step === 1 && !legsOk && trip.legs[0] && (
            <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>
              {legError(trip.legs.find((l) => legError(l))!)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ShiftPreview({ plan }: { plan: NonNullable<ReturnType<typeof buildPlan>> }) {
  const text =
    plan.strategy === "none"
      ? "Pas de décalage horaire notable : on s'occupe surtout du vol."
      : plan.strategy === "stay"
        ? `Séjour court : tu restes calé(e) sur l'heure de ${cityLabel(plan.home)}.`
        : `Adapté(e) en ~${Math.max(1, plan.adaptDays)} jour${plan.adaptDays > 1 ? "s" : ""} avec le plan, contre ~${plan.adaptDaysNoPlan} sans.`;
  return (
    <div className="card flat row" style={{ padding: 16, gap: 14, marginTop: 6 }}>
      <div className="shift" style={{ fontSize: 40, color: plan.shiftH > 0 ? "var(--sun)" : plan.shiftH < 0 ? "var(--sleep)" : "var(--muted)" }}>
        {signed(plan.shiftH)}
      </div>
      <div className="small">
        <b>{plan.shiftH > 0 ? "Vers l'est" : plan.shiftH < 0 ? "Vers l'ouest" : "Même heure"}</b>
        <div className="muted">{text}</div>
      </div>
    </div>
  );
}

function TransportField({ title, value, onChange }: { title: string; value: GroundTransport; onChange: (v: GroundTransport) => void }) {
  return (
    <div className="card flat stack" style={{ padding: 16 }}>
      <h3>{title}</h3>
      <div className="chips" role="group" aria-label="Moyen de transport">
        {MODES.map((m) => (
          <button key={m.value} className="chip" aria-pressed={value.mode === m.value} onClick={() => onChange({ ...value, mode: m.value })}>
            {m.label}
          </button>
        ))}
      </div>
      <Stepper value={value.minutes} step={5} min={5} max={300} onChange={(v) => onChange({ ...value, minutes: v })} format={(v) => `${fmtDur(v)} · ${transportLabel(value.mode)}`} />
    </div>
  );
}

function LegEditor({ leg, index, count, onChange, onRemove }: { leg: Leg; index: number; count: number; onChange: (l: Leg) => void; onRemove: () => void }) {
  const t = legTimes(leg);
  const err = legError(leg);
  const [depDate, depTime] = leg.dep.split("T");
  const [arrDate, arrTime] = (leg.arr || "T").split("T");
  const a = airport(leg.from), b = airport(leg.to);
  const shift = t ? (zoned(t.arr, b!.tz).minutes - zoned(t.arr, a!.tz).minutes) : 0;
  return (
    <div className="card leg-card">
      <div className="leg-head">
        <div className="row" style={{ gap: 8 }}>
          <span className="pill ghost">{count > 1 ? `Vol ${index + 1}` : "Vol"}</span>
          {leg.flightNumber && <b>{leg.flightNumber}</b>}
          {leg.airline && <span className="small muted">{leg.airline}</span>}
        </div>
        {count > 1 && (
          <button className="icon-btn plain" aria-label="Supprimer ce vol" onClick={onRemove}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
      <div className="grid-2">
        <AirportInput label="De" value={leg.from} onChange={(v) => onChange({ ...leg, from: v })} />
        <AirportInput label="Vers" value={leg.to} onChange={(v) => onChange({ ...leg, to: v })} />
      </div>
      <div className="field">
        <span className="label">Départ{a ? ` · heure de ${cityLabel(a)}` : ""}</span>
        <div className="grid-2">
          <input className="input" type="date" aria-label="Date de départ" value={depDate} onChange={(e) => onChange({ ...leg, dep: `${e.target.value}T${depTime ?? ""}` })} />
          <input
            className="input time"
            type="time"
            aria-label="Heure de départ"
            value={depTime ?? ""}
            onChange={(e) => onChange({ ...leg, dep: `${depDate}T${e.target.value}` })}
          />
        </div>
      </div>
      <div className="field">
        <span className="label row" style={{ gap: 8 }}>
          Arrivée{b ? ` · heure de ${cityLabel(b)}` : ""}
          {leg.source === "estimate" && leg.arr && <span className="pill ghost" style={{ padding: "2px 8px", fontSize: 11.5 }}>estimée</span>}
        </span>
        <div className="grid-2">
          <input
            className="input"
            type="date"
            aria-label="Date d'arrivée"
            value={arrDate}
            onChange={(e) => onChange({ ...leg, arr: `${e.target.value}T${arrTime ?? ""}`, source: "manual" })}
          />
          <input
            className="input time"
            type="time"
            aria-label="Heure d'arrivée"
            value={arrTime ?? ""}
            onChange={(e) => onChange({ ...leg, arr: `${arrDate || depDate}T${e.target.value}`, source: "manual" })}
          />
        </div>
        {leg.source === "estimate" && leg.arr && <span className="hint">Calculée d'après la distance. Corrige-la avec l'heure de ton billet si besoin.</span>}
      </div>
      <Segmented<Cabin>
        label="Cabine"
        value={leg.cabin}
        onChange={(v) => onChange({ ...leg, cabin: v })}
        options={[
          { value: "eco", label: "Éco" },
          { value: "premium", label: "Premium" },
          { value: "business", label: "Affaires" },
          { value: "first", label: "Première" },
        ]}
      />
      {t && !err && (
        <div className="row small muted" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 5 }}>
            <Icon name="clock" size={15} /> {fmtDur((t.arr - t.dep) / MIN)}
          </span>
          {shift !== 0 && (
            <span className="row" style={{ gap: 5 }}>
              <Icon name="spark" size={15} /> {signed(Math.round((((shift + 2160) % 1440) - 720) / 30) / 2)} en arrivant
            </span>
          )}
        </div>
      )}
      {err && leg.from && leg.to && <p className="hint" style={{ color: "var(--warn)" }}>{err}</p>}
    </div>
  );
}

function FindFlight({ apiKey, onLegs }: { apiKey?: string; onLegs: (legs: Leg[]) => void }) {
  const [method, setMethod] = useState<Method>("number");
  const [num, setNum] = useState("");
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<FoundFlight[] | null>(null);

  const toLeg = (f: FoundFlight): Leg => {
    const dep = f.dep ?? `${date}T`;
    const l: Leg = {
      id: newId(),
      flightNumber: f.flightNumber || undefined,
      airline: f.airline,
      from: f.from,
      to: f.to,
      dep,
      arr: f.arr ?? "",
      cabin: "eco",
      aircraft: f.aircraft,
      source: f.arr ? f.source : "estimate",
    };
    return withEstimate(l);
  };

  const searchNumber = async () => {
    setBusy(true);
    setErr(null);
    setFound(null);
    try {
      const r = await lookupFlight(num, date, apiKey);
      if (r.length === 1) onLegs([toLeg(r[0])]);
      else setFound(r);
    } catch (e) {
      setErr(e instanceof Error ? (e.message.startsWith("Failed") || e.message.includes("fetch") ? "Pas de connexion au service de vols. Entre le trajet à la main." : e.message) : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const searchFlights = async () => {
    if (!apiKey) return;
    setBusy(true);
    setErr(null);
    setFound(null);
    try {
      const r = await searchRoute(from, to, date, apiKey);
      if (!r.length) setErr("Aucun vol direct trouvé ce jour-là. Entre l'heure à la main.");
      else setFound(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const parsed = useMemo(() => (method === "paste" && text.trim().length > 10 ? parseBooking(text, nowMs()) : []), [text, method]);

  return (
    <div className="stack-lg">
      <Segmented<Method>
        label="Méthode"
        value={method}
        onChange={(m) => {
          setMethod(m);
          setErr(null);
          setFound(null);
        }}
        options={[
          { value: "number", label: "N° de vol" },
          { value: "route", label: "Trajet" },
          { value: "paste", label: "Réservation" },
        ]}
      />

      {method === "number" && (
        <>
          <div className="field">
            <label htmlFor="fn">Numéro de vol</label>
            <input
              id="fn"
              className="input big"
              placeholder="AF 274"
              value={num}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setNum(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && num && searchNumber()}
            />
          </div>
          <div className="field">
            <label htmlFor="fd">Date de départ</label>
            <input id="fd" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button className="btn block" disabled={!num.trim() || busy} onClick={searchNumber}>
            {busy ? <span className="spinner" /> : <Icon name="search" size={18} />} Chercher le vol
          </button>
          {!apiKey && (
            <p className="hint">
              Sans clé, on retrouve le trajet et tu ajoutes l'heure du billet. Pour les horaires exacts en automatique, ajoute une clé gratuite AeroDataBox dans{" "}
              <a href="#/me">Profil</a>.
            </p>
          )}
        </>
      )}

      {method === "route" && (
        <>
          <div className="grid-2">
            <AirportInput label="De" value={from} onChange={setFrom} />
            <AirportInput label="Vers" value={to} onChange={setTo} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="rd">Date</label>
              <input id="rd" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rt">Décollage</label>
              <input id="rt" className="input time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          {isValidIata(from) && isValidIata(to) && time && (
            <p className="hint">
              Arrivée estimée : {estimateArrival(from, to, `${date}T${time}`)?.split("T")[1]} ({fmtDur(estimateBlockMinutes(airport(from)!, airport(to)!))} de vol environ). Tu pourras la corriger.
            </p>
          )}
          <button
            className="btn block"
            disabled={!isValidIata(from) || !isValidIata(to) || from === to || !time}
            onClick={() => onLegs([withEstimate({ ...emptyLeg(date), from, to, dep: `${date}T${time}` })])}
          >
            Continuer
          </button>
          {apiKey && isValidIata(from) && isValidIata(to) && (
            <button className="btn soft block" disabled={busy} onClick={searchFlights}>
              {busy ? <span className="spinner" /> : <Icon name="search" size={18} />} Voir les vols de ce jour
            </button>
          )}
        </>
      )}

      {method === "paste" && (
        <>
          <div className="field">
            <label htmlFor="bk">Colle ta confirmation</label>
            <textarea
              id="bk"
              className="input"
              placeholder={"Copie le texte de ton mail de réservation ou de ta carte d'embarquement.\n\nEx. : AF 274 · 10 oct. · Paris (CDG) 19:30 → Tokyo (HND) 15:05"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="hint">Tout reste sur ton téléphone : rien n'est envoyé nulle part.</span>
          </div>
          {text.trim().length > 10 &&
            (parsed.length ? (
              <div className="stack">
                <span className="label">
                  {parsed.length} vol{parsed.length > 1 ? "s" : ""} trouvé{parsed.length > 1 ? "s" : ""}
                </span>
                {parsed.map((p, i) => (
                  <div key={i} className="card flat row" style={{ padding: 14 }}>
                    <b className="tnum">{p.flightNumber ?? "Vol"}</b>
                    <span>
                      {p.from ?? "?"} → {p.to ?? "?"}
                    </span>
                    <span className="spacer" />
                    <span className="small muted tnum">{p.dep ? p.dep.replace("T", " · ") : "heure ?"}</span>
                  </div>
                ))}
                {splitTrips(parsed.map((p) => withEstimate({ ...emptyLeg(), ...p, dep: p.dep ?? `${today()}T`, arr: p.arr ?? "", source: p.arr ? "manual" : "estimate" } as Leg))).length > 1 && (
                  <p className="hint">Aller et retour détectés : on crée un plan pour chacun.</p>
                )}
                <button
                  className="btn block"
                  onClick={() =>
                    onLegs(
                      parsed.map((p) =>
                        withEstimate({
                          ...emptyLeg(),
                          flightNumber: p.flightNumber,
                          airline: p.airline,
                          from: p.from ?? "",
                          to: p.to ?? "",
                          dep: p.dep ?? `${today()}T`,
                          arr: p.arr ?? "",
                          source: p.arr ? "manual" : "estimate",
                        }),
                      ),
                    )
                  }
                >
                  Utiliser {parsed.length > 1 ? "ces vols" : "ce vol"}
                </button>
              </div>
            ) : (
              <p className="hint">Aucun vol reconnu pour l'instant. Vérifie que le texte contient le numéro de vol et les aéroports.</p>
            ))}
        </>
      )}

      {err && (
        <div className="stack">
          <div className="error">{err}</div>
          {method === "number" && (
            <button className="btn ghost" onClick={() => setMethod("route")}>
              Entrer le trajet à la main
            </button>
          )}
        </div>
      )}

      {found && found.length > 0 && (
        <div className="stack">
          <span className="label">Choisis ton vol</span>
          {found.map((f, i) => (
            <button key={i} className="card tap result" onClick={() => onLegs([toLeg(f)])}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <b>{f.flightNumber}</b>
                  <span className="small muted">{f.airline}</span>
                </div>
                <div className="small muted tnum" style={{ marginTop: 4 }}>
                  {f.from} {f.dep?.split("T")[1] ?? ""} → {f.to} {f.arr?.split("T")[1] ?? ""}
                  {f.dep && f.arr && f.arr.slice(0, 10) !== f.dep.slice(0, 10) ? " (+1)" : ""}
                </div>
              </div>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </div>
      )}
      <button className="btn ghost" onClick={() => onLegs([emptyLeg(date)])}>
        Je préfère tout remplir moi-même
      </button>
    </div>
  );
}

