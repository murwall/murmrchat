import { invoke } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

/** Diagnostics: dev → console (forwarded to the Vite log); packaged app → stderr via Tauri. */
function diag(level: "warn" | "error", message: string) {
  if (import.meta.env.DEV) console[level](message);
  else if ("__TAURI_INTERNALS__" in window) void invoke("frontend_log", { level, message }).catch(() => {});
}
document.addEventListener("securitypolicyviolation", (e) =>
  diag("warn", `CSP blocked ${e.effectiveDirective}: ${e.blockedURI || "(inline)"} at ${e.sourceFile}:${e.lineNumber}`),
);
if (!import.meta.env.DEV) {
  window.addEventListener("error", (e) => diag("error", `Uncaught: ${e.message} at ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => diag("error", `Unhandled rejection: ${String(e.reason)}`));
  diag("warn", "UI started");
}

// ⌘R / Ctrl+R reloads the window (the Tauri webview has no built-in reload shortcut).
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    location.reload();
  }
});

// No React.StrictMode: its double-invoked effects would start two Matrix clients.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary
    fallback={(error) => (
      <div className="broken-panel">
        <h3>MurmrChat ran into a problem.</h3>
        <p className="muted small">{error.message}</p>
        <button className="btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )}
  >
    <App />
  </ErrorBoundary>,
);
