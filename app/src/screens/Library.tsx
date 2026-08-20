import { useEffect, useMemo, useState } from "react";
import { assetUrl, loadTakes } from "../api";
import { SettingsIcon } from "./Record";
import type { PackMeta } from "../types";

type Filter = "all" | "wip" | "ready";

export default function Library(props: {
  packs: PackMeta[];
  onOpenMarket: () => void;
  onRecord: (slug: string) => void;
  onWatch: (slug: string) => void;
  onDelete: (slug: string) => void;
  onSettings: () => void;
}) {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<PackMeta | null>(null);

  useEffect(() => {
    (async () => {
      const entries: Record<string, number> = {};
      for (const p of props.packs) {
        const takes = await loadTakes(p.slug);
        entries[p.slug] = Object.keys(takes).filter((id) => p.lines.some((l) => l.id === id)).length;
      }
      setProgress(entries);
    })();
  }, [props.packs]);

  const shown = useMemo(() => {
    return props.packs.filter((p) => {
      const done = progress[p.slug] ?? 0;
      if (filter === "wip") return done > 0 && done < p.lines.length;
      if (filter === "ready") return p.lines.length > 0 && done >= p.lines.length;
      return true;
    });
  }, [props.packs, progress, filter]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel-bg)" }}>
      <div
        style={{
          height: 60,
          flex: "none",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px"
        }}
      >
        <div className="mono" style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.24em", color: "var(--amber)" }}>
          ДУБЛЬ
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <SettingsIcon onClick={props.onSettings} />
          <button className="btn btn-primary" onClick={props.onOpenMarket}>Добавить пак</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.01em" }}>Библиотека</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {props.packs.length === 0
                ? "паков ещё нет"
                : `${props.packs.length} ${plural(props.packs.length, "пак", "пака", "паков")} · всё хранится на устройстве`}
            </div>
          </div>
          {props.packs.length > 0 && (
            <div className="mono" style={{ display: "flex", gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {(
                [
                  ["all", "все"],
                  ["wip", "в работе"],
                  ["ready", "готовые"]
                ] as [Filter, string][]
              ).map(([f, label]) => (
                <div
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    border: `1px solid ${filter === f ? "var(--border)" : "var(--line)"}`,
                    borderRadius: 99,
                    padding: "6px 12px",
                    color: filter === f ? "var(--text-soft)" : "var(--text-faint)",
                    cursor: "pointer",
                    transition: "color .15s, border-color .15s"
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>

        {props.packs.length === 0 && (
          <div
            style={{
              border: "2px dashed var(--border)",
              borderRadius: 14,
              padding: "64px 48px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
              background: "#121517"
            }}
          >
            <div
              className="mono"
              style={{ width: 56, height: 56, border: "1px solid var(--border)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--amber)" }}
            >
              ↓
            </div>
            <div style={{ fontSize: 26, fontWeight: 500 }}>Добавьте первый пак</div>
            <div style={{ fontSize: 15, color: "var(--text-mute)", textAlign: "center", maxWidth: 520 }}>
              Внутри — витрина паков сообщества: сцена, фонограмма, персонажи и реплики. Скачивается на ваше устройство и остаётся у вас.
            </div>
            <button className="btn btn-primary" style={{ marginTop: 6, padding: "11px 20px" }} onClick={props.onOpenMarket}>
              Открыть витрину
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 300px))", gap: 18, alignItems: "stretch" }}>
          {shown.map((p) => {
            const done = progress[p.slug] ?? 0;
            const total = p.lines.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const coverRel = p.cover ?? p.icon;
            return (
              <div key={p.slug} className="card card-hover" style={{ overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
                <div style={{ height: 156, background: "#141719", position: "relative", overflow: "hidden" }}>
                  {coverRel && (
                    <img
                      src={assetUrl(p.slug, coverRel)}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  )}
                  <div className="mono" style={{ position: "absolute", left: 10, top: 10, background: "#0d0f11cc", borderRadius: 6, padding: "3px 7px", fontSize: 11, color: "var(--text-soft)" }}>
                    {formatTime(p.videoDuration)}
                  </div>
                  {pct >= 100 && (
                    <div className="mono" style={{ position: "absolute", right: 10, top: 10, background: "var(--green)", color: "var(--ink)", borderRadius: 6, padding: "3px 7px", fontSize: 11, fontWeight: 500 }}>
                      готово
                    </div>
                  )}
                  <div
                    className="pack-delete"
                    title="удалить пак с устройства"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(p);
                    }}
                  >
                    <div style={{ position: "absolute", width: 12, height: 1.5, background: "currentColor", transform: "rotate(45deg)" }} />
                    <div style={{ position: "absolute", width: 12, height: 1.5, background: "currentColor", transform: "rotate(-45deg)" }} />
                  </div>
                </div>
                <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 16.5, fontWeight: 500, lineHeight: 1.3 }}>{p.title}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", gap: 8 }}>
                      <span>{p.authors[0] ?? "—"}</span>
                      <span style={{ color: "#3a4045" }}>·</span>
                      <span>{total} {plural(total, "реплика", "реплики", "реплик")}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    {p.characters.slice(0, 6).map((c) => (
                      <div
                        key={c.name}
                        title={c.name}
                        style={{ width: 22, height: 22, borderRadius: 99, border: `2px solid ${c.color}`, overflow: "hidden", background: "#20252a", flex: "none" }}
                      >
                        {c.image && (
                          <img
                            src={assetUrl(p.slug, c.image)}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                          />
                        )}
                      </div>
                    ))}
                    {p.characters.length > 6 && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>+{p.characters.length - 6}</div>
                    )}
                  </div>
                  <div
                    onClick={() => (pct >= 100 ? props.onWatch(p.slug) : props.onRecord(p.slug))}
                    style={{
                      marginTop: "auto",
                      position: "relative",
                      height: 40,
                      borderRadius: 9,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: pct >= 100 ? "var(--green)" : pct > 0 ? "var(--amber-dark)" : "var(--amber)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    {pct > 0 && pct < 100 && (
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "var(--amber)" }} />
                    )}
                    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
                      <div style={{ width: 0, height: 0, borderLeft: "8px solid var(--ink)", borderTop: "5px solid transparent", borderBottom: "5px solid transparent" }} />
                      {pct >= 100 ? "Смотреть дубляж" : pct > 0 ? `Продолжить · ${pct}%` : "Начать"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pendingDelete && (
        <div className="overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 500 }}>Удалить «{pendingDelete.title}»?</div>
              <div style={{ fontSize: 14, color: "var(--text-mute)", lineHeight: 1.55 }}>
                С устройства сотрётся всё, что связано с паком: видео, фонограмма, ваши записанные дубли и
                сведённый дубляж. Вернуть можно только скачав пак заново — но дубли пропадут насовсем.
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setPendingDelete(null)}>Оставить</button>
              <button
                className="btn"
                style={{ borderColor: "var(--red)", color: "var(--red)" }}
                onClick={() => {
                  props.onDelete(pendingDelete.slug);
                  setPendingDelete(null);
                }}
              >
                Удалить всё
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
