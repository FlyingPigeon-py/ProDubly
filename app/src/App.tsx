import { useCallback, useEffect, useState } from "react";
import { api, initApi, loadPackMeta } from "./api";
import { buildPackMeta } from "./ini";
import { isTauri } from "./mock";
import type { IndexPack, PackMeta } from "./types";
import Library from "./screens/Library";
import Market from "./screens/Market";
import PackView from "./screens/PackView";
import Record from "./screens/Record";
import Results from "./screens/Results";
import Watch from "./screens/Watch";
import ImportModal, { type ImportState } from "./screens/ImportModal";
import SettingsModal from "./screens/SettingsModal";

type Screen =
  | { name: "lib" }
  | { name: "market" }
  | { name: "pack"; entry: IndexPack }
  | { name: "record"; slug: string; line?: number }
  | { name: "results"; slug: string }
  | { name: "watch"; slug: string };

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "lib" });
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const refreshLibrary = useCallback(async () => {
    const slugs = await api.listImported();
    const metas: PackMeta[] = [];
    for (const slug of slugs) {
      try {
        metas.push(await loadPackMeta(slug));
      } catch {
        // битый pack.json — пропускаем
      }
    }
    metas.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    setPacks(metas);
  }, []);

  useEffect(() => {
    (async () => {
      await initApi();
      await refreshLibrary();
      setReady(true);
    })().catch((e) => setError(String(e)));
  }, [refreshLibrary]);

  const installPack = useCallback(
    async (entry: IndexPack) => {
      setImportState({
        slug: entry.slug,
        title: entry.title,
        thumbnail: entry.thumbnail,
        phase: "download",
        pct: 0,
        step: "скачиваю"
      });
      const unDl = await api.onDownloadProgress((p) => {
        if (p.slug !== entry.slug) return;
        setImportState((s) =>
          s && {
            ...s,
            phase: "download",
            pct: p.total > 0 ? Math.round((p.received / p.total) * 100) : 0,
            step: `скачиваю · ${(p.received / 1048576).toFixed(1)} МБ`
          }
        );
      });
      const unImp = await api.onImportProgress((p) => {
        if (p.slug !== entry.slug) return;
        setImportState((s) =>
          s && {
            ...s,
            phase: "convert",
            pct: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
            step: p.step
          }
        );
      });
      try {
        await api.downloadPack(entry.slug);
        setImportState((s) => s && { ...s, phase: "convert", pct: 0, step: "разбираю пак" });
        const report = await api.importPack(entry.slug);
        const meta = buildPackMeta(entry.slug, report, entry.title);
        if (meta.lines.length === 0) {
          throw new Error("в паке не нашлось ни одной реплики с таймингом");
        }
        await api.writeText(entry.slug, "pack.json", JSON.stringify(meta, null, 2));
        await refreshLibrary();
        setImportState(null);
        setScreen({ name: "record", slug: entry.slug });
      } catch (e) {
        setImportState(null);
        setError(`Пак не открылся: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        unDl();
        unImp();
      }
    },
    [refreshLibrary]
  );

  const deletePack = useCallback(
    async (slug: string) => {
      try {
        await api.deletePack(slug);
        await refreshLibrary();
      } catch (e) {
        setError(`Не смог удалить пак: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refreshLibrary]
  );

  if (!ready) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
        <div className="mono pulse" style={{ color: "var(--text-dim)", fontSize: 13 }}>ДУБЛЬ</div>
      </div>
    );
  }

  return (
    <>
      {screen.name === "lib" && (
        <Library
          packs={packs}
          onOpenMarket={() => setScreen({ name: "market" })}
          onRecord={(slug) => setScreen({ name: "record", slug })}
          onWatch={(slug) => setScreen({ name: "watch", slug })}
          onDelete={deletePack}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen.name === "market" && (
        <Market
          installedSlugs={packs.map((p) => p.slug)}
          onBack={() => setScreen({ name: "lib" })}
          onInstall={installPack}
          onOpen={(entry) => setScreen({ name: "pack", entry })}
          busy={importState !== null}
        />
      )}
      {screen.name === "pack" && (
        <PackView
          entry={screen.entry}
          installed={packs.some((p) => p.slug === screen.entry.slug)}
          busy={importState !== null}
          onBack={() => setScreen({ name: "market" })}
          onInstall={installPack}
        />
      )}
      {screen.name === "record" && (
        <Record
          slug={screen.slug}
          startLine={screen.line}
          settingsVersion={settingsVersion}
          onBack={() => {
            refreshLibrary();
            setScreen({ name: "lib" });
          }}
          onSettings={() => setSettingsOpen(true)}
          onResults={(slug) => setScreen({ name: "results", slug })}
        />
      )}
      {screen.name === "results" && (
        <Results
          slug={screen.slug}
          onBack={() => setScreen({ name: "lib" })}
          onRecordLine={(slug, line) => setScreen({ name: "record", slug, line })}
          onWatch={(slug) => setScreen({ name: "watch", slug })}
        />
      )}
      {screen.name === "watch" && (
        <Watch
          slug={screen.slug}
          onBack={() => setScreen({ name: "results", slug: screen.slug })}
          onRecord={(slug) => setScreen({ name: "record", slug })}
        />
      )}

      {importState && <ImportModal state={importState} />}

      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false);
            setSettingsVersion((v) => v + 1);
          }}
        />
      )}

      {!isTauri && (
        <div
          className="mono"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 90,
            height: 44,
            background: "#0d0f11",
            borderTop: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 16px",
            fontSize: 11
          }}
        >
          <span style={{ color: "var(--text-faint)", letterSpacing: "0.09em", textTransform: "uppercase" }}>мок · экраны</span>
          {(
            [
              ["библиотека", { name: "lib" }],
              ["витрина", { name: "market" }],
              ["запись", { name: "record", slug: "mock-0" }],
              ["итоги", { name: "results", slug: "mock-0" }],
              ["просмотр", { name: "watch", slug: "mock-0" }]
            ] as [string, Screen][]
          ).map(([label, s]) => (
            <button
              key={label}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11, borderColor: screen.name === s.name ? "var(--border-hover)" : "var(--card-border)" }}
              onClick={() => setScreen(s)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="overlay" onClick={() => setError(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  flex: "none",
                  borderRadius: 8,
                  background: "var(--red)",
                  color: "var(--ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 700
                }}
              >
                !
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 20, fontWeight: 500 }}>Что-то пошло не так</div>
                <div style={{ fontSize: 14, color: "var(--text-mute)", lineHeight: 1.5, overflowWrap: "anywhere" }}>{error}</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setError(null)}>Понятно</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
