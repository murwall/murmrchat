/** True on macOS (used for keyboard shortcut labels: ⌘ vs Ctrl). */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘F" on macOS, "Ctrl+F" elsewhere. */
export function shortcut(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
