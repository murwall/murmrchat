import type { MatrixClient } from "matrix-js-sdk";

/**
 * Custom sidebar categories, per team (like Mattermost). Stored in account data so they
 * sync across your Matterix installs. Favorites stays the standard m.favourite room tag.
 */

export const CATEGORIES_TYPE = "io.matterix.categories";

export interface Category {
  id: string;
  name: string;
  roomIds: string[];
  collapsed?: boolean;
}

type Store = { teams: Record<string, Category[]> };

function read(client: MatrixClient): Store {
  const c = client.getAccountData(CATEGORIES_TYPE as never)?.getContent() as Store | undefined;
  return c?.teams ? c : { teams: {} };
}

async function write(client: MatrixClient, store: Store) {
  await client.setAccountData(CATEGORIES_TYPE as never, store as never);
}

export function getCategories(client: MatrixClient, teamId: string): Category[] {
  return read(client).teams[teamId] ?? [];
}

async function update(client: MatrixClient, teamId: string, fn: (cats: Category[]) => Category[]) {
  const store = read(client);
  store.teams = { ...store.teams, [teamId]: fn([...(store.teams[teamId] ?? [])].map((c) => ({ ...c, roomIds: [...c.roomIds] }))) };
  await write(client, store);
}

export async function createCategory(client: MatrixClient, teamId: string, name: string, firstRoomId?: string) {
  const id = `c${Date.now().toString(36)}`;
  await update(client, teamId, (cats) => [
    ...cats.map((c) => ({ ...c, roomIds: c.roomIds.filter((r) => r !== firstRoomId) })),
    { id, name, roomIds: firstRoomId ? [firstRoomId] : [] },
  ]);
  return id;
}

export async function renameCategory(client: MatrixClient, teamId: string, id: string, name: string) {
  await update(client, teamId, (cats) => cats.map((c) => (c.id === id ? { ...c, name } : c)));
}

/** Deleting a category moves its channels back to "Channels". */
export async function deleteCategory(client: MatrixClient, teamId: string, id: string) {
  await update(client, teamId, (cats) => cats.filter((c) => c.id !== id));
}

export async function moveCategory(client: MatrixClient, teamId: string, id: string, delta: -1 | 1) {
  await update(client, teamId, (cats) => {
    const i = cats.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cats.length) return cats;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    return cats;
  });
}

export async function setCategoryCollapsed(client: MatrixClient, teamId: string, id: string, collapsed: boolean) {
  await update(client, teamId, (cats) => cats.map((c) => (c.id === id ? { ...c, collapsed } : c)));
}

/** Put a room into a category (or null = back to the default Channels/DMs section). */
export async function moveRoomToCategory(client: MatrixClient, teamId: string, roomId: string, categoryId: string | null) {
  await update(client, teamId, (cats) =>
    cats.map((c) => ({
      ...c,
      roomIds: c.id === categoryId ? [...c.roomIds.filter((r) => r !== roomId), roomId] : c.roomIds.filter((r) => r !== roomId),
    })),
  );
}
