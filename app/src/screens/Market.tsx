import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { IndexPack } from "../types";

export default function Market(props: {
  installedSlugs: string[];
  busy: boolean;
  onBack: () => void;
  onInstall: (entry: IndexPack) => void;
  onOpen: (entry: IndexPack) => void;
}) {
  const [all, setAll] = useState<IndexPack[] | null>(null);
  const [q, setQ] = useState("");
  const [showMature, setShowMature] = useState(false);
  const [sort, setSort] = useState<"new" | "az" | "small">("new");
  const [limit, setLimit] = useState(60);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLimit(60);
  }, [q, sort, showMature]);

  useEffect(() => {
    api
      .fetchIndex()
      .then((text) => {
        const parsed = JSON.parse(text) as IndexPack[];
        setAll(parsed.filter((p) => p.modType === "dub-pack"));
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!all) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const bySize = (p: IndexPack) => {
      const n = parseFloat(p.fileSize) || 9999;
      return p.fileSize.includes("KB") ? n / 1024 : p.fileSize.includes("GB") ? n * 1024 : n;
    };
    // полнотекст как на самом сайте: название, автор, описание, теги, язык
    const haystack = (p: IndexPack & { searchText?: string }) =>
      (
        p.searchText ??
        `${p.title} ${p.creator} ${p.shortDescription} ${p.tags.join(" ")} ${p.language}`
      ).toLowerCase();
    return all
      .filter((p) => (showMature || !p.mature))
      .filter((p) => {
        if (words.length === 0) return true;
        const h = haystack(p);
        return words.every((w) => h.includes(w));
      })
      .sort((a, b) =>
        sort === "az"
          ? a.title.localeCompare(b.title)
          : sort === "small"
            ? bySize(a) - bySize(b)
            : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
      );
  }, [all, q, showMature, sort]);
  const shown = filtered.slice(0, limit);

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
        <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }} onClick={props.onBack}>
          ← Библиотека
        </div>
        <div style={{ width: 1, height: 20, background: "var(--card-border)" }} />
        <div style={{ fontSize: 15, fontWeight: 500 }}>Паки сообщества</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
          choicervoicer.com
        </div>
        <div style={{ flex: 1 }} />
        <label
          className="mono"
          style={{ fontSize: 11, color: "var(--text-faint)", display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
        >
          <input type="checkbox" checked={showMature} onChange={(e) => setShowMature(e.target.checked)} />
          показывать 18+
        </label>
      </div>

      <div style={{ padding: "20px 28px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="search"
          placeholder="Поиск по всему каталогу: название, автор, описание, теги…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 420 }}
        />
        <div className="mono" style={{ display: "flex", gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {(
            [
              ["new", "новые"],
              ["az", "а-я"],
              ["small", "полегче"]
            ] as ["new" | "az" | "small", string][]
          ).map(([s, label]) => (
            <div
              key={s}
              onClick={() => setSort(s)}
              style={{
                border: `1px solid ${sort === s ? "var(--border)" : "var(--line)"}`,
                borderRadius: 99,
                padding: "6px 12px",
                color: sort === s ? "var(--text-soft)" : "var(--text-faint)",
                cursor: "pointer",
                transition: "color .15s, border-color .15s"
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: "auto" }}>
          {all ? `${filtered.length} ${filtered.length === 1 ? "пак" : "паков"}` : "загружаю каталог…"}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 28px 36px" }}>
        {loadError && (
          <div className="card" style={{ padding: 20, color: "var(--text-mute)", fontSize: 14 }}>
            Каталог не загрузился: {loadError}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
            gap: 16
          }}
        >
          {shown.map((p) => {
            const installed = props.installedSlugs.includes(p.slug);
            return (
              <div key={p.slug} className="card card-hover" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div
                  onClick={() => props.onOpen(p)}
                  title="открыть страницу пака"
                  style={{
                    height: 130,
                    background: "#141719",
                    position: "relative",
                    overflow: "hidden",
                    cursor: "pointer"
                  }}
                >
                  {p.thumbnail && (
                    <img
                      src={p.thumbnail}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  )}
                  {p.mature && (
                    <div
                      className="mono"
                      style={{
                        position: "absolute",
                        left: 10,
                        top: 10,
                        background: "var(--red)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        padding: "3px 7px",
                        fontSize: 11,
                        fontWeight: 500
                      }}
                    >
                      18+
                    </div>
                  )}
                </div>
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, cursor: "pointer" }} onClick={() => props.onOpen(p)}>
                    <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3 }}>{p.title}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 8 }}>
                      <span>{p.creator}</span>
                      <span style={{ color: "#3a4045" }}>·</span>
                      <span>{p.summaryValue}</span>
                    </div>
                  </div>
                  <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      className={installed ? "btn" : "btn btn-primary"}
                      style={{ flex: 1, justifyContent: "center" }}
                      disabled={props.busy || installed}
                      onClick={() => props.onInstall(p)}
                    >
                      {installed ? "Уже в библиотеке" : "Скачать"}
                    </button>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                      {p.fileSize}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length > limit && (
          <div style={{ display: "flex", justifyContent: "center", padding: "22px 0 6px" }}>
            <button className="btn" onClick={() => setLimit((l) => l + 60)}>
              Показать ещё · осталось {filtered.length - limit}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
