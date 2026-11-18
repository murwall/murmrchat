import { useEffect, useState } from "react";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api";
import { getEncryptionStatus, unlockWithRecovery, type EncryptionStatus } from "../matrix/client";
import { useClient } from "../matrix/hooks";
import { ENCRYPTION_EVENT, EncryptionDialog, requestEncryptionSettings } from "./EncryptionSettings";

export const UNLOCK_EVENT = "murmrchat:unlock";

/** Open the "Unlock encrypted messages" dialog from anywhere. */
export function requestUnlock() {
  window.dispatchEvent(new Event(UNLOCK_EVENT));
}

/**
 * One clear prompt instead of Element's maze of verification dialogs:
 * "Enter your Security Key to read encrypted messages."
 */
export function SecurityBanner() {
  const client = useClient();
  const [status, setStatus] = useState<EncryptionStatus>("unknown");
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const refresh = () => getEncryptionStatus(client).then(setStatus).catch(() => {});
    refresh();
    client.on(CryptoEvent.DevicesUpdated, refresh);
    client.on(CryptoEvent.UserTrustStatusChanged, refresh);
    // Any "Unlock" button elsewhere in the app opens the dialog via this event.
    const openDialog = () => setOpen(true);
    window.addEventListener(UNLOCK_EVENT, openDialog);
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener(ENCRYPTION_EVENT, openSettings);
    return () => {
      window.removeEventListener(ENCRYPTION_EVENT, openSettings);
      client.off(CryptoEvent.DevicesUpdated, refresh);
      client.off(CryptoEvent.UserTrustStatusChanged, refresh);
      window.removeEventListener(UNLOCK_EVENT, openDialog);
    };
  }, [client]);

  const showBanner = status !== "verified" && !dismissed;

  return (
    <>
      {showBanner && (
        <div className="banner">
          {status === "no-recovery-setup" ? (
            <>
              <span>🔒 Your account has no key backup set up, so older encrypted messages can't be restored here.</span>
              <button className="btn-banner" onClick={requestEncryptionSettings}>
                Set up
              </button>
            </>
          ) : (
            <>
              <span>🔒 Encrypted messages are locked on this device. Enter your Security Key to read them.</span>
              <button className="btn-banner" onClick={() => setOpen(true)}>
                Unlock
              </button>
            </>
          )}
          <button className="banner-close" onClick={() => setDismissed(true)} title="Dismiss">
            ×
          </button>
        </div>
      )}
      {settingsOpen && (
        <EncryptionDialog
          onClose={() => setSettingsOpen(false)}
          onUnlock={() => setOpen(true)}
          onChanged={() => getEncryptionStatus(client).then(setStatus)}
        />
      )}
      {open && (
        <UnlockDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            getEncryptionStatus(client).then(setStatus);
          }}
        />
      )}
    </>
  );
}

function UnlockDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const client = useClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlockWithRecovery(client, value, setProgress);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Unlock encrypted messages</h2>
        <p className="muted">
          Enter the <b>Security Key</b> (looks like <code>EsTc 1234 abcd …</code>) or <b>Security Phrase</b> you saved
          when you set up recovery (here or in another Matrix app). It never leaves this device.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            autoFocus
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Security Key or Phrase"
            spellCheck={false}
          />
          {progress && <div className="muted small">{progress}</div>}
          {error && <div className="error">{error}</div>}
          <div className="row end">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !value.trim()}>
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
