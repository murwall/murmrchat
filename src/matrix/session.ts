import { AutoDiscovery, createClient, OAuth2, OAuthGrantType, generateScope } from "matrix-js-sdk";
import type { DeviceAuthorizationResponse } from "matrix-js-sdk";
import { deleteSecret, getSecret, setSecret } from "../util/secrets";

/**
 * Everything needed to restore a logged-in session on app start.
 * Stored in the OS keychain.
 */
export interface StoredSession {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
  oauthClientId?: string;
  /** Passphrase that encrypts the local encryption-key store (set for logins made after it was introduced). */
  pickleKey?: string;
}

const SESSION_KEY = "matterix.session";
/**
 * Keychain entry for the session. The dev build (http://localhost:1420) and the packaged app
 * (tauri://localhost) have separate browser storage — and so separate encryption stores — so they
 * must not share a session: the second one would start the same device with an empty key store.
 */
const KEYCHAIN_KEY = import.meta.env.DEV ? SESSION_KEY : `${SESSION_KEY}.app`;
const CLIENT_IDS_KEY = "matterix.oauthClientIds";

/** Public "home page" for the app, required by OAuth dynamic client registration. */
const CLIENT_URI = "https://matterix.invalid/";

export async function loadSession(): Promise<StoredSession | null> {
  try {
    // One-time migration from the first version, which kept the session in localStorage.
    const legacy = localStorage.getItem(SESSION_KEY);
    if (legacy) {
      await setSecret(KEYCHAIN_KEY, legacy);
      localStorage.removeItem(SESSION_KEY);
    }
    const raw = await getSecret(KEYCHAIN_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch (e) {
    console.error("Could not read session from keychain", e);
    return null;
  }
}

/** Serialize writes so token refreshes can't race each other. */
let writeChain: Promise<void> = Promise.resolve();

export function saveSession(s: StoredSession): Promise<void> {
  writeChain = writeChain.then(() => setSecret(KEYCHAIN_KEY, JSON.stringify(s))).catch((e) => console.error(e));
  return writeChain;
}

export async function clearSession() {
  await writeChain;
  await deleteSecret(KEYCHAIN_KEY).catch(() => {});
}

function newPickleKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Turn whatever the user typed ("matrix.org", "@me:matrix.org", "https://matrix-client.matrix.org")
 * into a homeserver base URL, using .well-known discovery like Element does.
 */
export async function resolveHomeserver(input: string): Promise<string> {
  let value = input.trim();
  if (!value) throw new Error("Enter a server name or your Matrix ID");
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/+$/, "");
  }
  if (value.startsWith("@") && value.includes(":")) {
    value = value.slice(value.indexOf(":") + 1);
  }
  const config = await AutoDiscovery.findClientConfig(value);
  const hs = config["m.homeserver"];
  if (hs?.base_url && hs.state === AutoDiscovery.SUCCESS) return hs.base_url.replace(/\/+$/, "");
  // No usable .well-known: assume the domain itself is the homeserver.
  return `https://${value}`;
}

export type LoginMethods = { oauth: boolean; password: boolean };

export async function getLoginMethods(baseUrl: string): Promise<LoginMethods> {
  const tmp = createClient({ baseUrl });
  let oauth = false;
  try {
    const meta = await tmp.getAuthMetadata();
    oauth = meta.grant_types_supported.includes(OAuthGrantType.DeviceAuthorization);
  } catch {
    oauth = false;
  }
  let password = false;
  try {
    const flows = await tmp.loginFlows();
    password = flows.flows.some((f) => f.type === "m.login.password");
  } catch {
    password = false;
  }
  return { oauth, password };
}

export async function loginWithPassword(baseUrl: string, user: string, password: string): Promise<StoredSession> {
  const tmp = createClient({ baseUrl });
  const res = await tmp.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: "Matterix Desktop",
  });
  return {
    baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    pickleKey: newPickleKey(),
  };
}

/** OAuth client IDs are per authorization server; reuse them across logins. */
function getCachedClientId(issuer: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(CLIENT_IDS_KEY) ?? "{}")[issuer];
  } catch {
    return undefined;
  }
}

function cacheClientId(issuer: string, clientId: string) {
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(localStorage.getItem(CLIENT_IDS_KEY) ?? "{}");
  } catch {
    /* ignore */
  }
  all[issuer] = clientId;
  localStorage.setItem(CLIENT_IDS_KEY, JSON.stringify(all));
}

export interface DeviceLogin {
  /** Code the user confirms in the browser. */
  userCode: string;
  /** URL to open in the browser (code pre-filled when the server supports it). */
  url: string;
  /** Resolves once the user approves in the browser. */
  done: Promise<StoredSession>;
  cancel: () => void;
}

/**
 * "Sign in with browser" using the OAuth 2.0 device authorization grant (RFC 8628).
 * This is what servers running Matrix Authentication Service (like matrix.org) expect.
 * No redirect back into the app is needed: we just poll until the user approves.
 */
export async function startDeviceLogin(baseUrl: string): Promise<DeviceLogin> {
  const tmp = createClient({ baseUrl });
  const metadata = await tmp.getAuthMetadata();

  let clientId = getCachedClientId(metadata.issuer);
  if (!clientId) {
    clientId = await OAuth2.registerClient(metadata, {
      application_type: "native",
      client_name: "Matterix",
      client_uri: CLIENT_URI,
      grant_types: [OAuthGrantType.DeviceAuthorization, OAuthGrantType.RefreshToken],
      // Device flow only: no redirect-based "code" response type.
      response_types: [] as unknown as ["code"],
    });
    cacheClientId(metadata.issuer, clientId);
  }

  const oauth = new OAuth2(metadata, { clientId });
  const deviceId = oauth.context.deviceId;
  const grant: DeviceAuthorizationResponse = await oauth.startDeviceAuthorizationGrant(generateScope(deviceId));

  let cancelled = false;
  const done = (async (): Promise<StoredSession> => {
    const result = await oauth.waitForDeviceAuthorizationGrant(grant);
    if (cancelled) throw new Error("cancelled");
    if (!("access_token" in result) || !result.access_token) {
      const err = result as { error?: string; error_description?: string };
      throw new Error(err.error_description ?? err.error ?? "Sign-in was not completed");
    }
    const authed = createClient({ baseUrl, accessToken: result.access_token });
    const who = await authed.whoami();
    return {
      baseUrl,
      userId: who.user_id,
      deviceId: who.device_id ?? deviceId,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      oauthClientId: clientId,
      pickleKey: newPickleKey(),
    };
  })();

  return {
    userCode: grant.user_code,
    url: grant.verification_uri_complete ?? grant.verification_uri,
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}
