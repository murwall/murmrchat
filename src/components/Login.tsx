import { useEffect, useRef, useState } from "react";
import {
  getLoginMethods,
  loginWithPassword,
  resolveHomeserver,
  startDeviceLogin,
  type DeviceLogin,
  type LoginMethods,
  type StoredSession,
} from "../matrix/session";
import { openExternal } from "../util/open";

type Step =
  | { kind: "server" }
  | { kind: "choose"; baseUrl: string; methods: LoginMethods }
  | { kind: "browser"; baseUrl: string; login: DeviceLogin }
  | { kind: "password"; baseUrl: string };

export function Login({ onLoggedIn }: { onLoggedIn: (s: StoredSession) => void }) {
  const [server, setServer] = useState(() => localStorage.getItem("matterix.lastServer") ?? "matrix.org");
  const [step, setStep] = useState<Step>({ kind: "server" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const activeLogin = useRef<DeviceLogin | null>(null);

  useEffect(() => () => activeLogin.current?.cancel(), []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onContinue = () =>
    run(async () => {
      const baseUrl = await resolveHomeserver(server);
      localStorage.setItem("matterix.lastServer", server.trim());
      const methods = await getLoginMethods(baseUrl);
      if (!methods.oauth && !methods.password) throw new Error("This server doesn't offer a supported sign-in method");
      if (server.trim().startsWith("@")) setUser(server.trim());
      setStep({ kind: "choose", baseUrl, methods });
      if (methods.oauth) await beginBrowserLogin(baseUrl);
      else setStep({ kind: "password", baseUrl });
    });

  const beginBrowserLogin = async (baseUrl: string) => {
    const login = await startDeviceLogin(baseUrl);
    activeLogin.current = login;
    setStep({ kind: "browser", baseUrl, login });
    await openExternal(login.url);
    login.done.then(onLoggedIn).catch((e) => {
      if ((e as Error).message !== "cancelled") setError((e as Error).message);
    });
  };

  const onPasswordLogin = () =>
    run(async () => {
      if (step.kind !== "password") return;
      onLoggedIn(await loginWithPassword(step.baseUrl, user.trim(), password));
    });

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-mark">M</span> Matterix
        </div>

        {step.kind === "server" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onContinue();
            }}
          >
            <h1>Sign in</h1>
            <label>
              Server or Matrix ID
              <input
                autoFocus
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="matrix.org or @you:matrix.org"
              />
            </label>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Connecting…" : "Continue"}
            </button>
          </form>
        )}

        {step.kind === "browser" && (
          <div>
            <h1>Finish signing in in your browser</h1>
            <p className="muted">
              A browser window opened at your account provider. Sign in there and approve <b>Matterix</b>. Check that the
              code shown in the browser matches this one:
            </p>
            <div className="device-code">{step.login.userCode}</div>
            <p className="muted small">Waiting for approval…</p>
            <div className="row">
              <button className="btn-secondary" onClick={() => openExternal(step.login.url)}>
                Open browser again
              </button>
              <button
                className="btn-link"
                onClick={() => {
                  step.login.cancel();
                  setStep({ kind: "password", baseUrl: step.baseUrl });
                }}
              >
                Use password instead
              </button>
            </div>
          </div>
        )}

        {step.kind === "password" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onPasswordLogin();
            }}
          >
            <h1>Sign in with password</h1>
            <label>
              Username
              <input autoFocus value={user} onChange={(e) => setUser(e.target.value)} placeholder="@you:matrix.org" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="btn-primary" disabled={busy || !user || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {error && <div className="error">{error}</div>}

        {step.kind !== "server" && (
          <button
            className="btn-link back"
            onClick={() => {
              activeLogin.current?.cancel();
              setError(null);
              setStep({ kind: "server" });
            }}
          >
            ← Change server
          </button>
        )}
      </div>
    </div>
  );
}
