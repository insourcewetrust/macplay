import { cityLabel } from "../lib/airports";
import { hmFromMin, type Plan } from "../lib/engine";
import { hmShort, relTime } from "../lib/format";
import { nowInfo } from "../lib/now";
import { hmToMin, zoned, MIN } from "../lib/time";
import { useStore } from "../lib/store";
import { Icon } from "../ui/Icon";
import { go } from "../ui/router";
import { BodyDial, KIND_META } from "../ui/visuals";

export function NowCard({ plan, now, onClick }: { plan: Plan; now: number; onClick?: () => void }) {
  const { profile } = useStore();
  const info = nowInfo(plan, now);
  const tz = plan.tzAt(now);
  const alt = plan.altTzAt(now);
  const cityOf = (z: string) => (z === plan.homeTz ? plan.home : plan.dest);
  const here = cityOf(tz);
  const local = zoned(now, tz);
  const bodyMin = plan.bodyMinutesAt(now);
  const gap = Math.round(((local.minutes - bodyMin + 2160) % 1440) - 720);
  const main = info.main;
  const meta = main ? KIND_META[main.kind] : undefined;
  const hint = main?.detail ?? main?.bullets?.[0];
  const caf = info.caffeine;
  const cafNow = caf && caf.start <= now && caf.end! > now;
  const mel = plan.events.find((e) => e.kind === "melatonin" && e.start > now && e.start - now < 16 * 60 * MIN);

  return (
    <button className="card tap now" onClick={onClick ?? (() => go(`/trip/${plan.trip.id}`))}>
      <div className="kicker">
        <span className="live" />
        Maintenant · {info.day?.label ?? ""} · {cityLabel(here)}
      </div>

      <div className="body-clock" style={{ marginTop: 16 }}>
        <BodyDial localMin={local.minutes} bodyMin={bodyMin} bed={hmToMin(profile.bedtime)} wake={hmToMin(profile.wake)} />
        <div className="times">
          <span className="small muted">Il est, à {cityLabel(here)}</span>
          <span className="big">
            {local.hm}
            {alt && (
              <span className="small muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                {zoned(now, alt).hm} à {cityLabel(cityOf(alt))}
              </span>
            )}
          </span>
          <span className="small muted">
            {Math.abs(gap) < 20 ? (
              "ton corps est à l'heure"
            ) : (
              <>
                ton corps pense qu'il est <b style={{ color: "var(--text)" }}>{hmFromMin(bodyMin)}</b>
              </>
            )}
          </span>
        </div>
      </div>

      {main ? (
        <>
          <div className="row" style={{ marginTop: 18, gap: 8 }}>
            <span className={`pill ${meta?.tone}`}>
              <Icon name={meta!.icon} size={15} />
              {main.end ? `jusqu'à ${hmShort(main.end, tz)}` : hmShort(main.start, tz)}
            </span>
            {main.end && <span className="small muted">{relTime(main.end, now).replace("dans", "encore")}</span>}
          </div>
          <div className="headline">{main.title}</div>
          {hint && <p className="until">{hint}</p>}
        </>
      ) : (
        <>
          <div className="headline" style={{ marginTop: 18 }}>
            Rien de particulier
          </div>
          <p className="until">Vis à l'heure locale, hydrate-toi, bouge un peu.</p>
        </>
      )}

      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 14 }}>
        {caf && profile.caffeineDrink !== "none" && (
          <span className="pill coffee">
            <Icon name="cup" size={14} />
            {cafNow ? `Caféine OK jusqu'à ${hmShort(caf.end!, tz)}` : `Pas de caféine avant ${hmShort(caf.start, tz)}`}
          </span>
        )}
        {mel && (
          <span className="pill mela">
            <Icon name="pill" size={14} />
            Mélatonine à {hmShort(mel.start, tz)}
          </span>
        )}
      </div>

      {info.next[0] && (
        <div className="now-next">
          <span className="muted">Ensuite</span>
          <b className="tnum">{hmShort(info.next[0].start, tz)}</b>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.next[0].title}</span>
          <Icon name="chevron" size={16} />
        </div>
      )}
    </button>
  );
}
