import { useCallback, useEffect, useRef, useState } from "react";
import { api, assetUrl, loadPackMeta, loadTranslation } from "../api";
import { dubRel, loadTakes } from "../dubs";
import { renderMix } from "../audio/mixer";
import { MixPlayer } from "../audio/mixplayer";
import { loadSettings, updateSettings } from "../settings";
import { isTauri } from "../mock";
import { dlog } from "../log";
import { displayText } from "../translate";
import type { PackMeta, TakesMap, TranslationMap } from "../types";

export default function Watch(props: {
  slug: string;
  dubId: string;
  onBack: () => void;
  onRecord: (slug: string, dubId: string) => void;
}) {
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [takes, setTakes] = useState<TakesMap>({});
  const [ready, setReady] = useState(false);
  const [building, setBuilding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [curLineId, setCurLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [translation, setTranslation] = useState<TranslationMap>({});
  const [showTranslation, setShowTranslation] = useState(() => loadSettings().showTranslation);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<MixPlayer | null>(null);
  const rafRef = useRef(0);
  const scrubbingRef = useRef(false);
  const metaRef = useRef<PackMeta | null>(null);
  const takesRef = useRef<TakesMap>({});
  metaRef.current = meta;
  takesRef.current = takes;

  // загрузка: мета, дубли, сведение (если устарело), декод дорожки
  useEffect(() => {
    let alive = true;
    const player = new MixPlayer();
    playerRef.current = player;
    player.onEnded = () => {
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.playbackRate = 1;
      setPlaying(false);
    };
    (async () => {
      dlog("watch: mount", props.slug);
      const m = await loadPackMeta(props.slug);
      const t = await loadTakes(props.slug, props.dubId);
      const tr = await loadTranslation(props.slug);
      if (!alive) return;
      setMeta(m);
      setTakes(t);
      setTranslation(tr);
      if (!isTauri) {
        setReady(true);
        return;
      }

      const backingGain = loadSettings().backingGain;
      const latestTake = Math.max(0, ...Object.values(t).map((x) => x.recordedAt));
      let createdAt = 0;
      let storedGain = -1;
      try {
        const mj = JSON.parse(await api.readText(props.slug, dubRel(props.dubId, "mix.json")));
        createdAt = mj.createdAt ?? 0;
        storedGain = mj.backingGain ?? -1;
      } catch {
        /* микса ещё нет */
      }
      let mixVersion = createdAt;
      if (!(createdAt >= latestTake && createdAt > 0 && storedGain === backingGain)) {
        dlog("watch: rebuilding mix");
        setBuilding(true);
        const takeList = m.lines
          .filter((l) => t[l.id])
          .map((l) => ({
            start: l.start,
            url: assetUrl(props.slug, dubRel(props.dubId, t[l.id].file)) + `?v=${t[l.id].recordedAt}`
          }));
        const wav = await renderMix({
          duration: m.videoDuration,
          backingUrl: m.backing ? assetUrl(props.slug, m.backing) : null,
          backingGain,
          takes: takeList
        });
        if (!alive) return;
        await api.writeBinary(props.slug, dubRel(props.dubId, "mix.wav"), wav);
        mixVersion = Date.now();
        await api.writeText(
          props.slug,
          dubRel(props.dubId, "mix.json"),
          JSON.stringify({ createdAt: mixVersion, backingGain })
        );
        setBuilding(false);
      }
      await player.load(assetUrl(props.slug, dubRel(props.dubId, "mix.wav")) + `?v=${mixVersion}`);
      if (!alive) return;
      dlog("watch: mix decoded,", player.duration.toFixed(2), "s");
      setReady(true);
    })().catch((e) => {
      if (!alive) return;
      setBuilding(false);
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
      dlog("watch error:", msg);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      player.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.slug, props.dubId]);

  // главный цикл: звук — мастер, видео и отрисовка подтягиваются
  useEffect(() => {
    const step = () => {
      rafRef.current = requestAnimationFrame(step);
      const player = playerRef.current;
      const v = videoRef.current;
      const m = metaRef.current;
      if (!player || !v || !m) return;
      const pos = player.pos();

      // конец видео = конец проигрывания: хвост дорожки не заставляет финал дёргаться
      if (player.isPlaying() && v.ended) {
        player.pause();
        v.playbackRate = 1;
        setPlaying(false);
      }

      const nearEnd = pos >= player.duration - 0.35 || v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.1);
      if (player.isPlaying() && !scrubbingRef.current && !nearEnd) {
        const drift = v.currentTime - pos;
        if (Math.abs(drift) > 0.5) {
          // крайний случай — одна жёсткая перемотка
          v.currentTime = pos;
          v.playbackRate = 1;
        } else if (Math.abs(drift) < 0.03) {
          // мёртвая зона: не дёргаем скорость попусту
          if (v.playbackRate !== 1) v.playbackRate = 1;
        } else {
          // немое видео: правка скорости незаметна, звук не трогаем вовсе
          v.playbackRate = Math.min(1.1, Math.max(0.9, 1 - drift * 0.8));
        }
        if (v.paused) v.play().catch(() => {});
      } else if (nearEnd && v.playbackRate !== 1) {
        v.playbackRate = 1;
      }

      if (timeRef.current) {
        timeRef.current.textContent = fmt(pos);
      }
      drawTimeline(timelineRef.current, m, takesRef.current, pos, m.videoDuration);

      const line = m.lines.find((l) => pos >= l.start && pos <= l.end);
      setCurLineId((prev) => (prev === (line?.id ?? null) ? prev : (line?.id ?? null)));
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    const v = videoRef.current;
    if (!player || !v || !ready) return;
    if (player.isPlaying()) {
      player.pause();
      v.pause();
      v.playbackRate = 1;
      v.currentTime = player.pos();
      setPlaying(false);
    } else {
      const from = player.pos() >= player.duration - 0.05 ? 0 : undefined;
      void player.play(from);
      v.currentTime = from ?? player.pos();
      v.play().catch(() => {});
      setPlaying(true);
    }
  }, [ready]);

  const seekTo = useCallback((t: number) => {
    const player = playerRef.current;
    const v = videoRef.current;
    if (!player || !v) return;
    player.seek(t);
    v.currentTime = Math.min(Math.max(0, t), v.duration || t);
  }, []);

  // скраббинг по таймлайну: клик и протяжка
  const onTimelinePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = timelineRef.current;
      const m = metaRef.current;
      if (!canvas || !m) return;
      const toTime = (clientX: number) => {
        const rect = canvas.getBoundingClientRect();
        return ((clientX - rect.left) / rect.width) * m.videoDuration;
      };
      if (e.type === "pointerdown") {
        scrubbingRef.current = true;
        canvas.setPointerCapture(e.pointerId);
        seekTo(toTime(e.clientX));
      } else if (e.type === "pointermove" && scrubbingRef.current) {
        seekTo(toTime(e.clientX));
      } else if (e.type === "pointerup" || e.type === "pointercancel") {
        scrubbingRef.current = false;
      }
    },
    [seekTo]
  );

  // клавиши: пробел — плей/пауза, стрелки — ±5 c
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const player = playerRef.current;
        if (player) seekTo(player.pos() + (e.key === "ArrowRight" ? 5 : -5));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekTo]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-mute)", fontSize: 14, maxWidth: 480, textAlign: "center", overflowWrap: "anywhere" }}>{error}</div>
        <button className="btn" onClick={props.onBack}>← Назад</button>
      </div>
    );
  }

  if (!meta || building || !ready) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
        <div className="mono pulse" style={{ color: "var(--text-dim)", fontSize: 13 }}>
          {building ? "Сведение дубляжа…" : "Подготовка дорожки…"}
        </div>
      </div>
    );
  }

  const curLine = curLineId ? meta.lines.find((l) => l.id === curLineId) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, background: "#000", display: "grid", placeItems: "center", overflow: "hidden", position: "relative" }}>
      <div
        style={{
          width: "100%",
          maxWidth: "calc(100vh * 16 / 9)",
          aspectRatio: "16 / 9",
          maxHeight: "100%",
          position: "relative",
          overflow: "hidden",
          background: "#141719"
        }}
      >
        <video
          ref={videoRef}
          src={assetUrl(props.slug, meta.video)}
          muted
          playsInline
          preload="auto"
          onClick={togglePlay}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
        />

        {/* верхняя панель */}
        <div
          style={{
            position: "absolute",
            zIndex: 2,
            left: 0,
            right: 0,
            top: 0,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            background: "linear-gradient(180deg,#0a0c0dcc 0%,#0a0c0d00 100%)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div
              onClick={props.onBack}
              title="Назад"
              style={{ flex: "none", width: 34, height: 34, borderRadius: 99, background: "#0a0c0d99", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <div style={{ width: 0, height: 0, borderRight: "8px solid #e9ebed", borderTop: "5px solid transparent", borderBottom: "5px solid transparent" }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 8px #0a0c0d" }}>
              {meta.title} · ваш дубляж
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flex: "none" }}>
            <button className="btn" style={{ background: "#0a0c0d99", borderColor: "transparent" }} onClick={() => props.onRecord(props.slug, props.dubId)}>
              Переозвучить
            </button>
            <button
              className="btn btn-primary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                setExportedPath(null);
                try {
                  const path = await api.exportVideo(props.slug, props.dubId, meta.title);
                  setExportedPath(path);
                } catch (e) {
                  setError(`Не удалось сохранить видео: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Сохранение видео…" : "Сохранить видео"}
            </button>
          </div>
        </div>

        <div style={{ position: "absolute", zIndex: 1, left: 0, right: 0, bottom: 0, height: "50%", background: "linear-gradient(180deg,#0a0c0d00 0%,#0a0c0dd9 72%,#0a0c0df2 100%)", pointerEvents: "none" }} />

        {exportedPath && (
          <div
            className="mono"
            style={{ position: "absolute", zIndex: 4, top: 64, right: 20, background: "#0d0f11f0", border: "1px solid var(--green)", color: "var(--text-soft)", borderRadius: 9, padding: "10px 14px", fontSize: 12, maxWidth: 420, cursor: "pointer" }}
            onClick={() => setExportedPath(null)}
          >
            <span style={{ color: "var(--green)" }}>Готово</span> · файл сохранён в папку «Загрузки»:
            <br />
            {exportedPath.split("/").pop()}
          </div>
        )}

        {/* субтитры */}
        {curLine && (
          <div style={{ position: "absolute", zIndex: 2, left: 0, right: 0, bottom: 104, display: "flex", justifyContent: "center", padding: "0 8%", pointerEvents: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: curLine.color, textShadow: "0 1px 8px #0a0c0d" }}>
                {curLine.who.toUpperCase()}
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (!translation[curLine.id]) return;
                  const next = !showTranslation;
                  setShowTranslation(next);
                  updateSettings({ showTranslation: next });
                }}
                title={translation[curLine.id] ? "нажмите, чтобы переключить оригинал и перевод" : undefined}
                style={{
                  textAlign: "center",
                  fontSize: "clamp(17px,2.6vh,28px)",
                  fontWeight: 500,
                  lineHeight: 1.3,
                  textShadow: "0 2px 18px #0a0c0d",
                  pointerEvents: translation[curLine.id] ? "auto" : "none",
                  cursor: translation[curLine.id] ? "pointer" : "default"
                }}
              >
                {displayText(curLine, translation, showTranslation)}
              </div>
            </div>
          </div>
        )}

        {/* таймлайн и управление */}
        <div style={{ position: "absolute", zIndex: 3, left: 0, right: 0, bottom: 0, padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <canvas
            ref={timelineRef}
            onPointerDown={onTimelinePointer}
            onPointerMove={onTimelinePointer}
            onPointerUp={onTimelinePointer}
            onPointerCancel={onTimelinePointer}
            style={{ width: "100%", height: 34, cursor: "pointer", touchAction: "none", display: "block" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              onClick={togglePlay}
              style={{ width: 44, height: 44, flex: "none", borderRadius: 99, background: "#e9ebed", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer" }}
            >
              {playing ? (
                <>
                  <div style={{ width: 4, height: 15, background: "var(--ink)", borderRadius: 1 }} />
                  <div style={{ width: 4, height: 15, background: "var(--ink)", borderRadius: 1 }} />
                </>
              ) : (
                <div style={{ width: 0, height: 0, borderLeft: "15px solid var(--ink)", borderTop: "9px solid transparent", borderBottom: "9px solid transparent", marginLeft: 4 }} />
              )}
            </div>
            <div className="mono" style={{ fontSize: 13, color: "#e9ebed" }}>
              <span ref={timeRef}>00:00.00</span> <span style={{ color: "var(--text-dim)" }}>/ {fmt(meta.videoDuration)}</span>
            </div>
            <div className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>
              пробел — пауза · ←/→ — ±5 с · клик по видео — воспроизведение
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawTimeline(canvas: HTMLCanvasElement | null, meta: PackMeta, takes: TakesMap, pos: number, duration: number): void {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const trackY = h / 2;
  const x = (t: number) => (t / duration) * w;

  // базовая дорожка
  ctx.fillStyle = "rgba(233,235,237,0.14)";
  roundRect(ctx, 0, trackY - 2, w, 4, 2);
  ctx.fill();

  // проигранное
  ctx.fillStyle = "rgba(233,235,237,0.38)";
  roundRect(ctx, 0, trackY - 2, Math.max(0, x(pos)), 4, 2);
  ctx.fill();

  // сегменты реплик
  for (const l of meta.lines) {
    const sx = x(l.start);
    const sw = Math.max(3, x(l.end) - sx);
    const recorded = !!takes[l.id];
    ctx.globalAlpha = recorded ? 0.95 : 0.3;
    ctx.fillStyle = l.color;
    roundRect(ctx, sx, trackY - 7, sw, 14, 3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // плейхед
  const px = x(pos);
  ctx.fillStyle = "#e9ebed";
  ctx.fillRect(px - 1, 2, 2, h - 4);
  ctx.beginPath();
  ctx.arc(px, trackY, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
