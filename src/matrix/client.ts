import { ClientEvent, createClient, IndexedDBStore, SyncState } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";
import { decodeRecoveryKey, deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api";
import type { SecretStorageKeyDescription } from "matrix-js-sdk/lib/secret-storage";
import { saveSession, type StoredSession } from "./session";
import { deleteSearchIndex } from "./search";
import { migrateLegacyData } from "./migrate";

/**
 * Secret-storage key the user typed in (recovery key or passphrase-derived key).
 * The SDK asks for it via the getSecretStorageKey callback while we restore keys.
 */
let pendingSecretKey: Uint8Array<ArrayBuffer> | null = null;

/** Run `fn` with `key` offered to the SDK as the secret-storage key, then forget it again. */
export async function withSecretStorageKey<T>(key: Uint8Array<ArrayBuffer>, fn: () => Promise<T>): Promise<T> {
  pendingSecretKey = key;
  try {
    return await fn();
  } finally {
    pendingSecretKey = null;
  }
}

/**
 * Local database names. Newer logins (with a pickleKey) get per-device names, so a fresh login can
 * never pick up an older session's encryption store. Sessions from the first version keep their names.
 */
function storeNames(session: StoredSession) {
  return session.pickleKey
    ? { sync: `murmrchat-sync-${session.userId}-${session.deviceId}`, crypto: `murmrchat-crypto-${session.userId}-${session.deviceId}` }
    : { sync: `murmrchat-sync-${session.userId}`, crypto: `murmrchat-crypto-${session.userId}` };
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

async function deleteCryptoStore(prefix: string) {
  await deleteDb(`${prefix}::matrix-sdk-crypto`);
  await deleteDb(`${prefix}::matrix-sdk-crypto-meta`);
}

let currentStoreNames: { sync: string; crypto: string } | null = null;
let currentPassphrase: string | null = null;

/** The passphrase protecting this session's local stores (null for first-version sessions). */
export function getLocalStorePassphrase(): string | null {
  return currentPassphrase;
}

export async function startMatrixClient(session: StoredSession): Promise<MatrixClient> {
  const names = storeNames(session);
  currentStoreNames = names;
  currentPassphrase = session.pickleKey ?? null;
  if (session.pickleKey) {
    // Clean up databases left behind by the first version's naming scheme.
    await deleteCryptoStore(`murmrchat-crypto-${session.userId}`);
    await deleteDb(`murmrchat-sync-${session.userId}`);
  }

  const store = new IndexedDBStore({
    indexedDB: window.indexedDB,
    localStorage: window.localStorage,
    dbName: names.sync,
  });
  await store.startup();

  const client = createClient({
    baseUrl: session.baseUrl,
    userId: session.userId,
    deviceId: session.deviceId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    oauthClientId: session.oauthClientId,
    onTokenRefresh: (tokens) => {
      session = { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
      saveSession(session);
    },
    store,
    timelineSupport: true,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        if (!pendingSecretKey) return null;
        const keyId = Object.keys(keys)[0];
        return [keyId, pendingSecretKey];
      },
    },
  });

  await client.initRustCrypto({
    cryptoDatabasePrefix: names.crypto,
    // Encrypt the local key store at rest when we have a key for it (kept in the keychain with the session).
    storagePassword: session.pickleKey,
  });

  const ready = new Promise<void>((resolve, reject) => {
    const onSync = (state: SyncState, _prev: SyncState | null, data?: { error?: Error }) => {
      if (state === SyncState.Prepared || state === SyncState.Syncing) {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      } else if (state === SyncState.Error && data?.error && !client.isInitialSyncComplete()) {
        const err = data.error as Error & { errcode?: string };
        if (err.errcode === "M_UNKNOWN_TOKEN") {
          client.off(ClientEvent.Sync, onSync);
          reject(err);
        }
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });

  await client.startClient({
    threadSupport: true,
    initialSyncLimit: 30,
    lazyLoadMembers: true,
  });
  await ready;
  // Before anything reads our account data: carry over data saved under the app's old name.
  await migrateLegacyData(client);
  return client;
}

export type EncryptionStatus = "verified" | "needs-recovery" | "no-recovery-setup" | "unknown";

/** Is this device trusted, i.e. can it read encrypted history? */
export async function getEncryptionStatus(client: MatrixClient): Promise<EncryptionStatus> {
  const crypto = client.getCrypto();
  if (!crypto) return "unknown";
  const status = await crypto.getDeviceVerificationStatus(client.getSafeUserId(), client.getDeviceId()!);
  if (status?.isVerified()) return "verified";
  const hasSecretStorage = !!(await client.secretStorage.getDefaultKeyId());
  return hasSecretStorage ? "needs-recovery" : "no-recovery-setup";
}

/**
 * Unlock encrypted history with the user's Security Key (recovery key) or Security Phrase,
 * the same one they set up in Element.
 *
 * This: (1) imports cross-signing keys so this device becomes verified,
 *       (2) enables key backup and downloads all room keys from it.
 */
export async function unlockWithRecovery(
  client: MatrixClient,
  input: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available");

  const keyId = await client.secretStorage.getDefaultKeyId();
  if (!keyId) throw new Error("No recovery is set up on this account");
  const keyInfo = (await client.secretStorage.getKey(keyId))?.[1] as SecretStorageKeyDescription | undefined;
  if (!keyInfo) throw new Error("Could not read recovery key details from the server");

  const trimmed = input.trim();
  let key: Uint8Array<ArrayBuffer>;
  const looksLikeRecoveryKey = /^[A-Za-z0-9]{4}(\s+[A-Za-z0-9]{4}){10,}$/.test(trimmed) || trimmed.replace(/\s/g, "").length === 48;
  if (looksLikeRecoveryKey) {
    key = decodeRecoveryKey(trimmed);
  } else if (keyInfo.passphrase) {
    onProgress?.("Deriving key from passphrase…");
    key = await deriveRecoveryKeyFromPassphrase(
      trimmed,
      keyInfo.passphrase.salt,
      keyInfo.passphrase.iterations,
      keyInfo.passphrase.bits,
    );
  } else {
    throw new Error("That doesn't look like a valid Security Key");
  }

  const valid = await client.secretStorage.checkKey(key, keyInfo);
  if (!valid) throw new Error("Incorrect Security Key or Phrase");

  await withSecretStorageKey(key, async () => {
    onProgress?.("Verifying this device…");
    await crypto.bootstrapCrossSigning({});
    onProgress?.("Restoring message keys from backup…");
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();
    await crypto.restoreKeyBackup({
      progressCallback: (p) => {
        if (p.stage === "load_keys" && p.total) {
          onProgress?.(`Restoring message keys… ${p.successes + p.failures}/${p.total}`);
        }
      },
    });
  });
}

export async function logout(client: MatrixClient) {
  const userId = client.getSafeUserId();
  try {
    await client.logout(true);
  } catch {
    /* token may already be invalid */
  }
  client.stopClient();
  await client.clearStores(currentStoreNames ? { cryptoDatabasePrefix: currentStoreNames.crypto } : undefined);
  if (currentStoreNames) {
    // Belt and braces: make sure this device's databases are really gone.
    await deleteCryptoStore(currentStoreNames.crypto);
    await deleteDb(currentStoreNames.sync);
  }
  // Decrypted message text lives in the search index; never leave it behind.
  await deleteSearchIndex(userId);
  currentPassphrase = null;
}
