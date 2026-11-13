import { invoke } from "@tauri-apps/api/core";

const inTauri = () => "__TAURI_INTERNALS__" in window;

/** Secrets live in the OS keychain (macOS Keychain); localStorage only as a fallback outside the desktop app. */
export async function getSecret(key: string): Promise<string | null> {
  if (!inTauri()) return localStorage.getItem(`secret.${key}`);
  return invoke<string | null>("secret_get", { key });
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (!inTauri()) return localStorage.setItem(`secret.${key}`, value);
  await invoke("secret_set", { key, value });
}

export async function deleteSecret(key: string): Promise<void> {
  if (!inTauri()) return localStorage.removeItem(`secret.${key}`);
  await invoke("secret_delete", { key });
}
