import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavContext, useClient, useClientTick, type Nav } from "../matrix/hooks";
import { openDm } from "../matrix/dm";
import { useNotifications } from "../matrix/notifications";
import { dmRoomIds, getTeams, HOME_TEAM, roomsInSpace, sidebarRooms } from "../matrix/rooms";
import { SearchIndex } from "../matrix/search";
import { ChannelView } from "./ChannelView";
import { BrowseChannelsDialog, CreateChannelDialog } from "./Channels";
import { GlobalThreads } from "./GlobalThreads";
import { BookmarkIcon, SearchIcon } from "./icons";
import { PinnedPanel, SavedPanel } from "./SavedPinned";
import { startStatus } from "../matrix/status";
import { MembersPanel, PeopleDialog, ProfileCard } from "./People";
import { QuickSwitcher } from "./QuickSwitcher";
import { SearchView } from "./SearchView";
import { SecurityBanner } from "./SecurityBanner";
import { Sidebar } from "./Sidebar";
import { TeamBar } from "./TeamBar";
import { ThreadListPanel, ThreadPanel } from "./ThreadPanel";
import { BrokenPanel, ErrorBoundary } from "./ErrorBoundary";

type RightPanel =
  | { kind: "thread"; rootId: string }
  | { kind: "threads" }
  | { kind: "members" }
  | { kind: "pinned" }
  | { kind: "saved" }
  | null;
