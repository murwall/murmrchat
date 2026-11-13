import { openUrl } from "@tauri-apps/plugin-opener";

/** Open a URL in the system browser (falls back to window.open outside Tauri). */
export async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
