# clipboard-tool

Cross-platform clipboard manager built with Tauri 2.0 + Rust + React + TypeScript.

## Stack

- **Backend**: Rust via Tauri 2.0, SQLite via `sqlx` (runtime queries, no macros)
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4
- **Storage**: SQLite — always starts from a fresh schema (`create_fresh_schema`). Delete `clipboard.db` to reset. Versioned migrations will be added before v1.0.
- **Package manager**: npm

## Rust Crates

| Crate | Purpose |
|-------|---------|
| `arboard` | Read/write system clipboard |
| `sqlx` | SQLite async queries |
| `regex` | Content classification rules |
| `tokio` | Async runtime + timer for flush tasks |
| `tauri-plugin-opener` | Open URLs/emails in system browser/client |
| `tauri-plugin-autostart` | Launch at system startup (`--minimized`) |
| `tauri-plugin-global-shortcut` | Global hotkey to show/hide window |
| `tauri-plugin-clipboard-manager` | Clipboard capability (capabilities JSON) |

## Frontend Dependencies

| Package | Purpose |
|---------|---------|
| `highlight.js` | Syntax highlighting for code entries in DetailPanel |
| `@tauri-apps/plugin-opener` | Open URLs/emails from React |

## Project Structure

```
clipboard-tool/
├── src/
│   ├── components/
│   │   ├── CategoriesManager.tsx  # CRUD for categories + context rules (settings tab)
│   │   ├── CollectionSelector.tsx # Chip + dropdown to assign entry to collections
│   │   ├── CollectionsManager.tsx # CRUD for collections (settings tab)
│   │   ├── ContentRenderer.tsx    # Renders content by type (url/email/phone/color/code/text)
│   │   ├── ContentTypesManager.tsx# CRUD for content types + detection rules (settings tab)
│   │   ├── DetailPanel.tsx        # Right panel: full content + metadata + collection chips
│   │   ├── EntryItem.tsx          # List row with line-clamp-2 preview
│   │   ├── EntryList.tsx          # Virtualized entry list
│   │   ├── FilterPanel.tsx        # Collapsible filter dropdown (type/app/category/window)
│   │   ├── SearchBar.tsx          # Search input + FilterPanel
│   │   ├── SettingsPanel.tsx      # Tabbed settings (Appearance/Content Types/Categories/Collections/Behavior)
│   │   ├── TypeaheadSelect.tsx    # Reusable searchable dropdown
│   │   └── WindowControls.tsx     # OS-specific window buttons (macOS/Windows/Linux)
│   ├── hooks/
│   │   ├── useClipboard.ts        # Entries state, filters, realtime listener
│   │   ├── useCollections.ts      # Collections + entry counts; refreshCounts()
│   │   ├── useContentTypes.ts     # Loads content_types from DB (colors + labels)
│   │   ├── useTheme.ts            # Theme list, active theme, CSS variable application
│   │   └── useOS.ts               # OS detection via navigator.userAgent (evaluated once)
│   ├── types.ts                   # ClipboardEntry, ContentTypeStyle, Category, ContextRule, ContentRule, Collection, Setting, Theme
│   └── App.tsx                    # Root layout, resizable detail panel (50%/75% max)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                 # App setup, plugin registration, window events
│   │   ├── commands.rs            # All Tauri commands
│   │   ├── db.rs                  # Schema creation, seed data, all DB query functions
│   │   ├── clipboard.rs           # Clipboard watcher thread + AppCopiedContent state
│   │   ├── categorizer.rs         # DB-driven content classification (context + content rules)
│   │   └── window_state.rs        # Window position/size persistence with 600ms debounce + initialized flag
│   ├── capabilities/default.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tsconfig.json                  # target: ES2021 (needed for replaceAll)
└── CLAUDE.md
```

## Key Architecture Decisions

- **Clipboard watcher**: dedicated Rust thread polling `arboard` every ~500ms
- **Self-copy prevention**: `AppCopiedContent(Arc<Mutex<Option<String>>>)` — set before writing, consumed once by watcher
- **Content classification**: DB-driven rules (`context_rules` + `content_type_rules` tables), compiled at startup, refreshed on mutation via `RulesCache`. Max bytes configurable via `content_analysis_max_bytes` setting
- **Window state persistence**: `window_state.rs` saves x/y/width/height with trailing-edge 600ms debounce. `WindowSaveState` has an `initialized: AtomicBool` flag — events are ignored until the user first opens the window (prevents startup X11 resize events from overwriting saved DB values with Tauri config defaults)
- **Panel width**: saved to `detail_panel_width`. Clamped to 50% max when window < 700px, 75% otherwise. Min 180px. `ResizeObserver` ignores `width === 0` events (container unmount when settings open) to prevent reset
- **Collections**: junction table `entry_collections`. Builtin "Favorites" collection (`is_builtin = 1`) replaces the old `is_favorite` column. `get_collection_counts` queries the junction table grouped by `collection_id`
- **is_builtin flag**: all user-created records (categories, content types, context rules, content type rules) are inserted with `is_builtin = 0` explicitly. Delete guards use `AND is_builtin = 0`. Seed data uses `is_builtin = 1`
- **DB schema**: no migrations — always `create_fresh_schema()` on startup. Seed order matters: `categories` and `content_types` must be seeded before their FK-dependent rule tables

