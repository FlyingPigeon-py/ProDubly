import { useEffect, useMemo, useState } from "react";
import { loadPackMeta, loadTakes } from "../api";
import { verdictColor } from "../audio/score";
import type { PackMeta, TakesMap } from "../types";

export default function Results(props: {
  slug: string;
  onBack: () => void;
  onRecordLine: (slug: string, lineIdx: number) => void;
  onWatch: (slug: string) => void;
}) {
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [takes, setTakes] = useState<TakesMap>({});

  useEffect(() => {
    loadPackMeta(props.slug).then(setMeta);
    loadTakes(props.slug).then(setTakes);
  }, [props.slug]);

  const stats = useMemo(() => {
    if (!meta) return null;
    const rows = meta.lines.map((l, idx) => ({ line: l, idx, take: takes[l.id] }));
    const scored = rows.filter((r) => r.take?.analysis);
    const total = Math.round(
      (rows.reduce((s, r) => s + (r.take?.analysis?.score ?? 0), 0) / Math.max(1, rows.length)) * 10
    );
    const accuracy =
      scored.length > 0
        ? Math.round((scored.reduce((s, r) => s + (r.take!.analysis!.score >= 75 ? 1 : 0), 0) / scored.length) * 100)
        : 0;
    const avgMiss =
      scored.length > 0 ? scored.reduce((s, r) => s + Math.abs(r.take!.analysis!.startOffset), 0) / scored.length : 0;
    const takesTotal = rows.reduce((s, r) => s + (r.take?.takeCount ?? (r.take ? 1 : 0)), 0);
    const verdicts = new Map<string, number>();
    for (const r of scored) {
      const v = r.take!.analysis!.verdict;
      verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
    }
    const notRecorded = rows.length - scored.length;
    return { rows, total, accuracy, avgMiss, takesTotal, verdicts, scored: scored.length, notRecorded };
  }, [meta, takes]);

  if (!meta || !stats) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", background: "var(--panel-bg)" }}>
        <div className="mono pulse" style={{ color: "var(--text-dim)", fontSize: 13 }}>
          считаю итоги…
        </div>
      </div>
    );
  }

  const verdictOrder: [string, string][] = [
    ["в точку", "var(--green)"],
    ["поздно", "var(--amber)"],
    ["коротко", "var(--amber)"],
    ["за окном", "var(--amber)"],
    ["тишина", "var(--red)"]
  ];
  const maxVerdict = Math.max(1, ...Array.from(stats.verdicts.values()));

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel-bg)" }}>
      <div
        style={{
          height: 56,
          flex: "none",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 22px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }} onClick={props.onBack}>
            ← Библиотека
          </div>
          <div style={{ width: 1, height: 20, background: "var(--card-border)" }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>{meta.title} · итоги</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => props.onRecordLine(props.slug, 0)}>
            Вернуться к репликам
          </button>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => props.onWatch(props.slug)} disabled={stats.scored === 0}>
            Смотреть дубляж
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 28, display: "flex", flexWrap: "wrap", gap: 24, alignContent: "flex-start" }}>
        <div style={{ flex: "1 1 320px", maxWidth: 420, display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 18, borderRadius: 12 }}>
            <div className="label">Счёт</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div className="mono" style={{ fontSize: 68, lineHeight: 0.9, color: "var(--amber)" }}>{stats.total}</div>
              <div className="mono" style={{ fontSize: 15, color: "var(--text-faint)" }}>/ 1000</div>
            </div>
            <div className="progress-track" style={{ height: 8 }}>
              <div className="progress-fill" style={{ width: `${stats.total / 10}%` }} />
            </div>
            <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}>
              <Row k="точных дублей" v={`${stats.accuracy}%`} />
              <Row k="средний промах старта" v={`${stats.avgMiss.toFixed(2)} с`} />
              <Row k="озвучено" v={`${stats.scored} из ${meta.lines.length}`} />
              <Row k="записано дублей" v={String(stats.takesTotal)} />
            </div>
          </div>

          <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 13, borderRadius: 12 }}>
            <div className="label">Вердикты</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {verdictOrder.map(([v, color]) => {
                const n = stats.verdicts.get(v) ?? 0;
                return (
                  <div key={v} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="mono" style={{ width: 70, fontSize: 11, color }}>{v}</div>
                    <div style={{ flex: 1, height: 10, background: "var(--card-border)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(n / maxVerdict) * 100}%`, height: "100%", background: color }} />
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)", width: 18, textAlign: "right" }}>{n}</div>
                  </div>
                );
              })}
              {stats.notRecorded > 0 && (
                <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                  ещё {stats.notRecorded} реплик без дубля
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 520px", minWidth: 0, minHeight: 380, borderRadius: 12, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <div className="mono" style={{ display: "flex", minWidth: 640, padding: "13px 20px", borderBottom: "1px solid var(--card-border)", fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            <div style={{ width: 30, flex: "none" }}>№</div>
            <div style={{ flex: 1, minWidth: 200 }}>Реплика</div>
            <div style={{ width: 92, flex: "none" }}>Старт</div>
            <div style={{ width: 104, flex: "none" }}>Вердикт</div>
            <div style={{ width: 48, flex: "none", textAlign: "right" }}>Балл</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {stats.rows.map(({ line, idx, take }) => {
              const a = take?.analysis;
              const vColor = a ? verdictColor(a.verdict) : "var(--text-faint)";
              return (
                <div
                  key={line.id}
                  onClick={() => props.onRecordLine(props.slug, idx)}
                  className="row-hover"
                  style={{ display: "flex", alignItems: "center", minWidth: 640, padding: "11px 20px", borderBottom: "1px solid #191d20", cursor: "pointer" }}
                >
                  <div className="mono" style={{ width: 30, flex: "none", fontSize: 12, color: "var(--text-faint)" }}>
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
                    <div className="mono" style={{ fontSize: 11, color: line.color, width: 74, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {line.who}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {line.text}
                    </div>
                  </div>
                  <div className="mono" style={{ width: 92, flex: "none", fontSize: 12, color: "var(--text-mute)" }}>
                    {a ? `+${a.startOffset.toFixed(2)} с` : "—"}
                  </div>
                  <div style={{ width: 104, flex: "none" }}>
                    {a ? (
                      <span className="mono" style={{ fontSize: 11, border: `1px solid ${vColor}`, color: vColor, borderRadius: 99, padding: "3px 9px" }}>
                        {a.verdict}
                      </span>
                    ) : (
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>нет дубля</span>
                    )}
                  </div>
                  <div className="mono" style={{ width: 48, flex: "none", textAlign: "right", fontSize: 13, color: vColor }}>
                    {a ? a.score : "·"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mono" style={{ padding: "12px 20px", borderTop: "1px solid var(--card-border)", fontSize: 11, color: "var(--text-faint)" }}>
            нажмите на реплику, чтобы переписать её
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-dim)" }}>{k}</span>
      <span style={{ color: "var(--text)" }}>{v}</span>
    </div>
  );
}
