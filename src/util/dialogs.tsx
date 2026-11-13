import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * In-app replacements for window.confirm / window.alert.
 * The native ones don't work in the Tauri macOS web view (confirm() silently returns false).
 */

interface Options {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string | null; // null = no cancel button (alert)
  danger?: boolean;
}

function Dialog({ opts, onDone }: { opts: Options; onDone: (ok: boolean) => void }) {
  const [closing, setClosing] = useState(false);
  const done = (ok: boolean) => {
    if (closing) return;
    setClosing(true);
    onDone(ok);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={() => done(false)}>
      <div className="modal dialog" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-modal>
        <h2>{opts.title}</h2>
        {opts.message && <p className="muted">{opts.message}</p>}
        <div className="row end">
          {opts.cancelLabel !== null && (
            <button className="btn-secondary" onClick={() => done(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button autoFocus className={opts.danger ? "btn-danger" : "btn-primary"} onClick={() => done(true)}>
            {opts.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

function show(opts: Options): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <Dialog
        opts={opts}
        onDone={(ok) => {
          resolve(ok);
          setTimeout(() => {
            root.unmount();
            host.remove();
          });
        }}
      />,
    );
  });
}

export function confirmDialog(opts: Omit<Options, "cancelLabel"> & { cancelLabel?: string }): Promise<boolean> {
  return show(opts);
}

export function alertDialog(title: string, message?: string): Promise<void> {
  return show({ title, message, cancelLabel: null }).then(() => undefined);
}
