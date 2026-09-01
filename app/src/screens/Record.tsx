import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, assetUrl, loadPackMeta, loadTranslation, saveTranslation } from "../api";
import { SOLO_DUB, dubRel, ensureDub, loadTakes, saveTakes } from "../dubs";
import { decodeUrl } from "../audio/peaks";
import { binsFromSamples, type WaveBins } from "../audio/bins";
import { TakeEngine, lineWindow, type TakePhase, type TakeResult } from "../audio/takeEngine";
import { verdictColor, verdictLabel } from "../audio/score";
import WaveCanvas from "../components/WaveCanvas";
import { loadSettings, updateSettings } from "../settings";
import { buildContext, displayText, mergeTranslation, pendingLines } from "../translate";
import { lineOwner } from "../session/state";
import type { CoopSession, CoopView } from "../session/coop";
import type { PackLine, PackMeta, TakeInfo, TakesMap, TranslationMap } from "../types";

const BARS = 220;

const NO_COOP: CoopView | null = null;

function useCoopView(session: CoopSession | null): CoopView | null {
  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : () => {}),
    [session]
  );
  const snapshot = useCallback(() => (session ? session.getSnapshot() : NO_COOP), [session]);
  return useSyncExternalStore(subscribe, snapshot);
}

export default function Record(props: {
  slug: string;
  dubId: string;
  coop?: CoopSession | null;
  startLine?: number;
  settingsVersion: number;
  onBack: () => void;
  onSettings: () => void;
  onResults: (slug: string, dubId: string) => void;
}) {
  const coop = props.coop ?? null;
  const coopView = useCoopView(coop);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [localTakes, setLocalTakes] = useState<TakesMap>({});
  const [localCur, setLocalCur] = useState(0);
  const [phase, setPhase] = useState<TakePhase>("idle");
  const [leadCount, setLeadCount] = useState(3);
  const [origBins, setOrigBins] = useState<WaveBins | null>(null);
  const recBinsRef = useRef<WaveBins | null>(null);
  const [recVersion, setRecVersion] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem("dubl.autonext") === "1");
  const [fatal, setFatal] = useState<string | null>(null);
  const [translation, setTranslation] = useState<TranslationMap>({});
  const [showTranslation, setShowTranslation] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engineRef = useRef<TakeEngine | null>(null);
  const bufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  const heardRef = useRef<string>("");
  const autoNextTimer = useRef(0);

  const takes = coopView ? coopView.takes : localTakes;
  const cur = coopView ? coopView.state.lineIndex : localCur;
  const line: PackLine | null = meta?.lines[cur] ?? null;
  const hasTranslation = line ? Boolean(translation[line.id]) : false;

  const settings = useMemo(() => loadSettings(), [props.settingsVersion]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const win = useMemo(() => lineWindow(line, settings.lead), [line, settings]);

  const owner = coopView && meta ? lineOwner(coopView.state, meta, cur) : undefined;
  const ownerName = coopView?.state.participants.find((p) => p.id === owner)?.name ?? "";
  const mine = !coopView || owner === coopView.selfId;
  const isHost = coopView ? coopView.selfId === coopView.state.hostId : false;
  const canDrive = !coopView || mine || isHost;
  const paused = coopView?.state.phase === "paused";
  const pausedName =
    coopView?.state.participants.find((p) => p.id === coopView.state.pausedFor)?.name ?? "участника";
  const locked = Boolean(coopView) && (!mine || paused);

  const takeUrl = useCallback(
    (take: TakeInfo) => assetUrl(props.slug, dubRel(props.dubId, take.file)) + `?v=${take.recordedAt}`,
    [props.slug, props.dubId]
  );

  const toggleTranslation = () => {
    const next = !showTranslation;
    setShowTranslation(next);
    updateSettings({ showTranslation: next });
  };

  useEffect(() => {
    setShowTranslation(settings.showTranslation);
  }, [settings.showTranslation]);

  const translatePack = useCallback(async () => {
    if (!meta) return;
    const pending = pendingLines(meta, translation);
    if (pending.length === 0) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const translated = await api.translateLines(
        settings.deeplKey,
        pending.map((l) => l.text),
        buildContext(meta)
      );
      const merged = mergeTranslation(translation, pending, translated);
      setTranslation(merged);
      await saveTranslation(props.slug, merged);
      setShowTranslation(true);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranslating(false);
    }
  }, [meta, translation, props.slug, settings.deeplKey]);

  useEffect(() => {
    const engine = new TakeEngine({
      video: () => videoRef.current,
      audio: () => audioRef.current,
      settings: () => settingsRef.current,
      bars: BARS,
      hooks: {
        onPhase: setPhase,
        onTakeReady: (take) => void keepTakeRef.current(take),
        onLeadCount: setLeadCount,
        onPlayhead: setPlayhead,
        onRecBins: (bins) => {
          recBinsRef.current = bins;
          setRecVersion((v) => v + 1);
        },
        onError: setFatal
      }
    });
    engineRef.current = engine;
    return () => {
      window.clearTimeout(autoNextTimer.current);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.resetRecorder();
  }, [props.settingsVersion]);

  useEffect(() => {
    (async () => {
      const m = await loadPackMeta(props.slug);
      setMeta(m);
      if (!coop) setLocalTakes(await loadTakes(props.slug, props.dubId));
      setTranslation(await loadTranslation(props.slug));
    })().catch((e) => setFatal(String(e)));
  }, [props.slug, props.dubId, coop]);

  useEffect(() => {
    engineRef.current?.setLine(line);
    if (coopView) engineRef.current?.showFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, settings.lead]);

  useEffect(() => {
    if (!line) return;
    let alive = true;
    setOrigBins(null);
    recBinsRef.current = null;
    setRecVersion((v) => v + 1);
    (async () => {
      let buf = bufferCache.current.get(line.id);
      if (!buf) {
        buf = await decodeUrl(assetUrl(props.slug, line.orig));
        bufferCache.current.set(line.id, buf);
      }
      if (!alive || !buf) return;
      setOrigBins(binsFromSamples(buf.getChannelData(0), buf.sampleRate, line.start, win.from, win.dur, BARS));
      const existing = takes[line.id];
      if (existing) {
        try {
          const takeBuf = await decodeUrl(takeUrl(existing));
          if (alive) {
            recBinsRef.current = binsFromSamples(
              takeBuf.getChannelData(0),
              takeBuf.sampleRate,
              line.start,
              win.from,
              win.dur,
              BARS
            );
            setRecVersion((v) => v + 1);
          }
        } catch {
          /* дубль ещё не читается — не страшно */
        }
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id, meta]);

  const selectLine = useCallback(
    (idx: number) => {
      if (!meta || coopView) return;
      setLocalCur(idx);
      engineRef.current?.setLine(meta.lines[idx]);
      engineRef.current?.showFrame();
    },
    [meta, coopView]
  );

  const playOrig = useCallback(() => {
    if (!line) return;
    engineRef.current?.playOrig(assetUrl(props.slug, line.orig));
  }, [line, props.slug]);

  const playTake = useCallback(() => {
    if (!line) return;
    const take = takes[line.id];
    if (!take) return;
    engineRef.current?.playTake(takeUrl(take));
  }, [line, takes, takeUrl]);

  const startRec = useCallback(async () => {
    if (locked) return;
    await engineRef.current?.startRec((freq) => beep(freq));
  }, [locked]);

  const advance = useCallback(() => {
    if (!meta) return;
    if (coop) {
      coop.command({ type: "advance" });
      return;
    }
    if (localCur < meta.lines.length - 1) selectLine(localCur + 1);
    else props.onResults(props.slug, props.dubId);
  }, [meta, coop, localCur, selectLine, props]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const keepTake = useCallback(
    async (result: TakeResult) => {
      if (!line) return;
      const file = `takes/${line.id}.wav`;
      const prev = takes[line.id];
      const take: TakeInfo = {
        file,
        duration: result.duration,
        recordedAt: Date.now(),
        takeCount: (prev?.takeCount ?? (prev ? 1 : 0)) + 1,
        analysis: result.analysis
      };
      try {
        if (coop) {
          await coop.publishTake(line.id, take, result.wav);
        } else {
          await ensureDub(props.slug, props.dubId, props.dubId === SOLO_DUB ? "solo" : "coop");
          await api.writeBinary(props.slug, dubRel(props.dubId, file), result.wav);
          const next = { ...takes, [line.id]: take };
          setLocalTakes(next);
          await saveTakes(props.slug, props.dubId, next);
        }
      } catch (e) {
        setFatal(`Не удалось сохранить дубль: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (autoNext && !coop && result.analysis.verdict !== "тишина") {
        autoNextTimer.current = window.setTimeout(() => {
          if (engineRef.current?.phase === "done") advanceRef.current();
        }, 900);
      }
    },
    [line, takes, coop, props.slug, props.dubId, autoNext]
  );
  const keepTakeRef = useRef(keepTake);
  keepTakeRef.current = keepTake;

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !line || !coopView) return;
    const take = takes[line.id];
    if (!take) return;
    const stamp = `${line.id}:${take.recordedAt}`;
    if (heardRef.current === stamp) return;
    heardRef.current = stamp;
    engine.playTake(takeUrl(take));
  }, [takes, line, coopView, takeUrl]);

  useEffect(() => {
    if (coopView?.state.phase === "finished") props.onResults(props.slug, props.dubId);
  }, [coopView?.state.phase, props]);

  const bootRef = useRef(false);
  useEffect(() => {
    if (meta && !bootRef.current) {
      bootRef.current = true;
      if (coopView) {
        engineRef.current?.showFrame();
      } else if (props.startLine !== undefined) {
        selectLine(Math.min(props.startLine, meta.lines.length - 1));
      } else {
        const firstUndone = meta.lines.findIndex((l) => !takes[l.id]);
        selectLine(firstUndone >= 0 ? firstUndone : 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        e.preventDefault();
        if (engine.phase === "rec") void engine.stopRec();
        else if (engine.phase === "idle" || engine.phase === "done") void startRec();
      }
      if (e.key === " " && (engine.phase === "idle" || engine.phase === "done")) {
        e.preventDefault();
        if (takes[line?.id ?? ""]) playTake();
        else playOrig();
      }
      if (e.key === "ArrowRight" && canDrive && (engine.phase === "done" || engine.phase === "idle")) advance();
      if (e.key === "ArrowLeft" && !coopView && (engine.phase === "done" || engine.phase === "idle") && cur > 0) {
        selectLine(cur - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startRec, advance, playOrig, playTake, takes, line, cur, selectLine, coopView, canDrive]);

  if (fatal) {
    return (
      <CenterNote>
        <div style={{ fontSize: 18, fontWeight: 500 }}>Не получилось</div>
        <div style={{ color: "var(--text-mute)", fontSize: 14, maxWidth: 480, textAlign: "center" }}>{fatal}</div>
        <button className="btn" onClick={props.onBack}>← Библиотека</button>
      </CenterNote>
    );
  }
  if (!meta || !line) {
    return (
      <CenterNote>
        <div className="mono pulse" style={{ color: "var(--text-dim)", fontSize: 13 }}>открываю пак…</div>
      </CenterNote>
    );
  }

  const doneCount = meta.lines.filter((l) => takes[l.id]).length;
  const curTake = takes[line.id];
  const hasTake = !!curTake;
  const recElapsed = phase === "rec" && playhead !== null ? Math.max(0, playhead * win.dur + win.from - line.start) : 0;

  const centerBig =
    phase === "orig" ? "▶" : phase === "lead" ? String(leadCount) : phase === "rec" ? "●" : phase === "idle" && !locked ? "R" : "";
  const centerHint = paused
    ? `Пауза — ждём ${pausedName}`
    : locked
      ? `Пишет ${ownerName || "другой участник"}`
      : phase === "orig"
        ? "Играет оригинал"
        : phase === "lead"
          ? "Отсчёт до начала реплики"
          : phase === "rec"
            ? `Идёт запись · ${recElapsed.toFixed(1)} с`
            : phase === "take"
              ? "Играет дубль"
              : phase === "done"
                ? "Дубль записан · пробел — прослушать, R — переписать"
                : "R — записать дубль · пробел — прослушать";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel-bg)" }}>
      {/* верхняя панель */}
      <div
        style={{
          flex: "none",
          height: 52,
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 22px"
        }}
      >
        <div className="mono" style={{ flex: "none", fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }} onClick={props.onBack}>
          ← Библиотека
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
          {meta.lines.map((l, i) => (
            <div
              key={l.id}
              title={`${l.who}: ${displayText(l, translation, showTranslation)}`}
              onClick={() => selectLine(i)}
              style={{
                flex: "1 1 6px",
                cursor: coopView ? "default" : "pointer",
                height: 6,
                borderRadius: 99,
                background: i === cur ? "var(--red)" : takes[l.id] ? "var(--green)" : "#2c3136",
                transition: "background .2s"
              }}
            />
          ))}
        </div>
        <TranslateControl
          busy={translating}
          error={translateError}
          hasKey={settings.deeplKey.trim().length > 0}
          ready={meta ? pendingLines(meta, translation).length === 0 : false}
          on={showTranslation}
          onToggle={toggleTranslation}
          onTranslate={translatePack}
        />
        {!coopView && <label
          className="mono"
          title="после дубля сразу переходить к следующей реплике"
          style={{ flex: "none", fontSize: 11, color: autoNext ? "var(--amber)" : "var(--text-faint)", display: "flex", gap: 7, alignItems: "center", cursor: "pointer", userSelect: "none" }}
        >
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => {
              setAutoNext(e.target.checked);
              localStorage.setItem("dubl.autonext", e.target.checked ? "1" : "0");
            }}
          />
          Автопереход
        </label>}
        {coopView && (
          <div className="mono" style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ color: "var(--text-faint)" }}>комната</span>
            <span style={{ color: "var(--amber)", letterSpacing: "0.2em" }}>{coopView.code}</span>
            <span style={{ color: "var(--text-faint)" }}>
              {coopView.state.participants.filter((p) => p.connected).length} в эфире
            </span>
          </div>
        )}
        <div className="label" style={{ flex: "none", whiteSpace: "nowrap" }}>
          {doneCount}/{meta.lines.length}
        </div>
        <button className="btn" style={{ flex: "none", padding: "6px 14px", fontSize: 13 }} onClick={() => props.onResults(props.slug, props.dubId)}>
          Итоги
        </button>
        <SettingsIcon onClick={props.onSettings} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* основная колонка */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* видео */}
          <div style={{ flex: 1, minHeight: 240, overflow: "hidden", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <div style={{ aspectRatio: "16 / 9", height: "100%", maxWidth: "100%", position: "relative", overflow: "hidden", borderRadius: 6, background: "#141719" }}>
              <video
                ref={videoRef}
                src={assetUrl(props.slug, meta.video)}
                muted
                playsInline
                preload="auto"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
              />
              <audio ref={audioRef} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#0a0c0d80 0%,#0a0c0d1f 40%,#0a0c0dd9 100%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "clamp(14px,3.5vh,40px) 28px clamp(10px,2.2vh,24px)", pointerEvents: "none" }}>
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10, alignItems: "center", justifyContent: "center" }}>
                  {centerBig && (
                    <div
                      className="mono"
                      style={{
                        fontSize: "clamp(38px,7.5vh,88px)",
                        lineHeight: 1,
                        color: phase === "rec" ? "var(--red-bright)" : "var(--text)",
                        textShadow: "0 4px 40px #0a0c0d"
                      }}
                    >
                      {centerBig}
                    </div>
                  )}
                  <div className="mono" style={{ fontSize: 12, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text)", background: "#0a0c0dbf", borderRadius: 99, padding: "5px 12px" }}>
                    {centerHint}
                  </div>
                </div>
                <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                  <div className="mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: line.color }}>
                    {line.who.toUpperCase()} · {cur + 1}/{meta.lines.length}
                  </div>
                  <div
                    onClick={hasTranslation ? toggleTranslation : undefined}
                    title={hasTranslation ? "нажмите, чтобы переключить оригинал и перевод" : undefined}
                    style={{
                      maxWidth: 720,
                      textAlign: "center",
                      fontSize: "clamp(17px,2.4vh,28px)",
                      fontWeight: 500,
                      lineHeight: 1.25,
                      textShadow: "0 2px 18px #0a0c0d",
                      cursor: hasTranslation ? "pointer" : "default"
                    }}
                  >
                    {displayText(line, translation, showTranslation) || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* волна и управление */}
          <div style={{ flex: "none", borderTop: "1px solid var(--line)", padding: "14px 28px 18px", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div className="card" style={{ width: "100%", maxWidth: 1180, height: "clamp(92px,14vh,132px)", position: "relative", overflow: "hidden", borderRadius: 12 }}>
              <div style={{ position: "absolute", left: `${win.lineFrom * 100}%`, width: `${(win.lineTo - win.lineFrom) * 100}%`, top: 0, bottom: 0, background: "var(--green)", opacity: 0.06 }} />
              <div style={{ position: "absolute", left: `${win.lineFrom * 100}%`, top: 0, bottom: 0, width: 1, background: "var(--green)" }} />
              <div style={{ position: "absolute", left: `${win.lineTo * 100}%`, top: 0, bottom: 0, width: 1, background: "var(--green)" }} />
              <div className="mono" style={{ position: "absolute", right: 12, top: 6, fontSize: 10, color: "var(--green)", whiteSpace: "nowrap" }}>
                {formatStamp(line.start)} — {formatStamp(line.end)}
              </div>
              <div style={{ position: "absolute", left: 16, right: 16, top: "16%", bottom: "22%" }}>
                <WaveCanvas
                  orig={origBins}
                  recRef={recBinsRef}
                  recVersion={recVersion}
                  live={phase === "rec"}
                  recColor={phase === "rec" ? "oklch(0.70 0.21 25)" : line.color}
                  lineFrom={win.lineFrom}
                  lineTo={win.lineTo}
                  getLivePlayhead={() => engineRef.current?.livePlayhead() ?? null}
                />
              </div>
              <div className="mono" style={{ position: "absolute", left: 16, bottom: 7, display: "flex", gap: 14, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <span style={{ color: "#8b9298" }}>─ оригинал</span>
                <span style={{ color: phase === "rec" ? "var(--red-bright)" : hasTake ? line.color : "#4a5158" }}>
                  ─ {phase === "rec" ? "запись" : hasTake ? (coopView && !mine ? `дубль · ${ownerName}` : "ваш дубль") : "дубль не записан"}
                </span>
              </div>
              {playhead !== null && phase !== "rec" && (
                <div style={{ position: "absolute", left: `${playhead * 100}%`, top: 0, bottom: 0, width: 2, background: "#e9ebed" }} />
              )}
            </div>

            {/* кнопки */}
            <div style={{ width: "100%", maxWidth: 560, display: "grid", gridTemplateColumns: "1fr 52px 1fr", alignItems: "center", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                {(phase === "done" || (phase === "idle" && hasTake)) && (
                  <RoundBtn title="Прослушать дубль (пробел)" onClick={playTake} border>
                    <div style={{ width: 0, height: 0, borderLeft: "14px solid #e9ebed", borderTop: "8px solid transparent", borderBottom: "8px solid transparent", marginLeft: 3 }} />
                  </RoundBtn>
                )}
                {phase === "orig" && (
                  <RoundBtn title="Пропустить оригинал" onClick={() => engineRef.current?.showFrame()} border>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <div style={{ width: 0, height: 0, borderLeft: "9px solid #cfd4d8", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />
                      <div style={{ width: 2, height: 12, background: "#cfd4d8" }} />
                    </div>
                  </RoundBtn>
                )}
              </div>

              {phase === "rec" ? (
                <RoundBtn title="Остановить запись (R)" onClick={() => void engineRef.current?.stopRec()} bg="var(--red)">
                  <div style={{ width: 15, height: 15, background: "var(--ink)", borderRadius: 2 }} />
                </RoundBtn>
              ) : phase === "lead" ? (
                <RoundBtn title="Отсчёт" bg="var(--red)">
                  <div className="mono pulse" style={{ color: "var(--ink)", fontSize: 20, fontWeight: 700 }}>{leadCount}</div>
                </RoundBtn>
              ) : (
                <RoundBtn
                  title={locked ? "Сейчас пишет другой участник" : "Записать дубль (R)"}
                  onClick={() => void startRec()}
                  bg="var(--red)"
                  disabled={locked || phase === "orig" || phase === "take"}
                >
                  <div style={{ width: 16, height: 16, borderRadius: 99, background: "var(--ink)" }} />
                </RoundBtn>
              )}

              <div style={{ display: "flex", justifyContent: "flex-start", gap: 10 }}>
                {(phase === "done" || phase === "idle") && (
                  <>
                    <RoundBtn title="Переслушать оригинал" onClick={() => playOrig()} border>
                      <Replay />
                    </RoundBtn>
                    {canDrive && (
                      <RoundBtn
                        title={cur < meta.lines.length - 1 ? "Следующая реплика (→)" : "К итогам"}
                        onClick={advance}
                        bg="var(--amber)"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <Tri /> <Tri />
                        </div>
                      </RoundBtn>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* сайдбар */}
        <div style={{ flex: "0 0 300px", minWidth: 240, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {coopView && (
            <div style={{ flex: "none", padding: "14px 16px 0" }}>
              <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {paused ? `пауза — ждём ${pausedName}` : mine ? "ваша реплика" : `реплику пишет ${ownerName}`}
                </div>
                {paused && isHost && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "6px 10px" }}
                      onClick={() => {
                        const gone = coopView.state.pausedFor;
                        Object.entries(coopView.state.roles)
                          .filter(([, ownerId]) => ownerId === gone)
                          .forEach(([character]) =>
                            coop?.command({ type: "reassign", character, toParticipantId: coopView.selfId })
                          );
                        coop?.command({ type: "resume" });
                      }}
                    >
                      Взять его роли себе
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "6px 10px" }}
                      onClick={() => coop?.command({ type: "resume" })}
                    >
                      Продолжить без него
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {coopView.state.participants.map((p) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 99,
                          flex: "none",
                          background: p.connected ? (p.id === owner ? "var(--red)" : "var(--green)") : "var(--red)"
                        }}
                      />
                      <div className="mono" style={{ fontSize: 11.5, color: p.id === owner ? "var(--text)" : "var(--text-mute)" }}>
                        {p.name}
                      </div>
                      {!p.connected && (
                        <div className="mono" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)" }}>нет связи</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div style={{ flex: "none", padding: "14px 16px 10px" }}>
            <div className="label">Разбор дубля</div>
          </div>
          <div style={{ flex: "none", padding: "0 16px 14px" }}>
            {curTake?.analysis ? (
              <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="mono" style={{ fontSize: 30, lineHeight: 1, color: verdictColor(curTake.analysis.verdict) }}>
                    {curTake.analysis.score}
                  </div>
                  <span className="mono" style={{ fontSize: 11, border: `1px solid ${verdictColor(curTake.analysis.verdict)}`, color: verdictColor(curTake.analysis.verdict), borderRadius: 99, padding: "3px 9px" }}>
                    {verdictLabel(curTake.analysis.verdict)}
                  </span>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>
                    дубль {curTake.takeCount ?? 1}
                  </div>
                </div>
                <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
                  <SideRow k="старт" v={`+${curTake.analysis.startOffset.toFixed(2)} с`} good={curTake.analysis.startOffset <= 0.25} />
                  <SideRow k="речь" v={`${curTake.analysis.speechDur.toFixed(2)} с из ${(line.end - line.start).toFixed(2)} с`} good />
                  <SideRow k="заполнение реплики" v={`${Math.round(curTake.analysis.fill * 100)}%`} good={curTake.analysis.fill >= 0.55} />
                  <SideRow k="сверх реплики" v={curTake.analysis.overrun > 0 ? `${curTake.analysis.overrun.toFixed(2)} с` : "нет"} good={curTake.analysis.overrun <= 0.25} />
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 14 }}>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
                  Запишите дубль — появится разбор: точность старта, заполнение реплики и выход за её край
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: "none", padding: "0 16px 8px" }}>
            <div className="label">Реплики</div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 12px" }}>
            {meta.lines.map((l, i) => {
              const t = takes[l.id];
              const active = i === cur;
              return (
                <div
                  key={l.id}
                  onClick={() => selectLine(i)}
                  className="row-hover"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: active ? "#22272b" : "transparent"
                  }}
                >
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)", width: 18, flex: "none" }}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: l.color }} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: active ? "var(--text)" : "var(--text-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.text || l.who}
                  </div>
                  <div className="mono" style={{ flex: "none", fontSize: 10.5, color: t?.analysis ? verdictColor(t.analysis.verdict) : "var(--text-faint)" }}>
                    {t?.analysis ? t.analysis.score : t ? "✓" : "·"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SideRow({ k, v, good }: { k: string; v: string; good: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-dim)" }}>{k}</span>
      <span style={{ color: good ? "var(--text-soft)" : "var(--amber)" }}>{v}</span>
    </div>
  );
}

function RoundBtn(props: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  bg?: string;
  border?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      title={props.title}
      onClick={props.disabled ? undefined : props.onClick}
      className="round-btn"
      style={{
        width: 52,
        height: 52,
        borderRadius: 99,
        background: props.bg ?? "transparent",
        border: props.border ? "1px solid #3a4045" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: props.disabled ? "default" : "pointer",
        opacity: props.disabled ? 0.4 : 1,
        flex: "none"
      }}
    >
      {props.children}
    </div>
  );
}

function TranslateControl(props: {
  busy: boolean;
  error: string | null;
  hasKey: boolean;
  ready: boolean;
  on: boolean;
  onToggle: () => void;
  onTranslate: () => void;
}) {
  if (props.busy) {
    return (
      <div className="mono pulse" style={{ flex: "none", fontSize: 11, color: "var(--amber)" }}>
        Перевод…
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="mono" title={props.error} style={{ flex: "none", fontSize: 11, color: "var(--red)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {props.error}
      </div>
    );
  }
  if (props.ready) {
    return (
      <div
        className="mono"
        onClick={props.onToggle}
        title="показывать оригинал или перевод"
        style={{ flex: "none", fontSize: 11, color: props.on ? "var(--amber)" : "var(--text-faint)", cursor: "pointer", border: "1px solid var(--line)", borderRadius: 99, padding: "5px 11px" }}
      >
        {props.on ? "перевод" : "оригинал"}
      </div>
    );
  }
  return (
    <div
      className="mono"
      onClick={props.hasKey ? props.onTranslate : undefined}
      title={props.hasKey ? "перевести реплики через DeepL" : "добавьте ключ DeepL в настройках"}
      style={{ flex: "none", fontSize: 11, color: props.hasKey ? "var(--text-faint)" : "#4a5158", cursor: props.hasKey ? "pointer" : "default", border: "1px solid var(--line)", borderRadius: 99, padding: "5px 11px" }}
    >
      Перевести
    </div>
  );
}

function Replay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cfd4d8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4.5V10h5.5" />
    </svg>
  );
}

function Tri() {
  return <div style={{ width: 0, height: 0, borderLeft: "9px solid var(--ink)", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />;
}

export function SettingsIcon({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Настройки"
      className="round-btn"
      style={{
        flex: "none",
        width: 32,
        height: 32,
        border: "1px solid var(--border)",
        borderRadius: 9,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        cursor: "pointer"
      }}
    >
      <div style={{ width: 16, height: 1, background: "var(--text-dim)", position: "relative" }}>
        <div style={{ position: "absolute", left: 4, top: -2, width: 5, height: 5, borderRadius: 99, background: "var(--text-dim)" }} />
      </div>
      <div style={{ width: 16, height: 1, background: "var(--text-dim)", position: "relative" }}>
        <div style={{ position: "absolute", left: 9, top: -2, width: 5, height: 5, borderRadius: 99, background: "var(--text-dim)" }} />
      </div>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", background: "var(--panel-bg)" }}>
      {children}
    </div>
  );
}

let beeperCtx: AudioContext | null = null;

function beep(freq: number): void {
  const ctx = (beeperCtx ??= new AudioContext());
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.13);
}

function formatStamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
