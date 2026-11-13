import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { logout, startMatrixClient } from "./matrix/client";
import { ClientContext } from "./matrix/hooks";
import { clearSession, loadSession, saveSession, type StoredSession } from "./matrix/session";
import { Login } from "./components/Login";
import { Shell } from "./components/Shell";
import { openExternal } from "./util/open";
import "./App.css";
import { confirmDialog } from "./util/dialogs";

type State =
  | { kind: "loading"; message: string }
  | { kind: "login"; error?: string }
  | { kind: "ready"; client: MatrixClient };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading", message: "Connecting…" });

  const start = async (session: StoredSession) => {
    setState({ kind: "loading", message: "Syncing your channels…" });
    try {
      const client = await startMatrixClient(session);
      setState({ kind: "ready", client });
      if (!import.meta.env.DEV && "__TAURI_INTERNALS__" in window) {
        void invoke("frontend_log", { level: "info", message: "Matrix client started (crypto ready)" }).catch(() => {});
      }
    } catch (e) {
      const err = e as Error & { errcode?: string };
      if (!import.meta.env.DEV && "__TAURI_INTERNALS__" in window) {
        void invoke("frontend_log", { level: "error", message: `Client start failed: ${err.message}` }).catch(() => {});
      }
      if (err.errcode === "M_UNKNOWN_TOKEN") await clearSession();
      setState({ kind: "login", error: err.message });
    }
  };

  useEffect(() => {
    loadSession().then((session) => (session ? start(session) : setState({ kind: "login" })));
  }, []);

  // Open links from messages in the system browser instead of inside the app window.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      // Never navigate the app window to a blob: URL (it would share the app's origin); only allow downloads.
      if (a.protocol === "blob:" && !a.hasAttribute("download")) {
        e.preventDefault();
        return;
      }
      if (a.hasAttribute("download")) return;
      if (/^https?:|^mailto:/.test(a.href)) {
        e.preventDefault();
        openExternal(a.href);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="splash">
        <span className="logo-mark big">M</span>
        <div className="muted">{state.message}</div>
      </div>
    );
  }

  if (state.kind === "login") {
    return (
      <>
        {state.error && <div className="banner error-banner">{state.error}</div>}
        <Login
          onLoggedIn={async (s) => {
            await saveSession(s);
            start(s);
          }}
        />
      </>
    );
  }

  return (
    <ClientContext.Provider value={state.client}>
      <Shell
        onLogout={async () => {
          const ok = await confirmDialog({
            title: "Sign out?",
            message:
              "You'll need to sign in again and re-enter your Security Key to read encrypted messages on this device.",
            confirmLabel: "Sign out",
            danger: true,
          });
          if (!ok) return;
          await logout(state.client);
          await clearSession();
          setState({ kind: "login" });
        }}
      />
    </ClientContext.Provider>
  );
}
