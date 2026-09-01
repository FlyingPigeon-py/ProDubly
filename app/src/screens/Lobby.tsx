import { useEffect, useSyncExternalStore } from "react";
import { newCoopDubId } from "../dubs";
import type { CoopSession } from "../session/coop";
import { canStart, unclaimedCharacters } from "../session/state";
import type { PackMeta } from "../types";

export default function Lobby(props: {
  session: CoopSession;
  packs: PackMeta[];
  onStarted: (slug: string, dubId: string) => void;
  onOpenMarket: () => void;
  onLeave: () => void;
}) {
  const view = useSyncExternalStore(props.session.subscribe, props.session.getSnapshot);
  const { state } = view;
  const isHost = view.role === "host";
  const meta = props.packs.find((p) => p.slug === (view.slug || state.packSlug)) ?? null;
  const pending = meta ? unclaimedCharacters(state, meta) : [];
  const ready = meta ? canStart(state, meta) : false;

  useEffect(() => {
    if (view.hasPack || !meta) return;
    void props.session.attachPack(meta, newCoopDubId());
  }, [view.hasPack, meta, props.session]);

  useEffect(() => {
    if (state.phase === "running") props.onStarted(view.slug, view.dubId);
  }, [state.phase, view.slug, view.dubId, props]);

  const ownerName = (character: string) => {
    const owner = state.roles[character];
    return state.participants.find((p) => p.id === owner)?.name ?? null;
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
          justifyContent: "space-between",
          padding: "0 22px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }} onClick={props.onLeave}>
            ← Выйти
          </div>
          <div style={{ width: 1, height: 20, background: "var(--card-border)" }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            {meta ? `${meta.title} · совместная озвучка` : "Совместная озвучка"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="label">код комнаты</div>
          <div
            className="mono"
            title="нажмите, чтобы скопировать"
            onClick={() => navigator.clipboard?.writeText(view.code)}
            style={{
              fontSize: 20,
              letterSpacing: "0.28em",
              color: "var(--amber)",
              border: "1px solid var(--border)",
              borderRadius: 9,
              padding: "6px 14px",
              cursor: "pointer"
            }}
          >
            {view.code || "…"}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 28, display: "flex", flexWrap: "wrap", gap: 24, alignContent: "flex-start" }}>
        <div className="card" style={{ flex: "1 1 300px", maxWidth: 380, padding: 22, borderRadius: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="label">Кто в комнате</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.participants.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    flex: "none",
                    background: p.connected ? (p.ready ? "var(--green)" : "var(--amber)") : "var(--red)"
                  }}
                />
                <div style={{ fontSize: 14, color: "var(--text-soft)" }}>{p.name}</div>
                {p.id === state.hostId && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>хост</span>
                )}
                {p.id === view.selfId && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>вы</span>
                )}
                <div className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>
                  {!p.connected ? "нет связи" : p.ready ? "готов" : "нет пака"}
                </div>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
            Передайте код друзьям. Голосом договаривайтесь в своём чате — игра гоняет только реплики.
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 460px", minWidth: 0, padding: 22, borderRadius: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="label">Персонажи</div>
            <div className="mono" style={{ fontSize: 11, color: pending.length > 0 ? "var(--amber)" : "var(--green)" }}>
              {pending.length > 0 ? `не разобрано: ${pending.length}` : "все разобраны"}
            </div>
          </div>
          {!meta && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 14, color: "var(--text-mute)", lineHeight: 1.55 }}>
                {state.packSlug
                  ? `В комнате озвучивают пак «${state.packSlug}», а у вас его нет. Скачайте его с витрины — и роли можно будет разобрать.`
                  : "Ждём, пока хост скажет, какой пак озвучиваем."}
              </div>
              {state.packSlug && (
                <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={props.onOpenMarket}>
                  Открыть витрину
                </button>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {(meta?.characters ?? []).map((c) => {
              const owner = state.roles[c.name];
              const mine = owner === view.selfId;
              const lines = meta ? meta.lines.filter((l) => l.who === c.name).length : 0;
              return (
                <div
                  key={c.name}
                  onClick={() =>
                    props.session.command(mine ? { type: "release", character: c.name } : { type: "claim", character: c.name })
                  }
                  className="row-hover"
                  style={{
                    border: `1px solid ${mine ? c.color : "var(--card-border)"}`,
                    borderRadius: 10,
                    padding: "11px 13px",
                    cursor: owner && !mine ? "default" : "pointer",
                    opacity: owner && !mine ? 0.75 : 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 99, background: c.color, flex: "none" }} />
                    <div className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{c.name}</div>
                    <div className="mono" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)" }}>
                      {lines} реплик
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: owner ? (mine ? c.color : "var(--text-mute)") : "var(--text-faint)" }}>
                    {owner ? (mine ? "ваш — нажмите, чтобы отдать" : ownerName(c.name)) : "свободен — нажмите, чтобы взять"}
                  </div>
                </div>
              );
            })}
          </div>

          {isHost ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              <button
                className="btn btn-primary"
                disabled={!ready}
                onClick={() => props.session.command({ type: "start" })}
              >
                Начать озвучку
              </button>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                {ready ? "все на местах" : "старт откроется, когда разберут всех персонажей и все будут готовы"}
              </div>
            </div>
          ) : (
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
              Начинает хост, когда разберут всех персонажей.
            </div>
          )}
        </div>

        {view.error && (
          <div className="card" style={{ flex: "1 1 100%", padding: 16, borderRadius: 12, borderColor: "var(--red)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>{view.error}</div>
              <button className="btn" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => props.session.clearError()}>
                Понятно
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
