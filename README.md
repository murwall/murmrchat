# Matterix

A Mattermost-style desktop client for Matrix (Tauri + React + TypeScript + matrix-js-sdk).

## Run

```bash
npm install
npm run tauri dev      # development, with hot reload
npm run tauri build    # release build: .app and .dmg
```

Release output:

- `src-tauri/target/release/bundle/macos/Matterix.app`
- `src-tauri/target/release/bundle/dmg/Matterix_<version>_aarch64.dmg`

Install by dragging `Matterix.app` into `/Applications`. The app is ad-hoc signed (no Apple Developer ID),
so it runs on the machine that built it; to share it with others it needs Developer ID signing and notarization.

The dev build and the packaged app keep separate local data and separate keychain sessions, so each needs its own
sign-in (and Security Key unlock). Don't point both at the same session.

Diagnostics from the packaged app (CSP violations, uncaught errors) go to stderr:

```bash
/Applications/Matterix.app/Contents/MacOS/matterix
```

The icon source is `src-tauri/icons/icon-source.svg`; regenerate the icon set with `npm run tauri icon <1024px png>`.

## Concepts

| Mattermost        | Matrix             |
|-------------------|--------------------|
| Team              | Space (top-level)  |
| Channel           | Room               |
| Direct message    | DM room (`m.direct`) |
| Reply thread      | Thread (`m.thread`) |

Rooms not in any space appear under **Home**. DMs are shown in every team.

## Sign-in & encryption

- Servers with the new OAuth login (e.g. matrix.org) use "sign in with browser" (device code flow).
  Password login is available as a fallback.
- After signing in, click **Unlock** in the yellow banner and enter your Element Security Key or Phrase.
  This verifies the device and restores keys from your key backup so you can read encrypted history.

## Layout

- `src/matrix/`: session/login, client startup, crypto unlock, room/space helpers, encrypted media
- `src/components/`: TeamBar, Sidebar, ChannelView, MessageList/Message, ThreadPanel, Composer, SecurityBanner

## Features

- Teams (spaces), channels, DMs, favorites, unread/mention badges, invitations
- Threads: right-hand thread panel, per-channel thread list, and a global "Threads" view of threads you follow
- Messages: markdown, @mention autocomplete (with proper Matrix mentions), emoji picker and `:shortcode:` autocomplete,
  reactions, edit (↑ in an empty composer) and delete, replies, images (with viewer) and files, typing indicator
- File upload by button, drag-and-drop or paste; files are encrypted in encrypted rooms
- Members panel, profile cards (click any name/avatar), people search to start DMs
- Create channels and browse/join channels in a team (or the public directory on Home)
- Search: local index for encrypted rooms (built as messages arrive, plus a slow background history crawl),
  merged with server search for unencrypted rooms; supports `in:channel` and `from:@user`
- Desktop notifications following your push rules, Dock badge, remembered window size/position
- Session tokens in the macOS Keychain; the local encryption-key store is encrypted for logins made with this version

## Shortcuts

- `Alt+↑/↓`: previous/next channel
- `Ctrl+Alt+1..9`: switch team
- `Cmd/Ctrl+K`: quick switcher (jump to any channel, DM or person)
- `Cmd/Ctrl+F`: search messages
- `Cmd/Ctrl+Shift+T`: followed threads
- `↑` in empty composer: edit your last message
- `Esc`: close thread panel / cancel edit
