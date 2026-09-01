import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../mock";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "../settings";

const TABS = [
  { id: "mic", label: "Микрофон" },
  { id: "take", label: "Дубль" },
  { id: "translate", label: "Перевод" },
  { id: "coop", label: "Вместе" },
  { id: "storage", label: "Хранилище" }
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsModal(props: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("mic");
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
          if (alive) setMicError(`Нет доступа к микрофону: ${e instanceof Error ? e.message : e}`);
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
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 19, fontWeight: 500 }}>Настройки</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>запоминаются между запусками</div>
          </div>
          <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={props.onClose}>Готово</button>
        </div>

        <div className="settings-body">
          <div className="settings-nav">
            {TABS.map((t) => (
              <div
                key={t.id}
                className={`settings-nav-item${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </div>
            ))}
          </div>

          <div className="settings-pane">
            {tab === "mic" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <div className="settings-section-title">Микрофон</div>
                  <div className="settings-section-note">то, чем вы записываете дубли</div>
                </div>

                <div className="field">
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

                <div className="field">
                  <div className="field-head">
                    <div className="label">Усиление входа</div>
                    <div className="field-value">{gainDb > 0 ? "+" : ""}{gainDb} дБ</div>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={s.gain}
                    onChange={(e) => update({ gain: Number(e.target.value) })}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
                    <div style={{ flex: 1, height: 12, background: "#101315", border: "1px solid var(--card-border)", borderRadius: 4, overflow: "hidden" }}>
                      <div ref={meterRef} style={{ width: "0%", height: "100%", background: "var(--green)", transition: "width .06s linear" }} />
                    </div>
                  </div>
                  <div className="field-note">скажите что-нибудь — полоска оживёт</div>
                </div>

                <div className="settings-divider" />

                <ToggleRow
                  title="Шумоподавление"
                  hint="подавление шума и автоуровень — включайте только в шумной комнате"
                  on={s.dsp}
                  onToggle={() => update({ dsp: !s.dsp })}
                />

                <div className="stat-row">
                  <div className="label">Доступ к микрофону</div>
                  <div className="stat-value" style={{ color: micError ? "var(--red)" : "var(--green)" }}>
                    {micError ? "нет доступа" : "разрешён"}
                  </div>
                </div>
              </div>
            )}

            {tab === "take" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <div className="settings-section-title">Дубль</div>
                  <div className="settings-section-note">как ведёт себя запись и сведение</div>
                </div>

                <SliderRow
                  label="Отсчёт перед репликой"
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

                <div className="settings-divider" />

                <ToggleRow
                  title="Щелчки отсчёта"
                  hint="щелчки во время отсчёта перед записью"
                  on={s.ticks}
                  onToggle={() => update({ ticks: !s.ticks })}
                />
              </div>
            )}

            {tab === "translate" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <div className="settings-section-title">Перевод реплик</div>
                  <div className="settings-section-note">почти все паки в каталоге на английском</div>
                </div>

                <div className="field">
                  <div className="label">Ключ DeepL</div>
                  <input
                    className="search"
                    type="password"
                    placeholder="вставьте ключ API"
                    value={s.deeplKey}
                    onChange={(e) => update({ deeplKey: e.target.value })}
                  />
                  <div className="field-note">
                    бесплатный тариф DeepL — 500 000 знаков в месяц. Ключ хранится только на этом устройстве
                  </div>
                </div>

                <div className="settings-divider" />

                <ToggleRow
                  title="Показывать перевод"
                  hint="в записи, субтитрах и итогах вместо оригинального текста"
                  on={s.showTranslation}
                  onToggle={() => update({ showTranslation: !s.showTranslation })}
                />
              </div>
            )}

            {tab === "coop" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <div className="settings-section-title">Совместная озвучка</div>
                  <div className="settings-section-note">запись идёт напрямую между участниками</div>
                </div>

                <div className="field">
                  <div className="label">Как вас зовут в комнате</div>
                  <input
                    className="search"
                    placeholder="Игрок"
                    value={s.playerName}
                    onChange={(e) => update({ playerName: e.target.value })}
                  />
                  <div className="field-note">это имя увидят остальные в лобби и в итогах</div>
                </div>

                <div className="settings-divider" />

                <div className="field">
                  <div className="label">Сервер комнат</div>
                  <input
                    className="search"
                    placeholder="wss://choicervoicer.com/dub-rooms"
                    value={s.signalingUrl}
                    onChange={(e) => update({ signalingUrl: e.target.value })}
                  />
                  <div className="field-note">
                    нужен только чтобы найти друг друга по коду — дубли идут мимо него, напрямую
                  </div>
                </div>

                <div className="field">
                  <div className="label">TURN на случай строгой сети</div>
                  <input
                    className="search"
                    placeholder="turn:turn.example.com:3478"
                    value={s.turnUrl}
                    onChange={(e) => update({ turnUrl: e.target.value })}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      className="search"
                      placeholder="логин"
                      value={s.turnUser}
                      onChange={(e) => update({ turnUser: e.target.value })}
                    />
                    <input
                      className="search"
                      type="password"
                      placeholder="пароль"
                      value={s.turnPass}
                      onChange={(e) => update({ turnPass: e.target.value })}
                    />
                  </div>
                  <div className="field-note">
                    оставьте пустым, если прямое соединение и так встаёт: TURN нужен, когда провайдер прячет вас за
                    строгим NAT
                  </div>
                </div>
              </div>
            )}

            {tab === "storage" && (
              <div className="settings-section">
                <div className="settings-section-head">
                  <div className="settings-section-title">Хранилище</div>
                  <div className="settings-section-note">паки, записи и сведённый дубляж лежат на этом устройстве</div>
                </div>

                <div className="stat-row">
                  <div className="label">Занято</div>
                  <div className="stat-value">
                    {storage
                      ? `${(storage.bytes / 1073741824).toFixed(2)} ГБ · ${storage.packs} ${plural(storage.packs, "пак", "пака", "паков")}`
                      : "—"}
                  </div>
                </div>

                <div className="settings-divider" />

                <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
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
            )}
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
