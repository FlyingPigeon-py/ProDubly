import type { IndexPack } from "./types";

export type SortMode = "new" | "az" | "small";

export interface CatalogFilters {
  q: string;
  showMature: boolean;
  trendingOnly: boolean;
  creatorsOnly: boolean;
  maxDuration: number | null;
  maxLines: number | null;
  sort: SortMode;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: "",
  showMature: false,
  trendingOnly: false,
  creatorsOnly: false,
  maxDuration: null,
  maxLines: null,
  sort: "new"
};

const FILTERS_KEY = "dubl.catalog.filters";

export function loadFilters(): CatalogFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };
    const saved = JSON.parse(raw) as Partial<CatalogFilters>;
    return {
      ...DEFAULT_FILTERS,
      ...saved,
      sort: (["new", "az", "small"] as SortMode[]).includes(saved.sort as SortMode)
        ? (saved.sort as SortMode)
        : DEFAULT_FILTERS.sort
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function saveFilters(f: CatalogFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // приватный режим без хранилища — фильтры просто не переживут перезапуск
  }
}

export function findPack(all: IndexPack[], slug: string): IndexPack | null {
  return all.find((p) => p.slug === slug) ?? null;
}

export function packDuration(summaryValue: string): number | null {
  const m = /(\d+):(\d{2})/.exec(summaryValue);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function packLineCount(summaryValue: string): number | null {
  const m = /(\d+)\s+dub clips/.exec(summaryValue);
  return m ? Number(m[1]) : null;
}

export function packSizeMb(fileSize: string): number {
  const n = parseFloat(fileSize);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  if (fileSize.includes("KB")) return n / 1024;
  if (fileSize.includes("GB")) return n * 1024;
  return n;
}

function haystack(p: IndexPack): string {
  const raw = p.searchText || `${p.title} ${p.creator} ${p.shortDescription} ${p.tags.join(" ")} ${p.language}`;
  return raw.toLowerCase().replace(/ё/g, "е");
}

export function selectPacks(all: IndexPack[], f: CatalogFilters): IndexPack[] {
  const words = f.q.trim().toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
  return all
    .filter((p) => f.showMature || !p.mature)
    .filter((p) => !f.trendingOnly || p.trending)
    .filter((p) => !f.creatorsOnly || p.sourceName === "Creator Submission")
    .filter((p) => {
      if (f.maxDuration === null) return true;
      const d = packDuration(p.summaryValue);
      return d !== null && d <= f.maxDuration;
    })
    .filter((p) => {
      if (f.maxLines === null) return true;
      const n = packLineCount(p.summaryValue);
      return n !== null && n <= f.maxLines;
    })
    .filter((p) => {
      if (words.length === 0) return true;
      const h = haystack(p);
      return words.every((w) => h.includes(w));
    })
    .sort((a, b) =>
      f.sort === "az"
        ? a.title.localeCompare(b.title)
        : f.sort === "small"
          ? packSizeMb(a.fileSize) - packSizeMb(b.fileSize)
          : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
    );
}
