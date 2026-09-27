import type { Profile } from "../lib/types";
import { hmToMin, minToHm } from "../lib/time";
import { fmtDur } from "../lib/engine";
import { Segmented, ToggleRow } from "../ui/controls";
import { Icon } from "../ui/Icon";

export function RhythmFields({ p, set }: { p: Profile; set: (x: Partial<Profile>) => void }) {
  const dur = ((hmToMin(p.wake) - hmToMin(p.bedtime)) % 1440 + 1440) % 1440;
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card flat" style={{ padding: 16 }}>
          <div className="row small muted" style={{ gap: 6 }}>
            <Icon name="moon" size={16} /> Je me couche
          </div>
          <input
            className="input time"
            type="time"
            aria-label="Heure de coucher"
            value={p.bedtime}
            step={900}
            onChange={(e) => e.target.value && set({ bedtime: e.target.value })}
            style={{ marginTop: 8, fontSize: 24, fontWeight: 650, border: 0, padding: 0, background: "none", minHeight: 40 }}
          />
        </div>
        <div className="card flat" style={{ padding: 16 }}>
          <div className="row small muted" style={{ gap: 6 }}>
            <Icon name="sun" size={16} /> Je me lève
          </div>
          <input
            className="input time"
            type="time"
            aria-label="Heure de réveil"
            value={p.wake}
            step={900}
            onChange={(e) => e.target.value && set({ wake: e.target.value })}
            style={{ marginTop: 8, fontSize: 24, fontWeight: 650, border: 0, padding: 0, background: "none", minHeight: 40 }}
          />
        </div>
      </div>
      <p className="hint">
        Environ {fmtDur(dur)} de sommeil. Mets tes horaires naturels, ceux d'un jour où tu n'as pas de contrainte, à peu près.
        {dur < 360 || dur > 600 ? " Ça fait une nuit inhabituelle : vérifie tes heures." : ""}
      </p>
    </div>
  );
}

export function AlliesFields({ p, set }: { p: Profile; set: (x: Partial<Profile>) => void }) {
  return (
    <div className="stack-lg">
      <div className="card flat" style={{ padding: "6px 16px" }}>
        <div className="toggle-row" style={{ display: "grid", gap: 12 }}>
          <div className="row">
            <div className="tone-coffee" style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center" }}>
              <Icon name="cup" />
            </div>
            <div className="text">
              <div style={{ fontWeight: 600 }}>Caféine</div>
              <div className="small muted">Ta boisson habituelle</div>
            </div>
          </div>
          <Segmented
            label="Boisson"
            value={p.caffeineDrink}
            onChange={(v) => set({ caffeineDrink: v })}
            options={[
              { value: "coffee", label: "Café" },
              { value: "tea", label: "Thé" },
              { value: "both", label: "Les deux" },
              { value: "none", label: "Aucun" },
            ]}
          />
        </div>
        {p.caffeineDrink !== "none" && (
          <ToggleRow
            icon="bolt"
            tone="coffee"
            title="Je suis sensible à la caféine"
            desc="Limite 10 h avant le coucher au lieu de 8 h."
            checked={p.caffeineSensitive}
            onChange={(v) => set({ caffeineSensitive: v })}
          />
        )}
        <ToggleRow
          icon="pill"
          tone="mela"
          title="Mélatonine"
          desc={
            <>
              Ok pour en prendre en petite dose. <a href="#/guide/melatonine">À lire avant</a>.
            </>
          }
          checked={p.melatonin}
          onChange={(v) => set({ melatonin: v })}
        />
        <ToggleRow
          icon="shades"
          tone="shade"
          title="Lunettes de soleil"
          desc="Pour bloquer la lumière au mauvais moment."
          checked={p.sunglasses}
          onChange={(v) => set({ sunglasses: v })}
        />
        <ToggleRow
          icon="sun"
          tone="sun"
          title="Lunettes de luminothérapie"
          desc="Luminette, AYO, Re-Timer…"
          checked={p.lightGlasses}
          onChange={(v) => set({ lightGlasses: v })}
        />
      </div>
    </div>
  );
}

export { minToHm };