## DB Schema (current)

```sql
categories         -- id, name, color, is_builtin, created_at
content_types      -- name (PK), label, color, is_builtin, created_at
entries            -- id, content, content_type→content_types, category_id→categories, source_app, window_title, created_at
collections        -- id, name, color, is_builtin, created_at
entry_collections  -- entry_id→entries, collection_id→collections  (junction, CASCADE delete)
context_rules      -- id, category_id→categories, source_app_pattern, window_title_pattern, priority, enabled, is_builtin
content_type_rules -- id, content_type→content_types, pattern, min_hits, priority, enabled, is_builtin
settings           -- key (PK), value, updated_at
themes             -- slug (PK), name, base, surface, surface_raised, surface_active, stroke, stroke_strong, content, content_2, content_3, accent, accent_text, is_builtin
```

### Key settings keys
| Key | Default | Purpose |
|-----|---------|---------|
| `content_analysis_max_bytes` | `8192` | Max bytes analyzed for classification |
| `detail_panel_width` | `320` | Saved panel width (px) |
| `active_theme` | `midnight` | Active theme slug |
| `page_size` | `50` | Entries loaded per page |
| `max_history_entries` | `0` | Auto-prune limit (0 = unlimited) |
| `retention_days` | `0` | Auto-delete entries older than N days (0 = never) |
| `window_x/y/width/height` | centered | Window position/size persistence |

## Settings Panel Tabs

| Tab | Content |
|-----|---------|
| Appearance | Theme selector |
| Content Types | `ContentTypesManager` — CRUD for types + detection rules; color editable inline when expanded |
| Categories | `CategoriesManager` — CRUD for categories + context rules; color editable inline when expanded |
| Collections | `CollectionsManager` — CRUD for collections |
| Behavior | Page size, max history entries, retention days, max bytes to analyze |

## Tauri Commands

```rust
// Entries
get_entries(search, source_app, category_id, content_type, window_title, collection_id, favorites_only, limit, offset)
delete_entry(id)
toggle_favorite(id)
get_entry_counts()                 // → (all, favorites)
get_apps()
get_window_titles()
copy_to_clipboard(content)         // sets AppCopiedContent → watcher skips it
write_clipboard_raw(content)       // writes directly → watcher records it

// Collections
get_collections()
create_collection(name, color)
update_collection(id, name, color)
delete_collection(id)
get_collection_counts()            // → [(collection_id, count)]
get_entry_collection_ids(entry_id) // → [collection_id]
set_entry_collections(entry_id, collection_ids)

// Content types
get_content_types()
update_content_type_color(name, color)
create_content_type(name, label, color)
delete_content_type(name)
get_all_content_type_rules()
create_content_type_rule(content_type, pattern, min_hits, priority)
delete_content_type_rule(id)

// Categories
get_categories()
get_all_categories()
create_category(name, color)
update_category(id, name, color)
delete_category(id)
get_all_context_rules()
create_context_rule(category_id, source_app_pattern, window_title_pattern, priority)
delete_context_rule(id)

// Settings & themes
get_settings()
update_setting(key, value)
get_themes()
set_active_theme(slug)
```

## Content Types & Rendering

| Type | Renderer |
|------|----------|
| `text` | Plain monospace pre |
| `url` | Clickable link + "Open in browser" button (`openUrl`) |
| `email` | Email display + "Open email client" button (`mailto:`) |
| `phone` | Phone icon + large monospace number |
| `color` | Full-width color swatch + hex value |
| `code` | `highlight.js` syntax highlighting (auto-detect, inline dark theme) |

## Filter System

Filters are in a collapsible panel behind the "Filters" button in SearchBar:
- **Type** — content_type exact match
- **App** — source_app exact match
- **Category** — category exact match
- **Window** — window_title exact match

All filter options are loaded from DB (distinct values). Each uses `TypeaheadSelect` (searchable dropdown).

## Platform Notes

- **Linux (primary dev)**: X11. Global shortcut and clipboard polling work. Tray right-click for menu.
- **macOS**: Window controls (traffic lights) on the left. Untested beyond UI.
- **Windows**: Window controls (flat Fluent style) on the right. Untested.
- **Wayland**: May have limitations with global hotkeys and clipboard polling.

## Development

```bash
npm install
npm run tauri dev     # dev with hot-reload
npm run tauri build   # production build
npm run build         # frontend only (type check + vite)
```

## Repository

GitLab: https://gitlab.com/niconi21/clipboard-tool

## Priorities

1. Optimization and performance (Rust backend, minimal overhead)
2. Presentation quality (native feel)
3. Local-only (no server sync for now)
