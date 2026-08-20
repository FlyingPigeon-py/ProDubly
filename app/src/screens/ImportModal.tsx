export interface ImportState {
  slug: string;
  title: string;
  thumbnail?: string;
  phase: "download" | "convert";
  pct: number;
  step: string;
}

export default function ImportModal({ state }: { state: ImportState }) {
  const phases: { id: ImportState["phase"]; label: string }[] = [
    { id: "download", label: "Скачиваю пак" },
    { id: "convert", label: "Привожу медиа к тому, что играет приложение" }
  ];
  const phaseIdx = phases.findIndex((p) => p.id === state.phase);

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 620 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {state.thumbnail && (
            <img
              src={state.thumbnail}
              style={{ width: 96, height: 54, objectFit: "cover", borderRadius: 8, flex: "none", background: "#141719" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 500 }}>Открываю пак «{state.title}»</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>{state.slug}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {phases.map((p, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: done || active ? 1 : 0.5 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 99,
                      flex: "none",
                      ...(done
                        ? { background: "var(--green)", color: "var(--ink)" }
                        : active
                          ? { border: "2px solid var(--amber)" }
                          : { border: "1px solid #3a4045" }),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11
                    }}
                  >
                    {done ? "✓" : ""}
                  </div>
                  <div style={{ fontSize: 14, color: active ? "var(--text)" : "var(--text-soft)" }}>{p.label}</div>
                  {active && (
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", marginLeft: "auto" }}>
                      {state.pct}%
                    </div>
                  )}
                </div>
                {active && (
                  <>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${state.pct}%` }} />
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                      {state.step}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--text-faint)", borderTop: "1px solid var(--card-border)", paddingTop: 16 }}
        >
          откроется дубль, когда закончу
        </div>
      </div>
    </div>
  );
}
