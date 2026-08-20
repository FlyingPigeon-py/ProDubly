import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../mock";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "../settings";

export default function SettingsModal(props: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(loadSettings);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ bytes: number; packs: number } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef(0);
  const rafRef = useRef(0);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // живой уровень микрофона выбранным устройством
  useEffect(() => {
    let alive = true;
    (async () => {
      setMicError(null);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const base: MediaTrackConstraints = {
        echoCancellation: s.dsp,
        noiseSuppression: s.dsp,
        autoGainControl: s.dsp
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: s.micId ? { ...base, deviceId: { exact: s.micId } } : base
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: base });
        } catch (e) {
          if (alive) setMicError(`нет доступа к микрофону: ${e instanceof Error ? e.message : e}`);
          return;
        }
      }
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const list = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Микрофон ${i + 1}` }));
      if (alive) setDevices(list);

      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      cancelAnimationFrame(rafRef.current);
      const step = () => {
        rafRef.current = requestAnimationFrame(step);
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length) * loadSettings().gain;
        peakRef.current = Math.max(rms, peakRef.current * 0.94);
        const el = meterRef.current;
        if (el) {
          const pct = Math.min(100, peakRef.current * 260);
          el.style.width = `${pct}%`;
          el.style.background = pct > 82 ? "var(--red)" : pct > 62 ? "var(--amber)" : "var(--green)";
        }
      };
      step();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.micId, s.dsp]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (isTauri) {
      invoke<{ bytes: number; packs: number }>("storage_info").then(setStorage).catch(() => {});
    }
  }, []);

  const gainDb = Math.round(20 * Math.log10(s.gain) * 10) / 10;

  return (
    <div className="overlay" onClick={props.onClose}>
      <div
        className="modal"
        style={{ width: 880, maxWidth: "calc(100vw - 48px)", padding: 0, gap: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ height: 60, flex: "none", borderBottom: "1px solid var(--card-border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 19, fontWeight: 500 }}>Настройки</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>запоминаются между запусками</div>
          </div>
          <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={props.onClose}>Готово</button>
        </div>

        <div style={{ overflowY: "auto", padding: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignContent: "start" }}>
          {/* микрофон */}
          <div className="card" style={{ background: "#191d20", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="label" style={{ color: "var(--text-dim)" }}>Микрофон</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="label">Устройство</div>
              <select
                className="search"
                value={s.micId ?? ""}
                onChange={(e) => update({ micId: e.target.value || null })}
                style={{ appearance: "none", cursor: "pointer" }}
              >
                <option value="">Системный по умолчанию</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              {micError && <div className="mono" style={{ fontSize: 11, color: "var(--red)" }}>{micError}</div>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="label">Усиление входа</div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text-soft)" }}>
                  {gainDb > 0 ? "+" : ""}{gainDb} дБ
                </div>
              </div>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={s.gain}
                onChange={(e) => update({ gain: Number(e.target.value) })}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                <div style={{ flex: 1, height: 12, background: "#101315", border: "1px solid var(--card-border)", borderRadius: 4, overflow: "hidden" }}>
                  <div ref={meterRef} style={{ width: "0%", height: "100%", background: "var(--green)", transition: "width .06s linear" }} />
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", flex: "none" }}>говорите — полоска живая</div>
              </div>
            </div>

            <ToggleRow
              title="Обработка браузера"
              hint="шумодав и автоуровень — включайте только в шумной комнате"
              on={s.dsp}
              onToggle={() => update({ dsp: !s.dsp })}
            />
          </div>

          {/* дубль */}
          <div className="card" style={{ background: "#191d20", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="label" style={{ color: "var(--text-dim)" }}>Дубль</div>

            <SliderRow
              label="Разбег перед репликой"
              value={`${s.lead.toFixed(1)} с`}
              min={0.7}
              max={5}
              step={0.1}
              num={s.lead}
              onChange={(v) => update({ lead: v })}
              hintLeft="0,7 — почти сразу"
              hintRight="5 с"
            />
            <SliderRow
              label="Фонограмма в сведении"
              value={`${Math.round(s.backingGain * 100)}%`}
              min={0}
              max={1}
              step={0.05}
              num={s.backingGain}
              onChange={(v) => update({ backingGain: v })}
              hintLeft="0 — только голос"
              hintRight="100%"
            />
            <ToggleRow
              title="Тики отсчёта"
              hint="щелчки на разбеге перед записью"
              on={s.ticks}
              onToggle={() => update({ ticks: !s.ticks })}
            />
          </div>

          {/* хранилище */}
          <div className="card" style={{ gridColumn: "1 / -1", background: "#191d20", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="label">Место на устройстве</div>
                <div style={{ fontSize: 14 }}>
                  {storage ? `${(storage.bytes / 1073741824).toFixed(2)} ГБ · ${storage.packs} ${plural(storage.packs, "пак", "пака", "паков")}` : "—"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="label">Доступ к микрофону</div>
                <div style={{ fontSize: 14, color: micError ? "var(--red)" : "var(--green)" }}>
                  {micError ? "нет доступа" : "разрешён"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {isTauri && (
                <button className="btn" style={{ fontSize: 13 }} onClick={() => invoke("reveal_packs").catch(() => {})}>
                  Показать папку паков
                </button>
              )}
              <button
                className="btn"
                style={{ fontSize: 13 }}
                onClick={() => {
                  saveSettings(DEFAULT_SETTINGS);
                  setS({ ...DEFAULT_SETTINGS });
                }}
              >
                Сбросить настройки
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow(props: { title: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{props.title}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{props.hint}</div>
      </div>
      <div
        onClick={props.onToggle}
        style={{
          width: 44,
          height: 24,
          borderRadius: 99,
          background: props.on ? "var(--amber)" : "var(--border)",
          position: "relative",
          flex: "none",
          cursor: "pointer",
          transition: "background .15s"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: props.on ? 23 : 3,
            top: 3,
            width: 18,
            height: 18,
            borderRadius: 99,
            background: props.on ? "var(--ink)" : "var(--text-dim)",
            transition: "left .15s"
          }}
        />
      </div>
    </div>
  );
}

function SliderRow(props: {
  label: string;
  value: string;
  num: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hintLeft: string;
  hintRight: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="label">{props.label}</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-soft)" }}>{props.value}</div>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.num}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-faint)" }}>
        <span>{props.hintLeft}</span>
        <span>{props.hintRight}</span>
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
