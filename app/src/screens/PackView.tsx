import { useState } from "react";
import type { IndexPack } from "../types";

const R2_BASE = "https://pub-d3643445511f4a59b7c1923785cafa51.r2.dev/mods/dub";

export default function PackView(props: {
  entry: IndexPack;
  installed: boolean;
  busy: boolean;
  onBack: () => void;
  onInstall: (entry: IndexPack) => void;
}) {
  const p = props.entry;
  const [videoFailed, setVideoFailed] = useState(false);
  const previewUrl = `${R2_BASE}/${p.slug}/web/preview.mp4`;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel-bg)" }}>
      <div
        style={{
          height: 60,
          flex: "none",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 28px"
        }}
      >
        <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer", flex: "none" }} onClick={props.onBack}>
          ← Витрина
        </div>
        <div style={{ width: 1, height: 20, background: "var(--card-border)", flex: "none" }} />
        <div style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.title}
        </div>
        {p.mature && (
          <div className="mono" style={{ flex: "none", background: "var(--red)", color: "var(--ink)", borderRadius: 6, padding: "3px 7px", fontSize: 11, fontWeight: 500 }}>
            18+
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", maxWidth: 1240, margin: "0 auto" }}>
          {/* превью */}
          <div style={{ flex: "1 1 560px", minWidth: 320 }}>
            <div
              className="card"
              style={{ aspectRatio: "16 / 9", position: "relative", overflow: "hidden", borderRadius: 12, background: "#0a0c0d" }}
            >
              {!videoFailed ? (
                <video
                  src={previewUrl}
                  poster={p.thumbnail || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setVideoFailed(true)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <>
                  {p.thumbnail && (
                    <img
                      src={p.thumbnail}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  )}
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", background: "#0a0c0dcc", borderRadius: 99, padding: "6px 14px" }}>
                      Предпросмотр недоступен, но пак можно скачать
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mono" style={{ marginTop: 10, fontSize: 11, color: "var(--text-faint)" }}>
              предпросмотр с оригинальной озвучкой · после скачивания все реплики озвучиваете вы
            </div>
          </div>

          {/* инфо */}
          <div style={{ flex: "1 1 320px", minWidth: 280, maxWidth: 460, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRadius: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.25 }}>{p.title}</div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>от {p.creator}</div>
              </div>
              {p.shortDescription && (
                <div style={{ fontSize: 14, color: "var(--text-mute)", lineHeight: 1.55 }}>{p.shortDescription}</div>
              )}
              {p.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.tags.map((t) => (
                    <span key={t} className="mono" style={{ border: "1px solid var(--border)", borderRadius: 99, padding: "3px 9px", fontSize: 11, color: "var(--text-soft)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, borderRadius: 12 }}>
              <div className="label" style={{ marginBottom: 2 }}>Что внутри</div>
              <InfoRow k="сцена" v={p.summaryValue} />
              <InfoRow k="размер" v={p.fileSize} />
              <InfoRow k="язык" v={p.language || "—"} />
              <InfoRow k="обновлён" v={p.updatedAt || "—"} />
            </div>

            <button
              className={props.installed ? "btn" : "btn btn-primary"}
              style={{ justifyContent: "center", height: 44, fontSize: 14 }}
              disabled={props.busy || props.installed}
              onClick={() => props.onInstall(p)}
            >
              {props.installed ? "Уже в библиотеке" : `Скачать и озвучить · ${p.fileSize}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{k}</span>
      <span style={{ color: "var(--text-soft)", textAlign: "right" }}>{v}</span>
    </div>
  );
}
