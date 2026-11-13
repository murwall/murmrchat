# MurmrChat

A desktop chat client for [Matrix](https://matrix.org) with a familiar team-chat layout: teams in a bar on
the left, channels and direct messages in a sidebar, threads in a panel on the right.

If you like how Mattermost works but your team is on Matrix, MurmrChat aims to feel at home.

> **Status: early.** MurmrChat is a young personal project. It works for daily use, but expect rough edges,
> and there are no automated tests yet. Bug reports and pull requests are welcome.
>
> MurmrChat is an independent project and is not affiliated with Mattermost, Inc., Element or the
> Matrix.org Foundation.

## Features

- **Teams, channels, DMs.** Matrix spaces appear as teams. Favorites and your own sidebar categories
  (drag and drop) are supported, along with unread and mention badges and invitations.
- **Threads.** A reply panel on the right, a per-channel thread list, and a "Threads" view of everything
  you follow.
- **Messages.** Markdown, @mention autocomplete, an emoji picker and `:shortcode:` autocomplete,
  reactions, replies, editing (↑ in an empty composer) and deleting, a typing indicator, and images and
  files (button, drag and drop, or paste).
- **End-to-end encryption.** Built on the Matrix Rust crypto SDK. Unlock your history with your Security
  Key or Phrase. Messages show a warning when their authenticity can't be confirmed.
- **Search.** A local, encrypted index of your encrypted rooms, plus server search for unencrypted rooms,
  with `in:channel` and `from:@user` filters.
- **People.** Member lists, profile cards and people search to start DMs. Optional custom status
  (emoji + text + "clear after"), and online / away / do-not-disturb where your server shares presence.
- **Saved and pinned messages.** Saved messages are a private bookmark list. Pins are shared with the
  channel and are the same pins Element shows.
- **Notifications.** Desktop notifications follow your Matrix push rules, with per-channel settings
  (all / mentions / mute). Unread state shows in the Dock (macOS), on the taskbar and in the tray
  (Windows), or in the tray and launcher (Linux).
- **Quick switcher** (⌘K / Ctrl+K) to jump to any channel, DM or person.
- **Keeps running when closed**, so you keep getting notifications.

## Install

Download the installer for your system from the
[latest release](https://github.com/murwall/murmrchat/releases/latest).

The builds are **not signed** with an Apple Developer ID or a Windows code-signing certificate, so your
system will warn you the first time:

- **macOS** (`.dmg`, Intel and Apple Silicon): drag MurmrChat to Applications. The first time, macOS will
  refuse to open it. Go to **System Settings → Privacy & Security** and click **Open Anyway**. If macOS says
  the app "is damaged", run `xattr -dr com.apple.quarantine /Applications/MurmrChat.app`.
- **Windows** (`.exe` installer or `.msi`): if SmartScreen shows "Windows protected your PC", click
  **More info → Run anyway**.
- **Linux**: install the `.deb` (Debian, Ubuntu) or `.rpm` (Fedora), or make the `.AppImage` executable
  (`chmod +x`) and run it. MurmrChat stores its session with the Secret Service (GNOME Keyring or KWallet),
  so one of those needs to be running. On GNOME, the tray icon needs the *AppIndicator* extension. Without
  it, closing the window minimizes MurmrChat instead.

## Signing in

1. Enter your server (for example `matrix.org`) or your Matrix ID.
2. On servers that use the new Matrix login (such as matrix.org), your browser opens. Approve MurmrChat
   there. Password login is available as a fallback.
3. To read older encrypted messages, click **Unlock** and enter your Security Key or Security Phrase (the
   one you set up in Element).

## Build from source

Requirements:

- Node.js 22 or newer and Rust (stable).
- The Tauri prerequisites for your OS:
  - macOS: Xcode Command Line Tools.
  - Windows: the MSVC build tools and WebView2.
  - Linux: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev`.

```bash
npm ci
npm run tauri dev      # run in development, with hot reload
npm run tauri build    # build installers for the current OS (src-tauri/target/release/bundle/)
```

The development build and an installed app keep separate local data and sessions, so each one needs its
own sign-in.

Diagnostics from an installed build (blocked by the security policy, uncaught errors) are written to
stderr, so start the binary from a terminal to see them:

- macOS: `/Applications/MurmrChat.app/Contents/MacOS/murmrchat`
- Linux: `murmrchat`
- Windows: start the `.exe` from a terminal.

### Releasing

1. Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** workflow builds macOS, Windows and Linux installers and attaches them to a **draft**
   release. Review it on GitHub and click **Publish**.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘K / Ctrl+K | Quick switcher |
| ⌘F / Ctrl+F | Search messages |
| ⌘⇧T / Ctrl+Shift+T | Followed threads |
| Alt+↑ / Alt+↓ | Previous / next channel |
| Ctrl+Alt+1…9 | Switch team |
| ↑ in an empty message box | Edit your last message |
| Esc | Close a panel, or cancel an edit |
| ⌘R / Ctrl+R | Reload the window |

## Project layout

- `src/matrix/`: Matrix logic (login, sync and crypto, rooms and spaces, search index, status,
  notifications, encrypted media).
- `src/components/`: the React UI.
- `src-tauri/`: the native shell (Tauri): keychain access, tray, window behaviour, packaging.

## Security

See [SECURITY.md](SECURITY.md) to report vulnerabilities privately.

## License

[Apache License 2.0](LICENSE). Copyright © 2026 Marcus Murwall.
