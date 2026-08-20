import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DownloadProgress,
  ImportProgressEvent,
  ImportReport,
  PackMeta,
  TakesMap
} from "./types";
import { isTauri, mockIndex, mockMeta, mockTakes } from "./mock";

let packsDir = "";

export async function initApi(): Promise<void> {
  if (!isTauri) return;
  packsDir = await invoke<string>("get_packs_dir");
}

export function assetUrl(slug: string, rel: string): string {
  if (!isTauri) return "";
  return convertFileSrc(`${packsDir}/${slug}/${rel}`);
}

const noopUnlisten: UnlistenFn = () => {};

export const api = {
  fetchIndex: () => (isTauri ? invoke<string>("fetch_pack_index") : Promise.resolve(JSON.stringify(mockIndex()))),
  downloadPack: (slug: string) => invoke<void>("download_pack", { slug }),
  importPack: (slug: string) => invoke<ImportReport>("import_pack", { slug }),
  listImported: () => (isTauri ? invoke<string[]>("list_imported") : Promise.resolve(["mock-0"])),
  readText: (slug: string, rel: string) =>
    isTauri ? invoke<string>("read_pack_text", { slug, rel }) : Promise.reject(new Error("mock")),
  writeText: (slug: string, rel: string, content: string) =>
    isTauri ? invoke<void>("write_pack_text", { slug, rel, content }) : Promise.resolve(),
  writeBinary: (slug: string, rel: string, data: Uint8Array) =>
    invoke<void>("write_pack_binary", data, {
      headers: { slug, rel: encodeURIComponent(rel) }
    }),
  deleteFile: (slug: string, rel: string) => invoke<void>("delete_pack_file", { slug, rel }),
  deletePack: (slug: string) => invoke<void>("delete_pack", { slug }),
  exportVideo: (slug: string, title: string) => invoke<string>("export_video", { slug, title }),

  onDownloadProgress: (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> =>
    isTauri
      ? listen<DownloadProgress>("download-progress", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onImportProgress: (cb: (p: ImportProgressEvent) => void): Promise<UnlistenFn> =>
    isTauri
      ? listen<ImportProgressEvent>("import-progress", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten)
};

export async function loadPackMeta(slug: string): Promise<PackMeta> {
  if (!isTauri) return mockMeta(slug);
  return JSON.parse(await api.readText(slug, "pack.json"));
}

export async function loadTakes(slug: string): Promise<TakesMap> {
  if (!isTauri) return mockTakes(mockMeta(slug));
  try {
    return JSON.parse(await api.readText(slug, "takes.json"));
  } catch {
    return {};
  }
}

export async function saveTakes(slug: string, takes: TakesMap): Promise<void> {
  if (!isTauri) return;
  await api.writeText(slug, "takes.json", JSON.stringify(takes, null, 2));
}
