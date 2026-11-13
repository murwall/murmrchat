import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

if (import.meta.env.DEV) {
  // Surface Content-Security-Policy violations in the dev log.
  document.addEventListener("securitypolicyviolation", (e) =>
    console.warn(`CSP blocked ${e.effectiveDirective}: ${e.blockedURI || "(inline)"} at ${e.sourceFile}:${e.lineNumber}`),
  );
}

// No React.StrictMode: its double-invoked effects would start two Matrix clients.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary
    fallback={(error) => (
      <div className="broken-panel">
        <h3>Matterix ran into a problem.</h3>
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
