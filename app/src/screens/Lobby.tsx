import { useEffect, useState, useSyncExternalStore } from "react";
import { api, loadPackMeta } from "../api";
import { findPack } from "../catalog";
import { newCoopDubId } from "../dubs";
import { recallRoom, rememberRoom } from "../session/rooms";
import type { CoopSession } from "../session/coop";
import { canStart, unclaimedCharacters } from "../session/state";
import type { IndexPack, PackMeta } from "../types";

export default function Lobby(props: {
  session: CoopSession;
  packs: PackMeta[];
  busy: boolean;
  onStarted: (slug: string, dubId: string) => void;
  onInstallPack: (slug: string) => void;
  onOpenMarket: () => void;
  onLeave: () => void;
}) {
  const view = useSyncExternalStore(props.session.subscribe, props.session.getSnapshot);
  const { state } = view;
  const isHost = view.role === "host";
  const [ownMeta, setOwnMeta] = useState<PackMeta | null>(null);
  const wanted = view.slug || state.packSlug;
  const meta = props.packs.find((p) => p.slug === wanted) ?? (ownMeta?.slug === wanted ? ownMeta : null);
  const pending = meta ? unclaimedCharacters(state, meta) : [];
  const ready = meta ? canStart(state, meta) : false;
  const live = state.participants.filter((p) => p.connected).length;
  const [offered, setOffered] = useState<IndexPack | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  // пак может лежать на диске, даже если библиотека в памяти о нём ещё не знает
  useEffect(() => {
    if (!wanted || props.packs.some((p) => p.slug === wanted) || ownMeta?.slug === wanted) return;
    let alive = true;
    loadPackMeta(wanted)
      .then((m) => alive && setOwnMeta(m))
      .catch(() => alive && setOwnMeta(null));
    return () => {
      alive = false;
    };
  }, [wanted, props.packs, ownMeta]);

  useEffect(() => {
    if (view.hasPack || !meta) return;
    const remembered = recallRoom(view.code);
    const dubId = remembered?.slug === meta.slug ? remembered.dubId : newCoopDubId();
    rememberRoom(view.code, { slug: meta.slug, dubId });
    void props.session.attachPack(meta, dubId);
  }, [view.hasPack, view.code, meta, props.session]);

  useEffect(() => {
    if (state.phase === "running") props.onStarted(view.slug, view.dubId);
  }, [state.phase, view.slug, view.dubId, props]);

  useEffect(() => {
    if (meta || !state.packSlug) return;
    let alive = true;
    setLookupFailed(false);
    api
      .fetchIndex()
      .then((text) => {
        if (!alive) return;
        const entry = findPack(JSON.parse(text) as IndexPack[], state.packSlug);
        setOffered(entry);
        setLookupFailed(entry === null);
      })
      .catch(() => alive && setLookupFailed(true));
    return () => {
      alive = false;
    };
  }, [meta, state.packSlug]);

  const owner = (character: string) => {
    const id = state.roles[character];
    if (!id) return null;
    return state.participants.find((p) => p.id === id) ?? null;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel-bg)" }}>
      <div
        style={{
          height: 56,
          flex: "none",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 22px"
        }}
      >
        <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }} onClick={props.onLeave}>
          ← Выйти
        </div>
        <div style={{ width: 1, height: 20, background: "var(--card-border)" }} />
        <div style={{ fontSize: 15, fontWeight: 500 }}>{meta ? meta.title : "Совместная озвучка"}</div>
        <div style={{ flex: 1 }} />
        <div
          className="mono"
          title="нажмите, чтобы скопировать код"
          onClick={() => navigator.clipboard?.writeText(view.code)}
          style={{
            fontSize: 17,
            letterSpacing: "0.26em",
            color: "var(--amber)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "5px 13px",
            cursor: "pointer"
          }}
        >
          {view.code || "…"}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {live} в эфире
        </div>
        {isHost ? (
          <button
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            disabled={!ready}
            title={ready ? undefined : "разберите всех персонажей"}
            onClick={() => props.session.command({ type: "start" })}
          >
            Начать
          </button>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
            начинает хост
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 28px 32px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {!meta && (
            <div className="card" style={{ padding: 22, borderRadius: 12, display: "flex", flexDirection: "column", gap: 16 }}>
              {!state.packSlug && (
                <div style={{ fontSize: 14, color: "var(--text-mute)" }}>Ждём, пока хост скажет, какой пак озвучиваем.</div>
              )}

              {state.packSlug && offered && (
                <>
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    {offered.thumbnail && (
                      <img
                        src={offered.thumbnail}
                        style={{ width: 148, height: 84, objectFit: "cover", borderRadius: 8, flex: "none", background: "#141719" }}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                      />
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 500 }}>{offered.title}</div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", gap: 8 }}>
                        <span>{offered.creator}</span>
                        <span style={{ color: "#3a4045" }}>·</span>
                        <span>{offered.summaryValue}</span>
                      </div>
                      <div style={{ fontSize: 13.5, color: "var(--text-mute)", lineHeight: 1.5 }}>
                        Этот пак озвучивают в комнате, а у вас его нет — скачайте, и можно разбирать роли.
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: "flex-start" }}
                    disabled={props.busy}
                    onClick={() => props.onInstallPack(state.packSlug)}
                  >
                    {props.busy ? "Качаем…" : `Скачать · ${offered.fileSize}`}
                  </button>
                </>
              )}

              {state.packSlug && !offered && (
                <>
                  <div style={{ fontSize: 14, color: "var(--text-mute)", lineHeight: 1.55 }}>
                    {lookupFailed
                      ? `Пак «${state.packSlug}» не нашёлся ни у вас, ни в витрине — возможно, хост собрал его сам.`
                      : `Ищем пак «${state.packSlug}»…`}
                  </div>
                  {lookupFailed && (
                    <button className="btn" style={{ alignSelf: "flex-start" }} onClick={props.onOpenMarket}>
                      Открыть витрину
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {meta && (
            <div className="card" style={{ borderRadius: 12, overflow: "hidden" }}>
              {meta.characters.map((c) => {
                const holder = owner(c.name);
                const mine = holder?.id === view.selfId;
                const lines = meta.lines.filter((l) => l.who === c.name).length;
                return (
                  <div
                    key={c.name}
                    onClick={() =>
                      props.session.command(
                        mine ? { type: "release", character: c.name } : { type: "claim", character: c.name }
                      )
                    }
                    className="row-hover"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 18px",
                      borderBottom: "1px solid #191d20",
                      cursor: holder && !mine ? "default" : "pointer"
                    }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: 99, background: c.color, flex: "none" }} />
                    <div className="mono" style={{ fontSize: 13, color: "var(--text)", flex: "none", minWidth: 110 }}>
                      {c.name}
                    </div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                      {lines} {plural(lines, "реплика", "реплики", "реплик")}
                    </div>
                    <div
                      className="mono"
                      style={{
                        marginLeft: "auto",
                        fontSize: 12,
                        color: holder
                          ? mine
                            ? c.color
                            : holder.connected
                              ? "var(--text-mute)"
                              : "var(--red)"
                          : "var(--text-faint)"
                      }}
                    >
                      {holder ? (mine ? "вы" : holder.connected ? holder.name : `${holder.name} · нет связи`) : "свободен"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {meta && pending.length > 0 && (
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              нажмите на свободного персонажа, чтобы взять его
            </div>
          )}

          {view.error && (
            <div
              className="card"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                borderColor: "var(--red)",
                display: "flex",
                alignItems: "center",
                gap: 12
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-soft)" }}>{view.error}</div>
              <button className="btn" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => props.session.clearError()}>
                Понятно
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
