import type { MatrixClient } from "matrix-js-sdk";
import { CATEGORIES_TYPE } from "./categories";
import { SAVED_TYPE } from "./saved";
import { MY_PREFS, STATUS_FIELD } from "./status";

/**
 * One-time migration from the app's earlier name ("Matterix"), whose account data and profile
 * fields used the io.matterix.* namespace. Copies are only made when the new key doesn't exist
 * yet; the old keys are left in place (harmless, and an old install may still be using them).
 */
const LEGACY_ACCOUNT_DATA: Record<string, string> = {
  "io.matterix.saved": SAVED_TYPE,
  "io.matterix.categories": CATEGORIES_TYPE,
  "io.matterix.availability": MY_PREFS,
};
const LEGACY_STATUS_FIELD = "io.matterix.status";

export async function migrateLegacyData(client: MatrixClient): Promise<void> {
  for (const [oldType, newType] of Object.entries(LEGACY_ACCOUNT_DATA)) {
    try {
      if (client.getAccountData(newType as never)) continue;
      const old = client.getAccountData(oldType as never)?.getContent();
      if (old && Object.keys(old).length) await client.setAccountData(newType as never, old as never);
    } catch (e) {
      console.warn(`Could not migrate ${oldType}`, e);
    }
  }

  try {
    const me = client.getSafeUserId();
    const current = await client.getExtendedProfileProperty(me, STATUS_FIELD).catch(() => undefined);
    if (current === undefined || current === null) {
      const old = await client.getExtendedProfileProperty(me, LEGACY_STATUS_FIELD).catch(() => undefined);
      if (old && typeof old === "object") await client.setExtendedProfileProperty(STATUS_FIELD, old);
    }
  } catch (e) {
    console.warn("Could not migrate custom status", e);
  }
}