type CenterView = { kind: "channel" } | { kind: "threads" } | { kind: "search"; query: string };
type Dialog = "people" | "create-channel" | "browse-channels" | "switcher" | null;

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function Shell({ onLogout }: { onLogout: () => void }) {
  const client = useClient();
  const tick = useClientTick();

  const [teamId, setTeamId] = useState<string>(() => loadPref("matterix.team", HOME_TEAM));
  // Remember the last channel per team, like Mattermost.
  const [lastRoomByTeam, setLastRoomByTeam] = useState<Record<string, string>>(() => loadPref("matterix.lastRooms", {}));
  const [right, setRight] = useState<RightPanel>(null);
  const [view, setView] = useState<CenterView>({ kind: "channel" });
  const [profile, setProfile] = useState<{ userId: string; pos: { x: number; y: number } } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  // A room we navigated to directly (e.g. a new DM) before it appears in the sidebar lists.
  const [forcedRoomId, setForcedRoomId] = useState<string | null>(null);
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Local search index for encrypted rooms (lives as long as the session).
  const searchIndex = useMemo(() => new SearchIndex(client), [client]);
  useEffect(() => {
    searchIndex.start();
    return () => searchIndex.stop();
  }, [searchIndex]);

  useEffect(() => localStorage.setItem("matterix.team", JSON.stringify(teamId)), [teamId]);
  useEffect(() => localStorage.setItem("matterix.lastRooms", JSON.stringify(lastRoomByTeam)), [lastRoomByTeam]);

  // If the stored team no longer exists, fall back to Home.
  const teams = getTeams(client);
  const effectiveTeam = teamId === HOME_TEAM || teams.some((t) => t.roomId === teamId) ? teamId : HOME_TEAM;

  const { channels, dms, favorites, categories } = sidebarRooms(client, effectiveTeam);
  const candidates = [...favorites, ...categories.flatMap((c) => c.rooms), ...channels, ...dms];
  const remembered = lastRoomByTeam[effectiveTeam];
  const roomId =
    forcedRoomId && client.getRoom(forcedRoomId)
      ? forcedRoomId
      : candidates.some((r) => r.roomId === remembered)
        ? remembered
        : (candidates[0]?.roomId ?? null);
  const room = roomId ? client.getRoom(roomId) : null;
  useNotifications(client, view.kind === "channel" ? roomId : null, tick);

  const selectRoom = useCallback(
    (id: string) => {
      setForcedRoomId(null);
      setFocusEventId(null);
      setView({ kind: "channel" });
      setLastRoomByTeam((m) => ({ ...m, [effectiveTeam]: id }));
      // Keep "list" panels open when switching channels; close per-message panels.
      setRight((r) => (r?.kind === "threads" || r?.kind === "members" || r?.kind === "pinned" || r?.kind === "saved" ? r : null));
    },
    [effectiveTeam],
  );

  /** Go to a room even if it belongs to another team. */
  const goToRoom = useCallback(
    (id: string) => {
      selectRoom(id);
      setForcedRoomId(id);
    },
    [selectRoom],
  );

  /** Jump to a room and switch to the team it belongs to (DMs stay in the current team). */
  const goToRoomInItsTeam = (id: string) => {
    if (dmRoomIds(client).has(id) || candidates.some((r) => r.roomId === id)) {
      selectRoom(id);
      return;
    }
    const team = getTeams(client).find((t) => roomsInSpace(client, t).has(id));
    const target = team?.roomId ?? HOME_TEAM;
    setTeamId(target);
    setForcedRoomId(null);
    setFocusEventId(null);
    setView({ kind: "channel" });
    setRight(null);
    setLastRoomByTeam((m) => ({ ...m, [target]: id }));
  };

  const nav: Nav = {
    openRoom: goToRoom,
    openDm: async (userId) => goToRoom(await openDm(client, userId)),
    showProfile: (userId, pos) => setProfile({ userId, pos }),
    jumpTo: (rid, eventId, threadId) => {
      goToRoomInItsTeam(rid);
      if (threadId) setRight({ kind: "thread", rootId: threadId });
      else setFocusEventId(eventId);
    },
  };

  // Availability / custom status / auto-away.
  useEffect(() => startStatus(client), [client]);

  const openThreadIn = (rid: string, rootId: string) => {
    goToRoom(rid);
    setRight({ kind: "thread", rootId });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && right && !document.querySelector(".modal-backdrop, .image-viewer")) setRight(null);
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && roomId) {
        e.preventDefault();
        const i = candidates.findIndex((r) => r.roomId === roomId);
        const next = candidates[(i + (e.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length];
        if (next) selectRoom(next.roomId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "switcher" ? null : "switcher"));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setView({ kind: "threads" });
      }
      if (e.ctrlKey && e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const target = idx === 0 ? HOME_TEAM : teams[idx - 1]?.roomId;
        if (target) setTeamId(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const team = effectiveTeam === HOME_TEAM ? null : client.getRoom(effectiveTeam);

  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        <SecurityBanner />
        <header className="global-header">
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = searchText.trim();
              if (q) {
                setView({ kind: "search", query: q });
                setRight(null);
              }
            }}
          >
            <SearchIcon />
            <input
              ref={searchRef}
              placeholder="Search messages (⌘F)"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchText("");
                  (e.target as HTMLInputElement).blur();
                  if (view.kind === "search") setView({ kind: "channel" });
                }
              }}
            />
          </form>
          <button
            className={`header-btn ${right?.kind === "saved" ? "active" : ""}`}
            title="Saved messages"
            onClick={() => {
              setView((v) => (v.kind === "channel" ? v : { kind: "channel" }));
              setRight((r) => (r?.kind === "saved" ? null : { kind: "saved" }));
            }}
          >
            <BookmarkIcon />
          </button>
        </header>
        <div className="layout">
          <TeamBar
            selected={effectiveTeam}
            onSelect={(id) => {
              setTeamId(id);
              setRight(null);
              setForcedRoomId(null);
              setView((v) => (v.kind === "threads" ? v : { kind: "channel" }));
            }}
          />
          <ErrorBoundary resetKeys={[effectiveTeam]} fallback={(error, reset) => <aside className="sidebar"><BrokenPanel error={error} reset={reset} what="the sidebar" /></aside>}>
          <Sidebar
            teamId={effectiveTeam}
            selectedRoomId={view.kind === "channel" ? roomId : null}
            onSelectRoom={selectRoom}
            onLogout={onLogout}
            onFindPeople={() => setDialog("people")}
            threadsActive={view.kind === "threads"}
            onShowThreads={() => {
              setView({ kind: "threads" });
              setRight(null);
            }}
            onCreateChannel={() => setDialog("create-channel")}
            onBrowseChannels={() => setDialog("browse-channels")}
          />
          </ErrorBoundary>
          <main className="center">
            <ErrorBoundary
              resetKeys={[roomId, view.kind]}
              fallback={(error, reset) => <BrokenPanel error={error} reset={reset} what="this view" />}
            >
            {view.kind === "threads" ? (
              <GlobalThreads onOpen={openThreadIn} />
            ) : view.kind === "search" ? (
              <SearchView
                index={searchIndex}
                query={view.query}
                onJump={(rid, eventId, threadId) => {
                  goToRoom(rid);
                  if (threadId) setRight({ kind: "thread", rootId: threadId });
                  else setFocusEventId(eventId);
                }}
              />
            ) : room ? (
              <ChannelView
                key={room.roomId}
                room={room}
                focusEventId={focusEventId}
                onClearFocus={() => setFocusEventId(null)}
                threadsOpen={right?.kind === "threads"}
                membersOpen={right?.kind === "members"}
                onShowMembers={() => setRight((r) => (r?.kind === "members" ? null : { kind: "members" }))}
                onOpenThread={(rootId) => setRight({ kind: "thread", rootId })}
                onShowThreads={() => setRight((r) => (r?.kind === "threads" ? null : { kind: "threads" }))}
                pinnedOpen={right?.kind === "pinned"}
                onShowPinned={() => setRight((r) => (r?.kind === "pinned" ? null : { kind: "pinned" }))}
              />
            ) : (
              <div className="empty-state muted">No channels in this team yet.</div>
            )}
            </ErrorBoundary>
          </main>
          <ErrorBoundary
            resetKeys={[roomId, right?.kind, right?.kind === "thread" ? right.rootId : null]}
            fallback={(error, reset) => (
              <aside className="right-panel">
                <BrokenPanel error={error} reset={reset} what="this panel" />
              </aside>
            )}
          >
          {room && view.kind === "channel" && right?.kind === "thread" && (
            <ThreadPanel key={right.rootId} room={room} rootId={right.rootId} onClose={() => setRight(null)} />
          )}
          {room && view.kind === "channel" && right?.kind === "threads" && (
            <ThreadListPanel room={room} onOpenThread={(rootId) => setRight({ kind: "thread", rootId })} onClose={() => setRight(null)} />
          )}
          {room && view.kind === "channel" && right?.kind === "members" && (
            <MembersPanel room={room} onClose={() => setRight(null)} />
          )}
          {room && view.kind === "channel" && right?.kind === "pinned" && <PinnedPanel room={room} onClose={() => setRight(null)} />}
          {right?.kind === "saved" && <SavedPanel onClose={() => setRight(null)} />}
          </ErrorBoundary>
        </div>
        {profile && <ProfileCard key={profile.userId} userId={profile.userId} pos={profile.pos} onClose={() => setProfile(null)} />}
        {dialog === "people" && <PeopleDialog onClose={() => setDialog(null)} />}
        {dialog === "switcher" && (
          <QuickSwitcher onClose={() => setDialog(null)} onOpenRoom={goToRoomInItsTeam} onOpenDm={(userId) => nav.openDm(userId)} />
        )}
        {dialog === "create-channel" && (
          <CreateChannelDialog space={team} onClose={() => setDialog(null)} onCreated={goToRoom} />
        )}
        {dialog === "browse-channels" && (
          <BrowseChannelsDialog space={team} onClose={() => setDialog(null)} onJoined={goToRoom} />
        )}
      </div>
    </NavContext.Provider>
  );
}
