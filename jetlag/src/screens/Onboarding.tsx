import { useState } from "react";
import { updateProfile, useStore } from "../lib/store";
import { Icon, Mark } from "../ui/Icon";
import { AlliesFields, RhythmFields } from "./ProfileFields";
import { go } from "../ui/router";

export function Onboarding() {
  const { profile } = useStore();
  const [step, setStep] = useState(0);
  const set = (x: Partial<typeof profile>) => updateProfile(x);

  const finish = () => {
    updateProfile({ onboarded: true });
    go("/new");
  };

  return (
    <div className="screen" key={step} style={{ minHeight: "calc(100dvh - 60px)", display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        {step > 0 ? (
          <button className="icon-btn plain" aria-label="Retour" onClick={() => setStep(step - 1)}>
            <Icon name="back" />
          </button>
        ) : (
          <div style={{ width: 44 }} />
        )}
        <div className="grow progress-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <div style={{ width: 44 }} />
      </div>

      {step === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 40 }}>
          <Mark size={64} />
          <h1 style={{ fontSize: 52, marginTop: 28 }}>
            Arrive reposé(e),
            <br />
            <em>pas décalé(e).</em>
          </h1>
          <p className="muted" style={{ fontSize: 18, marginTop: 18, maxWidth: 420 }}>
            Un plan heure par heure, basé sur la science du sommeil. Réaliste : il sait qu'on ne dort pas à la porte d'embarquement et que le taxi
            compte aussi.
          </p>
          <div className="stack" style={{ marginTop: 28 }}>
            {[
              ["sun", "sun", "Quand chercher ou fuir la lumière, même dans le VTC"],
              ["plane", "sleep", "Quand dormir en vol, et quand c'est inutile d'essayer"],
              ["cup", "coffee", "Café, thé, mélatonine : quoi, combien, à quelle heure"],
            ].map(([i, t, txt]) => (
              <div key={i} className="row">
                <div className={`tone-${t}`} style={{ width: 36, height: 36, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon name={i} size={18} />
                </div>
                <span>{txt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ flex: 1 }}>
          <div className="wizard-title">Ton rythme habituel</div>
          <p className="wizard-sub">C'est le point de départ de ton horloge interne. Pas besoin d'être précis à la minute.</p>
          <RhythmFields p={profile} set={set} />
        </div>
      )}

      {step === 2 && (
        <div style={{ flex: 1 }}>
          <div className="wizard-title">Tes alliés</div>
          <p className="wizard-sub">On n'adapte le plan qu'avec ce que tu es prêt(e) à utiliser. Tu pourras changer ça plus tard.</p>
          <AlliesFields p={profile} set={set} />
        </div>
      )}

      <div className="wizard-foot">
        {step < 2 ? (
          <button className="btn block" onClick={() => setStep(step + 1)}>
            {step === 0 ? "Commencer" : "Continuer"}
          </button>
        ) : (
          <button className="btn block accent" onClick={finish}>
            Ajouter mon premier voyage
            <Icon name="arrow" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
