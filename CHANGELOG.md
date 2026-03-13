# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- feat(#2): optional alias for clipboard entries — inline editable field in DetailPanel header; alias shown in bold above content preview in list; searchable alongside content and window title
- feat(#9): collection chips shown directly on entry list rows — colored badges for each non-builtin collection the entry belongs to
- feat(#25): improved content type detection — JSON raises min\_hits to 3 with typed-value and comma-key patterns; SQL gains GROUP/ORDER BY, JOIN variants, and comment patterns; Shell adds command substitution and UPPERCASE variable assignment; Code adds decorator and OOP modifier patterns; Markdown adds table row, horizontal rule, and image patterns
- feat(#26): Markdown preview renderer in DetailPanel — rendered HTML view with Preview/Source toggle, sanitized output, links open in system browser
- feat(#3): auto-assign entries to collections via rules — DB-driven collection_rules with regex matching on content type, source app, window title, and content pattern; AND logic within a rule, OR across rules; full CRUD in Settings > Collections with inline toggle/delete; rules compiled in RulesCache and evaluated on every new clipboard entry

### Fixed
- fix(#21): app version in footer and About tab now read dynamically via `getVersion()` — no longer hardcoded
- fix(#22): theme selection indicator (checkmark + border) now updates immediately when switching themes in the Appearance tab
- fix(#23): tray menu label now toggles correctly between Open/Close when hiding the window via the custom close button
- fix(#24): tray menu labels now respect the app language setting — updated at startup and in real time when the language is changed

## [1.1.0] - 2026-03-12

### Added
- feat(#6): lazy-load `highlight.js` via dynamic import — initial JS bundle reduced 73% (1.3 MB → 358 KB)

### Fixed
- fix(#5): remove declarative `trayIcon` config to prevent duplicate tray icon on Windows
- fix(#10): add publisher metadata to `tauri.conf.json` to resolve Windows SmartScreen / antivirus warning
- fix(#11): double-click on title bar now correctly maximizes/restores the window

### Performance
- fix(#7): adaptive clipboard polling — 500ms when window visible, 2000ms when hidden (4x fewer idle wake-ups)
- fix(#7): add `idx_entries_created_at` index on `entries` table for faster `get_entries` queries
- feat(#6): release profile optimizations — `strip`, `lto`, `opt-level = "z"`, `codegen-units = 1`, `panic = "abort"` — installer reduced 53% (7.8 MB → 3.7 MB `.deb`)

## [1.0.0] - 2026-03-07

### Added
- Initial release: clipboard manager built with Tauri 2.0 + Rust + React + TypeScript
- Clipboard history with SQLite storage
- Content type detection (url, email, phone, color, code, json, sql, shell, markdown, text)
- DB-driven categorization via context rules (source app + window title patterns)
- Collections system with junction table (`entry_collections`), including built-in Favorites
- Syntax highlighting for code entries via `highlight.js`
- Theme system with multiple built-in themes (CSS variables)
- i18n support: English and Spanish (es-MX)
- Resizable detail panel with persistence
- Window position/size persistence with debounced save
- Self-copy prevention (`AppCopiedContent` mutex)
- Global hotkey to show/hide window
- Launch at startup via `tauri-plugin-autostart`
- Dev/prod isolation via `XDG_DATA_HOME=/tmp/clipboard-test`
- GitHub Actions release workflow (Linux `.deb`/`.rpm`, macOS `.dmg`, Windows `.msi`/NSIS)
