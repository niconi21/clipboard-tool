# clipboard-tool

A fast, local-only clipboard manager for Linux, macOS and Windows — built with Tauri 2.0, Rust and React.

No cloud sync, no telemetry. Everything stays on your machine in a local SQLite database.

---

## Features

- **Clipboard history** — automatically captures everything you copy, searchable in real time
- **Content type detection** — regex-based rules classify entries as URL, email, phone number, color, code snippet, JSON, SQL, shell, markdown or plain text
- **Syntax highlighting** — code entries are highlighted via highlight.js with auto language detection
- **Categories** — assign entries to categories based on source app and/or window title patterns
- **Collections** — organize entries into named groups; entries in a collection are never auto-deleted
- **Subcollections** — each collection shows an entry count; "Uncategorized" subcollection hides automatically when empty
- **Favorites** — built-in collection, entries are never pruned
- **Drag & drop** — drag entries onto collection tabs or subcollection rows to assign or move them instantly
- **Filters** — filter history by content type, source app, category or window title
- **Themes** — multiple built-in color palettes (including a Light theme), switchable at runtime
- **Theme editor** — customize any theme's colors with a live color picker; changes apply instantly and auto-save with debounce
- **Font configuration** — choose font family and size from Settings > Appearance
- **Internationalization** — UI available in English and Spanish (Mexico); more languages can be added by dropping a locale file
- **Global hotkey** — show/hide the window from anywhere on the desktop
- **Auto-start** — optionally launch at system startup (minimized)
- **Pause monitoring** — temporarily stop capturing clipboard entries (5/10/15 min or indefinitely) from the tray menu or Settings > Behavior; countdown banner shown in the UI with a Resume button
- **Clear history** — bulk-delete all entries not assigned to any collection from Settings > Behavior
- **Behavior controls** — configurable page size, max history, retention days, and max bytes analyzed per entry
- **Onboarding tutorial** — interactive spotlight walkthrough on first launch; re-accessible from Settings > About

---

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2.0](https://tauri.app) |
| Backend | Rust — async with Tokio |
| Database | SQLite via `sqlx` (runtime queries, no macros) |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| i18n | i18next + react-i18next |
| Syntax highlighting | highlight.js |

---

## Requirements

| Tool | Minimum version |
|------|----------------|
| Rust + Cargo | 1.77 |
| Node.js | 20 |
| npm | 10 |
| Linux system deps | `libwebkit2gtk-4.1`, `libxdo`, `libayatana-appindicator3` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/)) |

---

## Getting started

```bash
# 1. Clone
git clone https://github.com/niconi21/clipboard-tool.git
cd clipboard-tool

# 2. Install JS dependencies
npm install

# 3. Run in development mode (hot-reload)
npm run tauri dev

# 4. Build a production binary
npm run tauri build
```

The SQLite database is created automatically on first launch at the platform default data directory (`~/.local/share/com.clipboard-tool.app/clipboard.db` on Linux). Delete it to reset all data.

---

## Project structure

```
clipboard-tool/
├── src/                        # React + TypeScript frontend
│   ├── components/             # UI components
│   ├── hooks/                  # Custom React hooks
│   ├── locales/                # i18n locale files (en.json, es-MX.json)
│   ├── utils/                  # Utility functions
│   ├── types.ts                # Shared TypeScript types
│   ├── i18n.ts                 # i18next configuration
│   └── App.tsx                 # Root layout
└── src-tauri/                  # Rust backend
    ├── src/
    │   ├── lib.rs              # App setup & plugin registration
    │   ├── commands.rs         # Tauri IPC commands
    │   ├── db.rs               # Schema, seed data, all DB queries
    │   ├── clipboard.rs        # Clipboard watcher thread
    │   ├── categorizer.rs      # Content classification engine
    │   └── window_state.rs     # Window position/size persistence
    ├── capabilities/
    └── tauri.conf.json
```

---

## Adding a language

1. Create `src/locales/<bcp47-code>.json` based on `src/locales/en.json`
2. Import and register it in `src/i18n.ts`
3. Add a row to the `languages` table seed in `src-tauri/src/db.rs`

---

## Platform notes

| Platform | Status |
|----------|--------|
| Linux (X11) | Primary development target — fully working |
| Linux (Wayland) | Global hotkey and clipboard polling may have limitations |
| Windows | UI adapted (Fluent window controls) — untested |
| macOS | Not supported — see [clipboard-tool-macos](https://github.com/niconi21/clipboard-tool-macos) for the native macOS app |

---

## License

MIT
