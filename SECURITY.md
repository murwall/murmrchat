# Security policy

MurmrChat is an end-to-end encrypted chat client, so security reports are very welcome.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead, either:

- use GitHub's [private vulnerability reporting](https://github.com/murwall/murmrchat/security/advisories/new), or
- email **forge@murwall.se** with "MurmrChat security" in the subject.

Please include what you found, how to reproduce it, and the version/platform. You'll get an acknowledgement
as soon as possible; this is a small personal project, so please allow some time for a fix.

## Scope

In scope: the MurmrChat app itself (this repository), e.g. message rendering/HTML sanitization, handling of
attachments, local storage of sessions/keys/search index, the Tauri configuration and native commands.

Out of scope: vulnerabilities in Matrix homeservers, in the Matrix protocol itself, or in upstream libraries
(matrix-js-sdk, matrix-sdk-crypto, Tauri, …) — please report those to the respective projects (feel free to
let us know as well, so the dependency can be updated).

## Supported versions

Only the latest release receives fixes.

## Security model, in short

- Encryption is provided by the Matrix Rust crypto SDK (`matrix-sdk-crypto` via `matrix-js-sdk`).
- Session tokens are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux).
- The local encryption-key store and the local search index are encrypted at rest with a per-session key kept in the keychain.
- Incoming HTML is sanitized with DOMPurify; the webview runs with a strict Content-Security-Policy.
