import { useEffect, useRef, useState } from "react";
import type { GeneratedSecretStorageKey } from "matrix-js-sdk/lib/crypto-api";
import { useClient } from "../matrix/hooks";
import {
  applyRecoveryKey,
  generateRecoveryKey,
  getRecoveryInfo,
  whyCantMakeRecoveryKey,
  type AuthRequest,
  type RecoveryInfo,
} from "../matrix/recovery";
import { openExternal } from "../util/open";
import { saveRecoveryKeyFile } from "../util/secrets";

export const ENCRYPTION_EVENT = "murmrchat:encryption";

/** Open the Encryption settings dialog from anywhere. */
export function requestEncryptionSettings() {
  window.dispatchEvent(new Event(ENCRYPTION_EVENT));
}

type Step =
  | { kind: "overview" }
  | { kind: "confirm-change" }
  | { kind: "show-key"; key: GeneratedSecretStorageKey & { encodedPrivateKey: string } }
  | { kind: "applying"; key: GeneratedSecretStorageKey & { encodedPrivateKey: string } }
  | { kind: "done"; wasChange: boolean };

/**
 * Encryption settings: this device's status, plus setting up or changing the account's recovery key
 * (the Security Key). Replaces the corresponding screens in Element.
 */
export function EncryptionDialog({ onClose, onUnlock, onChanged }: { onClose: () => void; onUnlock: () => void; onChanged: () => void }) {
  const client = useClient();
  const [info, setInfo] = useState<RecoveryInfo | null>(null);
  const [step, setStep] = useState<Step>({ kind: "overview" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    getRecoveryInfo(client)
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void refresh();
  }, [client]);

  // Closing is safe until the new key is being written; nothing has reached the server before that.
  const closable = step.kind !== "applying";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closable && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, onClose]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setStep({ kind: "show-key", key: await generateRecoveryKey(client) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const wasChange = !!info?.recoverySetUp;

  return (
    <div className="modal-backdrop" onClick={step.kind === "overview" || step.kind === "done" ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {step.kind === "overview" && (
          <Overview
            info={info}
            busy={busy}
            onClose={onClose}
            onUnlock={() => {
              onClose();
              onUnlock();
            }}
            onSetUp={generate}
            onChange={() => setStep({ kind: "confirm-change" })}
          />
        )}

        {step.kind === "confirm-change" && (
          <>
            <h2>Change recovery key?</h2>
            <p className="muted">
              You'll get a new Security Key and your current one will <b>stop working</b>. Your message history stays
              readable and your other signed-in devices stay verified.
            </p>
            <div className="row end">
              <button className="btn-secondary" onClick={() => setStep({ kind: "overview" })} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={generate} disabled={busy}>
                {busy ? "Generating…" : "Generate new key"}
              </button>
            </div>
          </>
        )}

        {step.kind === "show-key" && (
          <ShowKey
            encoded={step.key.encodedPrivateKey}
            onCancel={() => setStep({ kind: "overview" })}
            onContinue={() => {
              setError(null);
              setStep({ kind: "applying", key: step.key });
            }}
          />
        )}

        {step.kind === "applying" && (
          <Applying
            keyToApply={step.key}
            onDone={() => {
              setStep({ kind: "done", wasChange });
              void refresh();
              onChanged();
            }}
            onFailed={(msg) => {
              setError(msg);
              setStep({ kind: "overview" });
              void refresh();
            }}
          />
        )}

        {step.kind === "done" && (
          <>
            <h2>{step.wasChange ? "Recovery key changed" : "Recovery is set up"}</h2>
            <p className="muted">
              {step.wasChange
                ? "Use your new Security Key from now on, here and in other apps. The old one no longer works."
                : "Your message keys are now backed up. Use your Security Key to unlock your messages on a new device."}
            </p>
            <div className="row end">
              <button className="btn-primary" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

function Overview({
  info,
  busy,
  onClose,
  onUnlock,
  onSetUp,
  onChange,
}: {
  info: RecoveryInfo | null;
  busy: boolean;
  onClose: () => void;
  onUnlock: () => void;
  onSetUp: () => void;
  onChange: () => void;
}) {
  const blocked = info && whyCantMakeRecoveryKey(info);
  const canUnlock = info && info.recoverySetUp && !info.deviceVerified;
  return (
    <>
      <h2>Encryption</h2>
      {!info ? (
        <p className="muted">Checking…</p>
      ) : (
        <dl className="enc-status">
          <dt>This device</dt>
          <dd className={info.deviceVerified ? "ok" : "warn"}>{info.deviceVerified ? "Verified" : "Not verified"}</dd>
          <dt>Key backup</dt>
          <dd className={info.backupVersion ? "ok" : "warn"}>{info.backupVersion ? "On" : "Off"}</dd>
          <dt>Recovery key</dt>
          <dd className={info.recoverySetUp ? "ok" : "warn"}>{info.recoverySetUp ? "Set up" : "Not set up"}</dd>
        </dl>
      )}
      {info && (
        <p className="muted small">
          {info.recoverySetUp
            ? "Your Security Key unlocks your encrypted messages on new devices. It can't be shown again, but you can replace it with a new one."
            : "Set up a Security Key so you can read your encrypted messages on new devices, even if you sign out everywhere."}
        </p>
      )}
      {blocked && !canUnlock && <p className="muted small">{blocked}</p>}
      <div className="row end">
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {canUnlock && (
          <button className="btn-primary" onClick={onUnlock}>
            Unlock with Security Key
          </button>
        )}
        {info && !blocked && (
          <button className="btn-primary" onClick={info.recoverySetUp ? onChange : onSetUp} disabled={busy}>
            {info.recoverySetUp ? "Change recovery key…" : busy ? "Generating…" : "Set up recovery"}
          </button>
        )}
      </div>
    </>
  );
}

function ShowKey({ encoded, onCancel, onContinue }: { encoded: string; onCancel: () => void; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(encoded);
      setNote("Copied. Paste it into your password manager.");
    } catch {
      setNote("Couldn't copy. Select the key and copy it manually.");
    }
  };
  const save = async () => {
    try {
      const path = await saveRecoveryKeyFile(`MurmrChat recovery key (Matrix Security Key)\n\n${encoded}\n`);
      setNote(path ? `Saved to ${path}` : "Saved.");
    } catch (e) {
      setNote(`Couldn't save: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <h2>Save your Security Key</h2>
      <p className="muted">
        Store it somewhere safe, like a password manager. You'll need it to read your messages on a new device, and it
        won't be shown again.
      </p>
      <div className="recovery-key" aria-label="Security Key">
        {encoded}
      </div>
      <div className="row">
        <button className="btn-secondary small" onClick={copy}>
          Copy
        </button>
        <button className="btn-secondary small" onClick={save}>
          Save to Downloads
        </button>
      </div>
      {note && <div className="muted small enc-note">{note}</div>}
      <label className="enc-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved my Security Key somewhere safe
      </label>
      <div className="row end">
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!saved} onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  );
}

function Applying({
  keyToApply,
  onDone,
  onFailed,
}: {
  keyToApply: GeneratedSecretStorageKey;
  onDone: () => void;
  onFailed: (msg: string) => void;
}) {
  const client = useClient();
  const [progress, setProgress] = useState("Saving…");
  const [auth, setAuth] = useState<AuthRequest | null>(null);
  const [password, setPassword] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; this must only happen once.
    started.current = true;
    const prompt = (req: AuthRequest) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setAuth(req);
        if (req.kind === "browser") void openExternal(req.url);
      });
    applyRecoveryKey(client, keyToApply, prompt, setProgress)
      .then(onDone)
      .catch((e) => onFailed((e as Error).message));
  }, []);

  const answer = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setAuth(null);
    setPassword("");
  };

  if (auth?.kind === "browser") {
    return (
      <>
        <h2>Confirm in your browser</h2>
        <p className="muted">
          Your server wants you to approve this change. We opened its page in your browser; approve it there, then come
          back and continue.
        </p>
        <div className="row end">
          <button className="btn-secondary" onClick={() => answer(null)}>
            Cancel
          </button>
          <button className="btn-secondary" onClick={() => void openExternal(auth.url)}>
            Open again
          </button>
          <button className="btn-primary" onClick={() => answer("ok")}>
            I've approved it
          </button>
        </div>
      </>
    );
  }
  if (auth?.kind === "password") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          answer(password);
        }}
      >
        <h2>Confirm your password</h2>
        <p className="muted">Your server needs your account password to set up encryption.</p>
        <div className="form">
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        </div>
        <div className="row end">
          <button type="button" className="btn-secondary" onClick={() => answer(null)}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!password}>
            Continue
          </button>
        </div>
      </form>
    );
  }
  return (
    <>
      <h2>Saving your Security Key</h2>
      <p className="muted">{progress}</p>
    </>
  );
}
