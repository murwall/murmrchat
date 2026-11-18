import { MatrixError } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";
import type { GeneratedSecretStorageKey } from "matrix-js-sdk/lib/crypto-api";
import type { AuthDict, UIAuthCallback } from "matrix-js-sdk/lib/interactive-auth";
import { withSecretStorageKey } from "./client";

/**
 * Recovery (a.k.a. Security Key / secret storage) management, so users don't need Element for it.
 *
 * The recovery key encrypts the account's secrets on the server: the cross-signing private keys
 * (which make a device "verified") and the key-backup key (which unlocks old message keys).
 * The server never sees the key itself, so an existing key can't be shown again, only replaced.
 */

export interface RecoveryInfo {
  /** This device is cross-signed by the account's identity. */
  deviceVerified: boolean;
  /** The account has a recovery key (a default secret-storage key). */
  recoverySetUp: boolean;
  /** The account has a cross-signing identity at all. */
  identityExists: boolean;
  /** This device holds all three cross-signing private keys. */
  identityKeysOnDevice: boolean;
  /** Server-side key backup version, if any. */
  backupVersion: string | null;
  /** This device holds the private key for the server's backup. */
  backupKeyOnDevice: boolean;
}

export async function getRecoveryInfo(client: MatrixClient): Promise<RecoveryInfo> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available");
  const [deviceStatus, defaultKeyId, masterKeyId, csStatus, backupInfo, backupKey] = await Promise.all([
    crypto.getDeviceVerificationStatus(client.getSafeUserId(), client.getDeviceId()!),
    client.secretStorage.getDefaultKeyId(),
    crypto.getCrossSigningKeyId(),
    crypto.getCrossSigningStatus(),
    crypto.getKeyBackupInfo(),
    crypto.getSessionBackupPrivateKey(),
  ]);
  const cached = csStatus.privateKeysCachedLocally;
  return {
    deviceVerified: !!deviceStatus?.isVerified(),
    recoverySetUp: !!defaultKeyId,
    identityExists: !!masterKeyId,
    identityKeysOnDevice: cached.masterKey && cached.selfSigningKey && cached.userSigningKey,
    backupVersion: backupInfo?.version ?? null,
    backupKeyOnDevice: !!backupKey,
  };
}

/**
 * Why a new recovery key can't be made on this device right now, or null if it can.
 * Making one re-encrypts the secrets this device holds, so it must hold all of them;
 * otherwise the ones it lacks would be left behind under the old key and effectively lost.
 */
export function whyCantMakeRecoveryKey(info: RecoveryInfo): string | null {
  if (info.identityExists && !info.identityKeysOnDevice) {
    return info.recoverySetUp
      ? "Unlock this device with your current Security Key first."
      : "Your account's encryption identity isn't available on this device. Verify this device from another signed-in session first.";
  }
  if (info.recoverySetUp && info.backupVersion && !info.backupKeyOnDevice) {
    return "Unlock this device with your current Security Key first.";
  }
  return null;
}

/** Generate a new recovery key locally. Nothing is sent to the server until {@link applyRecoveryKey}. */
export async function generateRecoveryKey(client: MatrixClient): Promise<GeneratedSecretStorageKey & { encodedPrivateKey: string }> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available");
  const key = await crypto.createRecoveryKeyFromPassphrase();
  if (!key.encodedPrivateKey) throw new Error("Could not generate a recovery key");
  return { ...key, encodedPrivateKey: key.encodedPrivateKey };
}

/** What the server needs before it accepts a new encryption identity (only for first-time setup). */
export type AuthRequest = { kind: "password" } | { kind: "browser"; url: string };
/** Resolve with the password (for "password"), or with anything once the user approved in the browser; null cancels. */
export type AuthPrompt = (req: AuthRequest) => Promise<string | null>;

const CROSS_SIGNING_RESET_STAGES = ["m.oauth", "org.matrix.cross_signing_reset"];

function makeAuthCallback(client: MatrixClient, prompt: AuthPrompt): UIAuthCallback<void> {
  return async (makeRequest) => {
    try {
      // Servers let an account upload its very first identity without re-authenticating.
      return await makeRequest(null);
    } catch (e) {
      if (!(e instanceof MatrixError) || e.httpStatus !== 401 || !e.data?.flows) throw e;
      const data = e.data as { session?: string; flows: { stages: string[] }[]; params?: Record<string, { url?: string }> };
      const stages = data.flows.map((f) => f.stages[0]);

      const browserStage = CROSS_SIGNING_RESET_STAGES.find((s) => stages.includes(s));
      const url = browserStage && data.params?.[browserStage]?.url;
      if (url) {
        const ok = await prompt({ kind: "browser", url });
        if (ok === null) throw new Error("Cancelled");
        // Once approved, the server accepts the upload without further authentication for a while.
        return await makeRequest(null);
      }
      if (stages.includes("m.login.password")) {
        const password = await prompt({ kind: "password" });
        if (password === null) throw new Error("Cancelled");
        const auth: AuthDict = {
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getSafeUserId() },
          password,
          session: data.session,
        };
        return await makeRequest(auth);
      }
      throw new Error("Your server needs a confirmation step MurmrChat doesn't support yet.");
    }
  };
}

/**
 * Store the account's secrets under `key` and make it the account's recovery key.
 *
 * - No recovery yet: creates the encryption identity if the account has none, keeps the existing
 *   key backup if this device has its key (or starts a new backup), and stores both under `key`.
 * - Recovery exists: re-encrypts the same secrets under `key`. The backup itself is untouched, so
 *   message history stays readable; the old key stops working.
 */
export async function applyRecoveryKey(
  client: MatrixClient,
  key: GeneratedSecretStorageKey,
  prompt: AuthPrompt,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available");
  const info = await getRecoveryInfo(client);
  const blocked = whyCantMakeRecoveryKey(info);
  if (blocked) throw new Error(blocked);

  await withSecretStorageKey(key.privateKey, async () => {
    if (!info.identityExists) {
      onProgress?.("Creating your encryption identity…");
      await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: makeAuthCallback(client, prompt) });
    }
    const newBackup = !info.backupVersion || !info.backupKeyOnDevice;
    onProgress?.(newBackup ? "Setting up key backup…" : "Saving your keys under the new recovery key…");
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => key,
      setupNewSecretStorage: true,
      setupNewKeyBackup: newBackup,
    });
    await crypto.checkKeyBackupAndEnable();

    // Every secret must now be readable with the new key; anything else would be silently lost.
    const status = await crypto.getSecretStorageStatus();
    const missing = Object.entries(status.secretStorageKeyValidityMap)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    if (!status.ready || missing.length) {
      throw new Error(`Some keys could not be saved under the new recovery key (${missing.join(", ") || "unknown"}). Keep your old key and try again.`);
    }
  });
}
