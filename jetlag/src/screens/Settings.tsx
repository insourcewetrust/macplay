import { useRef, useState } from "react";
import { exportData, importData, updateProfile, updateSettings, useStore } from "../lib/store";
import { Segmented, Toast } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { AlliesFields, RhythmFields } from "./ProfileFields";

export function Settings() {
  const { profile, settings, trips } = useStore();
  const [toast, setToast] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fuseau-sauvegarde.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="screen">
      <div className="hello">
        <div className="eyebrow">Ton plan se recalcule dès que tu changes quelque chose</div>
        <h1>Profil</h1>
      </div>

      <div className="field">
        <label htmlFor="nm">Prénom (optionnel)</label>
        <input id="nm" className="input" value={profile.name ?? ""} placeholder="Pour te saluer" onChange={(e) => updateProfile({ name: e.target.value || undefined })} />
      </div>

      <h2>Ton rythme</h2>
      <RhythmFields p={profile} set={updateProfile} />

      <h2>Tes alliés</h2>
      <AlliesFields p={profile} set={updateProfile} />

      <h2>Recherche de vols</h2>
      <div className="card flat stack" style={{ padding: 16 }}>
        <p className="small">
          Sans rien configurer, Fuseau retrouve le trajet d'un numéro de vol et estime les horaires. Avec une clé <b>AeroDataBox</b> (offre gratuite), il récupère les horaires exacts et peut lister tous les vols d'un trajet.
        </p>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
          <li>
            Crée un compte sur{" "}
            <a href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noreferrer">
              RapidAPI · AeroDataBox
            </a>
            .
          </li>
          <li>Abonne-toi au plan « Basic » (gratuit).</li>
          <li>Copie ta clé « X-RapidAPI-Key » ici.</li>
        </ol>
        <div className="row">
          <input
            className="input"
            type={showKey ? "text" : "password"}
            placeholder="Clé RapidAPI"
            autoComplete="off"
            value={settings.aerodataboxKey ?? ""}
            onChange={(e) => updateSettings({ aerodataboxKey: e.target.value.trim() || undefined })}
          />
          <button className="icon-btn" aria-label={showKey ? "Masquer la clé" : "Afficher la clé"} onClick={() => setShowKey(!showKey)}>
            <Icon name={showKey ? "eyeoff" : "search"} size={18} />
          </button>
        </div>
        <span className="hint">La clé reste sur ton appareil et n'est envoyée qu'à AeroDataBox.</span>
      </div>

      <h2>Apparence</h2>
      <Segmented
        label="Thème"
        value={settings.theme}
        onChange={(v) => updateSettings({ theme: v })}
        options={[
          { value: "auto", label: "Auto" },
          { value: "light", label: "Clair" },
          { value: "dark", label: "Sombre" },
        ]}
      />

      <h2>Tes données</h2>
      <div className="card flat stack" style={{ padding: 16 }}>
        <p className="small muted">Tout est stocké uniquement sur cet appareil ({trips.length} voyage{trips.length > 1 ? "s" : ""}). Aucun compte, aucun suivi.</p>
        <div className="grid-2">
          <button className="btn soft sm" onClick={doExport}>
            <Icon name="download" size={16} /> Sauvegarder
          </button>
          <button className="btn soft sm" onClick={() => file.current?.click()}>
            <Icon name="upload" size={16} /> Restaurer
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              importData(await f.text());
              setToast("Données restaurées.");
            } catch {
              setToast("Ce fichier n'est pas une sauvegarde Fuseau.");
            }
            e.target.value = "";
          }}
        />
        <button
          className="btn ghost sm"
          style={{ color: "var(--warn)" }}
          onClick={() => {
            if (confirm("Effacer tous tes voyages et réglages ?")) {
              localStorage.clear();
              location.hash = "/";
              location.reload();
            }
          }}
        >
          Tout effacer
        </button>
      </div>

      <h2>À propos</h2>
      <div className="card flat small muted" style={{ padding: 16, display: "grid", gap: 8 }}>
        <p>
          Fuseau calcule ton plan à partir de modèles publiés sur l'horloge circadienne (lumière, mélatonine, caféine). Les estimations sont des moyennes : écoute ton corps.
        </p>
        <p>Ce n'est pas un dispositif médical. En cas de grossesse, de traitement ou de trouble du sommeil, demande conseil à un professionnel de santé.</p>
        <p>
          Données d'aéroports : OurAirports (domaine public) et mwgg/Airports (MIT). Compagnies : OpenFlights (ODbL).
        </p>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
