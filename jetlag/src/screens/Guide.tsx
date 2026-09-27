import { ARTICLES, SOURCES, type Block } from "../content/guide";
import { Icon } from "../ui/Icon";
import { go } from "../ui/router";

export function Guide() {
  return (
    <div className="screen">
      <div className="hello">
        <div className="eyebrow">Ce que dit la recherche, sans jargon</div>
        <h1>Guide</h1>
      </div>
      <div className="stack">
        {ARTICLES.map((a) => (
          <a key={a.id} href={`#/guide/${a.id}`} className="card tap article-card" style={{ color: "inherit", textDecoration: "none" }}>
            <div className={`ico tone-${a.tone}`}>
              <Icon name={a.icon} size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="xsmall muted" style={{ fontWeight: 550 }}>
                {a.kicker} · {a.minutes} min
              </div>
              <div style={{ fontWeight: 600, fontSize: 16.5, marginTop: 2 }}>{a.title}</div>
            </div>
            <Icon name="chevron" size={18} className="faint" />
          </a>
        ))}
      </div>
      <h2>Sources principales</h2>
      <div className="card flat refs" style={{ borderTop: 0, padding: 16, gap: 8 }}>
        {SOURCES.map((s) => (
          <div key={s}>{s}</div>
        ))}
      </div>
      <p className="xsmall faint" style={{ margin: "16px 4px" }}>
        Fuseau donne des conseils généraux et ne remplace pas un avis médical.
      </p>
    </div>
  );
}

export function ArticleView({ id }: { id: string }) {
  const a = ARTICLES.find((x) => x.id === id);
  const idx = ARTICLES.findIndex((x) => x.id === id);
  if (!a) {
    go("/guide");
    return null;
  }
  const next = ARTICLES[idx + 1];
  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Retour au guide" onClick={() => go("/guide")}>
          <Icon name="back" />
        </button>
      </div>
      <div className={`tone-${a.tone}`} style={{ width: 56, height: 56, borderRadius: 18, display: "grid", placeItems: "center", marginTop: 8 }}>
        <Icon name={a.icon} size={26} />
      </div>
      <div className="small muted" style={{ marginTop: 16, fontWeight: 550 }}>
        {a.kicker} · {a.minutes} min de lecture
      </div>
      <h1 style={{ marginTop: 6, marginBottom: 20 }}>{a.title}</h1>
      <article className="prose">
        {a.blocks.map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
      </article>
      {next && (
        <a href={`#/guide/${next.id}`} className="card tap row" style={{ display: "flex", marginTop: 28, color: "inherit", textDecoration: "none" }}>
          <div style={{ flex: 1 }}>
            <div className="xsmall muted">À lire ensuite</div>
            <div style={{ fontWeight: 600 }}>{next.title}</div>
          </div>
          <Icon name="chevron" size={18} />
        </a>
      )}
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  if ("p" in b) return <p>{b.p}</p>;
  if ("h" in b) return <h4>{b.h}</h4>;
  if ("list" in b)
    return (
      <ul>
        {b.list.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    );
  if ("table" in b)
    return (
      <div className="card flat" style={{ padding: 16 }}>
        <table>
          <thead>
            <tr>
              {b.table.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if ("callout" in b) {
    const tone = b.tone === "warn" ? "warn" : b.tone === "tip" ? "sun" : "accent";
    return (
      <div className={`callout tone-${tone}`}>
        <Icon name={b.tone === "warn" ? "warn" : b.tone === "tip" ? "spark" : "info"} size={20} />
        <span style={{ color: "var(--text)" }}>{b.callout}</span>
      </div>
    );
  }
  return (
    <div className="refs">
      {b.refs.map((r) => (
        <span key={r}>{r}</span>
      ))}
    </div>
  );
}
