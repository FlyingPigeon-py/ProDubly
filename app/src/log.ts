import { invoke } from "@tauri-apps/api/core";

export function dlog(...args: unknown[]): void {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  console.log(msg);
  invoke("app_log", { msg }).catch(() => {});
}

export function installLogger(): void {
  window.onerror = (message, source, line, col, error) => {
    dlog("window.onerror:", String(message), `${source}:${line}:${col}`, error ?? "");
  };
  window.addEventListener("unhandledrejection", (e) => {
    dlog("unhandledrejection:", e.reason instanceof Error ? e.reason : String(e.reason));
  });
  dlog("--- webview загрузился ---");
}
