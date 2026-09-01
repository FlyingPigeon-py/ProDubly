import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { loadFilters, saveFilters, selectPacks, type CatalogFilters, type SortMode } from "../catalog";
import type { IndexPack } from "../types";

const PAGE = 60;

const view = { scrollTop: 0, limit: PAGE };

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={props.onClick}
      style={{
        border: `1px solid ${props.active ? "var(--border)" : "var(--line)"}`,
        borderRadius: 99,
        padding: "6px 12px",
        color: props.active ? "var(--text-soft)" : "var(--text-faint)",
        cursor: "pointer",
        transition: "color .15s, border-color .15s"
      }}
    >
      {props.children}
    </div>
  );
}

export default function Market(props: {
  installedSlugs: string[];
  busy: boolean;
  onBack: () => void;
  onInstall: (entry: IndexPack) => void;
  onOpen: (entry: IndexPack) => void;
}) {
  const [all, setAll] = useState<IndexPack[] | null>(null);
  const [filters, setFilters] = useState<CatalogFilters>(loadFilters);
  const [limit, setLimit] = useState(view.limit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const patch = (p: Partial<CatalogFilters>) => {
    setFilters((f) => {
      const next = { ...f, ...p };
      saveFilters(next);
      return next;
    });
    view.scrollTop = 0;
    view.limit = PAGE;
    setLimit(PAGE);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  useEffect(() => {
    const dubPacks = (text: string) => (JSON.parse(text) as IndexPack[]).filter((p) => p.modType === "dub-pack");
    let gotFresh = false;
    const unlisten = api.onIndexUpdated((text) => {
      gotFresh = true;
      setAll(dubPacks(text));
      setLoadError(null);
      setRefreshed(true);
    });
    unlisten
      .then(() => api.fetchIndex())
      .then((text) => {
        if (!gotFresh) setAll(dubPacks(text));
      })
      .catch((e) => setLoadError(String(e)));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const filtered = useMemo(() => (all ? selectPacks(all, filters) : []), [all, filters]);
  const shown = filtered.slice(0, limit);

  useLayoutEffect(() => {
    if (restored.current || shown.length === 0 || !listRef.current) return;
    restored.current = true;
    listRef.current.scrollTop = view.scrollTop;
  }, [shown.length]);

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
        {refreshed && (
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Каталог обновлён
          </div>
        )}
      </div>

      <div style={{ padding: "20px 28px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="search"
          placeholder="Поиск по всему каталогу: название, автор, описание, теги…"
          value={filters.q}
          onChange={(e) => patch({ q: e.target.value })}
          style={{ maxWidth: 420 }}
        />
        <div className="mono" style={{ display: "flex", gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {(
            [
              ["new", "новые"],
              ["az", "а-я"],
              ["small", "по размеру"]
            ] as [SortMode, string][]
          ).map(([s, label]) => (
            <Chip key={s} active={filters.sort === s} onClick={() => patch({ sort: s })}>
              {label}
            </Chip>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: "auto" }}>
          {all ? `${filtered.length} ${filtered.length === 1 ? "пак" : "паков"}` : "Загрузка каталога…"}
        </div>
      </div>

      <div
        className="mono"
        style={{
          padding: "12px 28px 0",
          display: "flex",
          gap: 18,
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase"
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <Chip active={filters.trendingOnly} onClick={() => patch({ trendingOnly: !filters.trendingOnly })}>
            в тренде
          </Chip>
          <Chip active={filters.creatorsOnly} onClick={() => patch({ creatorsOnly: !filters.creatorsOnly })}>
            от авторов
          </Chip>
          <Chip active={filters.showMature} onClick={() => patch({ showMature: !filters.showMature })}>
            18+
          </Chip>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--text-faint)" }}>ролик</span>
          {(
            [
              [null, "любой"],
              [30, "до 30с"],
              [60, "до 1 мин"]
            ] as [number | null, string][]
          ).map(([v, label]) => (
            <Chip key={label} active={filters.maxDuration === v} onClick={() => patch({ maxDuration: v })}>
              {label}
            </Chip>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--text-faint)" }}>реплик</span>
          {(
            [
              [null, "любое"],
              [5, "до 5"],
              [15, "до 15"]
            ] as [number | null, string][]
          ).map(([v, label]) => (
            <Chip key={label} active={filters.maxLines === v} onClick={() => patch({ maxLines: v })}>
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          view.scrollTop = e.currentTarget.scrollTop;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 28px 36px" }}
      >
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
            <button
              className="btn"
              onClick={() =>
                setLimit((l) => {
                  view.limit = l + PAGE;
                  return view.limit;
                })
              }
            >
              Показать ещё · осталось {filtered.length - limit}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
