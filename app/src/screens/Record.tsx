import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, assetUrl, loadPackMeta, loadTakes, saveTakes } from "../api";
import { Recorder } from "../audio/recorder";
import { decodeUrl } from "../audio/peaks";
import { accumulate, binsFromSamples, emptyBins, type WaveBins } from "../audio/bins";
import { encodeWav16 } from "../audio/wav";
import { analyzeTake, verdictColor } from "../audio/score";
import WaveCanvas from "../components/WaveCanvas";
import { loadSettings } from "../settings";
import type { PackLine, PackMeta, TakesMap } from "../types";

const BARS = 220;

type Phase = "orig" | "idle" | "lead" | "rec" | "done" | "take";

export default function Record(props: {
  slug: string;
  startLine?: number;
  settingsVersion: number;
  onBack: () => void;
  onSettings: () => void;
  onResults: (slug: string) => void;
}) {
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [takes, setTakes] = useState<TakesMap>({});
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [leadCount, setLeadCount] = useState(3);
  const [origBins, setOrigBins] = useState<WaveBins | null>(null);
  const recBinsRef = useRef<WaveBins | null>(null);
  const [recVersion, setRecVersion] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem("dubl.autonext") === "1");
  const [fatal, setFatal] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const recClockRef = useRef({ samples: 0, rate: 48000 });
  const recActiveRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const bufferCache = useRef<Map<string, AudioBuffer>>(new Map());
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const line: PackLine | null = meta?.lines[cur] ?? null;

  const settings = useMemo(() => loadSettings(), [props.settingsVersion]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // настройки микрофона поменялись — пересоздаём рекордер при следующей записи
  useEffect(() => {
    recorderRef.current?.destroy();
    recorderRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settingsVersion]);

  const win = useMemo(() => {
    if (!line) return { from: 0, to: 1, dur: 1, lineFrom: 0, lineTo: 1 };
    const dur = line.end - line.start;
    // слева — весь разбег: каретка въезжает по пустой дорожке и на границе начинается запись
    const from = Math.max(0, line.start - settings.lead - 0.2);
    const to = line.end + Math.max(0.4, dur * 0.15);
    return {
      from,
      to,
      dur: to - from,
      lineFrom: (line.start - from) / (to - from),
      lineTo: (line.end - from) / (to - from)
    };
  }, [line, settings]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    cancelAnimationFrame(rafRef.current);
  }, []);

  const stopMedia = useCallback(() => {
    clearTimers();
    const v = videoRef.current;
    const a = audioRef.current;
    if (v) v.pause();
    if (a) {
      a.pause();
      a.onended = null;
    }
    setPlayhead(null);
  }, [clearTimers]);

  useEffect(() => {
    (async () => {
      const m = await loadPackMeta(props.slug);
      setMeta(m);
      setTakes(await loadTakes(props.slug));
    })().catch((e) => setFatal(String(e)));
    return () => {
      stopMedia();
      recorderRef.current?.destroy();
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.slug]);

  // волны оригинала и записанного дубля при смене реплики
  useEffect(() => {
    if (!line) return;
    let alive = true;
    setOrigBins(null);
    recBinsRef.current = null;
    setRecVersion((v) => v + 1);
    (async () => {
      const key = line.id;
      let buf = bufferCache.current.get(key);
      if (!buf) {
        buf = await decodeUrl(assetUrl(props.slug, line.orig));
        bufferCache.current.set(key, buf);
      }
      if (!alive || !buf) return;
      setOrigBins(binsFromSamples(buf.getChannelData(0), buf.sampleRate, line.start, win.from, win.dur, BARS));
      const existing = takes[line.id];
      if (existing) {
        try {
          const takeBuf = await decodeUrl(assetUrl(props.slug, existing.file) + `?v=${existing.recordedAt}`);
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

  const trackPlayhead = useCallback(() => {
    const step = () => {
      const v = videoRef.current;
      if (v && line) {
        let t: number;
        if (recActiveRef.current) {
          // во время записи истина — часы записи: каретка и глифы от одного источника
          const rc = recClockRef.current;
          t = line.start + rc.samples / rc.rate;
          // а видео подтягиваем к ним незаметной правкой скорости
          const drift = v.currentTime - t;
          if (Math.abs(drift) > 0.25) {
            v.currentTime = t;
            v.playbackRate = 1;
          } else if (Math.abs(drift) > 0.03) {
            v.playbackRate = Math.min(1.1, Math.max(0.9, 1 - drift * 0.8));
          } else if (v.playbackRate !== 1) {
            v.playbackRate = 1;
          }
        } else {
          if (v.playbackRate !== 1) v.playbackRate = 1;
          t = v.currentTime;
        }
        setPlayhead(Math.min(1, Math.max(0, (t - win.from) / win.dur)));
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [line, win]);

  // ручное переключение реплики: только показать её кадр, ничего не проигрывать
  const selectLine = useCallback(
    (idx: number) => {
      if (!meta) return;
      stopMedia();
      const l = meta.lines[idx];
      setCur(idx);
      setPhase("idle");
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = l.start;
      }
    },
    [meta, stopMedia]
  );

  const playOrig = useCallback(
    (idx?: number) => {
      if (!meta) return;
      stopMedia();
      const i = idx ?? cur;
      const l = meta.lines[i];
      if (idx !== undefined) setCur(idx);
      setPhase("orig");
      const v = videoRef.current!;
      const a = audioRef.current!;
      v.muted = true;
      v.currentTime = l.start;
      a.src = assetUrl(props.slug, l.orig);
      a.currentTime = 0;
      v.play().catch(() => {});
      a.play().catch(() => {
        // автоплей со звуком запрещён до первого клика — просто ждём действий
        v.pause();
        if (phaseRef.current === "orig") setPhase("idle");
      });
      a.onended = () => {
        v.pause();
        if (phaseRef.current === "orig") setPhase("idle");
      };
      trackPlayhead();
    },
    [meta, cur, props.slug, stopMedia, trackPlayhead]
  );

  const startRec = useCallback(async () => {
    if (!line) return;
    const s = settingsRef.current;
    stopMedia();
    try {
      if (!recorderRef.current) recorderRef.current = new Recorder();
      await recorderRef.current.init({ deviceId: s.micId, dsp: s.dsp, gain: s.gain });
    } catch (e) {
      setFatal(`Микрофон недоступен: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setPhase("lead");
    // разбег: каретка едет по пустой дорожке под видео, запись включится на границе реплики
    const v = videoRef.current!;
    v.muted = true;
    v.currentTime = Math.max(0, line.start - s.lead);
    v.play().catch(() => {});
    trackPlayhead();
    const beep = s.ticks ? makeBeeper() : null;
    const tick = s.lead / 3;
    for (let i = 0; i < 3; i++) {
      timersRef.current.push(
        window.setTimeout(() => {
          setLeadCount(3 - i);
          beep?.(i === 2 ? 880 : 660);
        }, i * tick * 1000)
      );
    }

    const rec = recorderRef.current!;
    const bins = emptyBins(BARS);
    recBinsRef.current = bins;
    const l = line;
    const w = win;
    rec.onChunk = (chunk, startSample) => {
      recClockRef.current.samples = startSample + chunk.length;
      recClockRef.current.rate = rec.sampleRate;
      accumulate(bins, chunk, startSample, rec.sampleRate, l.start, w.from, w.dur);
    };
    let began = false;
    const begin = async () => {
      if (began) return;
      began = true;
      recClockRef.current = { samples: 0, rate: rec.sampleRate };
      await rec.start();
      recActiveRef.current = true;
      setPhase("rec");
      // жёсткий стоп ровно на конце окна фразы
      timersRef.current.push(window.setTimeout(() => stopRecRef.current(), (l.end - l.start) * 1000));
    };
    // запись стартует, когда каретка видео пересекает начало реплики
    const watcher = window.setInterval(() => {
      const vv = videoRef.current;
      if (!vv) return;
      if (vv.currentTime >= l.start - 0.005) {
        window.clearInterval(watcher);
        void begin();
      }
    }, 8);
    timersRef.current.push(watcher);
    // страховка, если видео так и не докатилось
    timersRef.current.push(
      window.setTimeout(() => {
        window.clearInterval(watcher);
        void begin();
      }, s.lead * 1000 + 1500)
    );
  }, [line, stopMedia, trackPlayhead, win]);

  const stopRec = useCallback(async () => {
    if (phaseRef.current !== "rec" || !line) return;
    recActiveRef.current = false;
    setPhase("done");
    stopMedia();
    const rec = recorderRef.current!;
    rec.onChunk = null;
    const result = rec.stop();
    // жёсткая обрезка: дубль не может быть длиннее окна фразы
    const maxSamples = Math.round((line.end - line.start) * result.sampleRate);
    const samples = result.samples.length > maxSamples ? result.samples.subarray(0, maxSamples) : result.samples;
    const wav = samples === result.samples ? result.wav : encodeWav16([samples], result.sampleRate);
    const analysis = analyzeTake(samples, result.sampleRate, line);
    const rel = `takes/${line.id}.wav`;
    const prev = takes[line.id];
    try {
      await api.writeBinary(props.slug, rel, wav);
      const newTakes: TakesMap = {
        ...takes,
        [line.id]: {
          file: rel,
          duration: samples.length / result.sampleRate,
          recordedAt: Date.now(),
          takeCount: (prev?.takeCount ?? (prev ? 1 : 0)) + 1,
          analysis
        }
      };
      setTakes(newTakes);
      await saveTakes(props.slug, newTakes);
    } catch (e) {
      setFatal(`Не смог сохранить дубль: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    recBinsRef.current = binsFromSamples(samples, result.sampleRate, line.start, win.from, win.dur, BARS);
    setRecVersion((v) => v + 1);
    if (autoNext && analysis.verdict !== "тишина") {
      timersRef.current.push(
        window.setTimeout(() => {
          if (phaseRef.current === "done") nextRef.current();
        }, 900)
      );
    }
  }, [line, props.slug, stopMedia, takes, win, autoNext]);
  const stopRecRef = useRef(stopRec);
  stopRecRef.current = stopRec;

  const playTake = useCallback(() => {
    if (!line) return;
    const take = takes[line.id];
    if (!take) return;
    stopMedia();
    setPhase("take");
    const v = videoRef.current!;
    const a = audioRef.current!;
    v.muted = true;
    v.currentTime = line.start;
    a.src = assetUrl(props.slug, take.file) + `?v=${take.recordedAt}`;
    a.currentTime = 0;
    Promise.all([v.play(), a.play()]).catch(() => {});
    a.onended = () => {
      v.pause();
      if (phaseRef.current === "take") setPhase("done");
    };
    trackPlayhead();
  }, [line, takes, props.slug, stopMedia, trackPlayhead]);

  const next = useCallback(() => {
    if (!meta) return;
    if (cur < meta.lines.length - 1) selectLine(cur + 1);
    else props.onResults(props.slug);
  }, [meta, cur, selectLine, props]);
  const nextRef = useRef(next);
  nextRef.current = next;

  // старт: либо реплика из итогов, либо первая неозвученная
  const bootRef = useRef(false);
  useEffect(() => {
    if (meta && !bootRef.current) {
      bootRef.current = true;
      if (props.startLine !== undefined) {
        selectLine(Math.min(props.startLine, meta.lines.length - 1));
      } else {
        const firstUndone = meta.lines.findIndex((l) => !takes[l.id]);
        selectLine(firstUndone >= 0 ? firstUndone : 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        e.preventDefault();
        if (phaseRef.current === "rec") stopRecRef.current();
        else if (phaseRef.current === "idle" || phaseRef.current === "done") startRec();
      }
      if (e.key === " " && (phaseRef.current === "idle" || phaseRef.current === "done")) {
        e.preventDefault();
        if (takes[line?.id ?? ""]) playTake();
        else playOrig();
      }
      if (e.key === "ArrowRight" && (phaseRef.current === "done" || phaseRef.current === "idle")) next();
      if (e.key === "ArrowLeft" && (phaseRef.current === "done" || phaseRef.current === "idle") && cur > 0) selectLine(cur - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startRec, next, playOrig, playTake, takes, line, cur]);

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
    phase === "orig" ? "▶" : phase === "lead" ? String(leadCount) : phase === "rec" ? "●" : phase === "idle" ? "R" : "";
  const centerHint =
    phase === "orig"
      ? "слушайте оригинал"
      : phase === "lead"
        ? "разбег — реплика вот-вот"
        : phase === "rec"
          ? `говорите · ${recElapsed.toFixed(1)} с`
          : phase === "take"
            ? "играет ваш дубль"
            : phase === "done"
              ? "записан — прослушайте, перепишите или дальше"
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
              title={`${l.who}: ${l.text}`}
              onClick={() => selectLine(i)}
              style={{
                flex: "1 1 6px",
                height: 6,
                borderRadius: 99,
                cursor: "pointer",
                background: i === cur ? "var(--red)" : takes[l.id] ? "var(--green)" : "#2c3136",
                transition: "background .2s"
              }}
            />
          ))}
        </div>
        <label
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
          сам дальше
        </label>
        <div className="label" style={{ flex: "none", whiteSpace: "nowrap" }}>
          {doneCount}/{meta.lines.length}
        </div>
        <button className="btn" style={{ flex: "none", padding: "6px 14px", fontSize: 13 }} onClick={() => props.onResults(props.slug)}>
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
                  <div style={{ maxWidth: 720, textAlign: "center", fontSize: "clamp(17px,2.4vh,28px)", fontWeight: 500, lineHeight: 1.25, textShadow: "0 2px 18px #0a0c0d" }}>
                    {line.text || "—"}
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
                  getLivePlayhead={() => {
                    if (!recActiveRef.current) return null;
                    const rc = recClockRef.current;
                    return (line.start + rc.samples / rc.rate - win.from) / win.dur;
                  }}
                />
              </div>
              <div className="mono" style={{ position: "absolute", left: 16, bottom: 7, display: "flex", gap: 14, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <span style={{ color: "#8b9298" }}>─ оригинал</span>
                <span style={{ color: phase === "rec" ? "var(--red-bright)" : hasTake ? line.color : "#4a5158" }}>
                  ─ {phase === "rec" ? "идёт запись" : hasTake ? "мой дубль" : "дубля ещё нет"}
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
                  <RoundBtn title="прослушать дубль (пробел)" onClick={playTake} border>
                    <div style={{ width: 0, height: 0, borderLeft: "14px solid #e9ebed", borderTop: "8px solid transparent", borderBottom: "8px solid transparent", marginLeft: 3 }} />
                  </RoundBtn>
                )}
                {phase === "orig" && (
                  <RoundBtn title="пропустить оригинал" onClick={() => { stopMedia(); setPhase("idle"); }} border>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <div style={{ width: 0, height: 0, borderLeft: "9px solid #cfd4d8", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />
                      <div style={{ width: 2, height: 12, background: "#cfd4d8" }} />
                    </div>
                  </RoundBtn>
                )}
              </div>

              {phase === "rec" ? (
                <RoundBtn title="стоп (R)" onClick={() => stopRecRef.current()} bg="var(--red)">
                  <div style={{ width: 15, height: 15, background: "var(--ink)", borderRadius: 2 }} />
                </RoundBtn>
              ) : phase === "lead" ? (
                <RoundBtn title="разбег" bg="var(--red)">
                  <div className="mono pulse" style={{ color: "var(--ink)", fontSize: 20, fontWeight: 700 }}>{leadCount}</div>
                </RoundBtn>
              ) : (
                <RoundBtn title="записать дубль (R)" onClick={startRec} bg="var(--red)" disabled={phase === "orig" || phase === "take"}>
                  <div style={{ width: 16, height: 16, borderRadius: 99, background: "var(--ink)" }} />
                </RoundBtn>
              )}

              <div style={{ display: "flex", justifyContent: "flex-start", gap: 10 }}>
                {(phase === "done" || phase === "idle") && (
                  <>
                    <RoundBtn title="переслушать оригинал" onClick={() => playOrig()} border>
                      <div className="mono" style={{ fontSize: 11, color: "#cfd4d8" }}>ор</div>
                    </RoundBtn>
                    <RoundBtn title={cur < meta.lines.length - 1 ? "следующая реплика (→)" : "к итогам"} onClick={next} bg="var(--amber)">
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <Tri /> <Tri />
                      </div>
                    </RoundBtn>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* сайдбар */}
        <div style={{ flex: "0 0 300px", minWidth: 240, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                    {curTake.analysis.verdict}
                  </span>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>
                    дубль {curTake.takeCount ?? 1}
                  </div>
                </div>
                <div className="mono" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
                  <SideRow k="начал" v={`+${curTake.analysis.startOffset.toFixed(2)} с`} good={curTake.analysis.startOffset <= 0.25} />
                  <SideRow k="речь" v={`${curTake.analysis.speechDur.toFixed(2)} с при ${(line.end - line.start).toFixed(2)}`} good />
                  <SideRow k="окно занято" v={`${Math.round(curTake.analysis.fill * 100)}%`} good={curTake.analysis.fill >= 0.55} />
                  <SideRow k="за окном" v={curTake.analysis.overrun > 0 ? `${curTake.analysis.overrun.toFixed(2)} с` : "нет"} good={curTake.analysis.overrun <= 0.25} />
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 14 }}>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
                  запишите дубль — здесь появится разбор: попадание в старт, заполнение окна и заезд за край
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

function Tri() {
  return <div style={{ width: 0, height: 0, borderLeft: "9px solid var(--ink)", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />;
}

export function SettingsIcon({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="настройки"
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

function makeBeeper() {
  const ctx = (beeperCtx ??= new AudioContext());
  return (freq: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  };
}

function formatStamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
