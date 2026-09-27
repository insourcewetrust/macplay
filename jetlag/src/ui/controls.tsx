import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cityLabel, countryName, searchAirports, airport, type Airport } from "../lib/airports";
import { Icon } from "./Icon";

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function ToggleRow({ icon, tone, title, desc, checked, onChange }: { icon: string; tone: string; title: string; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div className={`ev-ico tone-${tone}`} style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} />
      </div>
      <div className="text">
        <div style={{ fontWeight: 600 }}>{title}</div>
        {desc && <div className="small muted">{desc}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, step = 5, min = 0, max = 600, format }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format: (v: number) => string }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Moins" onClick={() => onChange(Math.max(min, value - step))}>
        <Icon name="minus" size={18} />
      </button>
      <div className="val">{format(value)}</div>
      <button type="button" aria-label="Plus" onClick={() => onChange(Math.min(max, value + step))}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

export function AirportInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (iata: string) => void; autoFocus?: boolean }) {
  const a = airport(value);
  const [q, setQ] = useState(a ? `${cityLabel(a)} (${a.iata})` : value);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const results = open ? searchAirports(q.replace(/\([A-Z]{3}\)\s*$/, "")) : [];

  useEffect(() => {
    const ap = airport(value);
    if (ap) setQ(`${cityLabel(ap)} (${ap.iata})`);
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (ap: Airport) => {
    onChange(ap.iata);
    setQ(`${cityLabel(ap)} (${ap.iata})`);
    setOpen(false);
  };

  return (
    <div className="field ac" ref={ref}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={q}
        autoFocus={autoFocus}
        placeholder="Ville ou code (CDG, Tokyo…)"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={id + "-list"}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, results.length - 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
          else if (e.key === "Enter" && results[sel]) {
            e.preventDefault();
            pick(results[sel]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <div className="ac-list" role="listbox" id={id + "-list"}>
          {results.map((r, i) => (
            <button key={r.iata} type="button" role="option" aria-selected={i === sel} className="ac-item" onClick={() => pick(r)}>
              <span className="iata">{r.iata}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 550 }}>{cityLabel(r)}</div>
                <div className="xsmall muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name} · {countryName(r.country)}
                </div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}
