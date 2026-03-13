use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use std::collections::HashMap;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

// ── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct ClipboardEntry {
    pub id: i64,
    pub content: String,
    pub content_type: String,
    pub category: String, // COALESCE(cat.name, 'other') via LEFT JOIN
    pub source_app: Option<String>,
    pub window_title: Option<String>,
    pub is_favorite: bool, // computed: EXISTS in entry_collections for builtin collection
    pub created_at: String,
    pub collection_ids: String,   // COALESCE(GROUP_CONCAT(DISTINCT collection_id), '')
    pub alias: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub is_builtin: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub is_builtin: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Subcollection {
    pub id: i64,
    pub collection_id: i64,
    pub name: String,
    pub is_default: bool,
    pub created_at: String,
}

/// Context-based rule: matches on source_app / window_title to assign a category.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct ContextRule {
    pub id: i64,
    pub category_id: Option<i64>,
    pub category_name: String, // COALESCE(cat.name, 'unknown') via LEFT JOIN
    pub source_app_pattern: Option<String>,
    pub window_title_pattern: Option<String>,
    pub priority: i64,
    pub enabled: bool,
    pub is_builtin: bool,
    pub created_at: String,
}

/// Display style for a content_type (name, human label, hex color).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct ContentTypeStyle {
    pub name: String,
    pub label: String,
    pub color: String, // hex, e.g. "#3b82f6"
    pub is_builtin: bool,
}

/// Application setting (key-value).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

/// Content-based rule: matches on clipboard text to assign a content_type.
/// All enabled rules sharing the same `content_type` form a group; the type
/// is assigned when at least `min_hits` patterns in the group match.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct ContentRule {
    pub id: i64,
    pub content_type: String,
    pub pattern: String,
    pub min_hits: i64,
    pub priority: i64,
    pub enabled: bool,
    pub is_builtin: bool,
    pub created_at: String,
}

/// Collection auto-assignment rule: matches conditions to auto-add entries to a collection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct CollectionRule {
    pub id: i64,
    pub collection_id: i64,
    pub collection_name: String, // via LEFT JOIN collections
    pub content_type: Option<String>,
    pub source_app: Option<String>,
    pub window_title: Option<String>,
    pub content_pattern: Option<String>,
    pub priority: i64,
    pub enabled: bool,
    pub is_builtin: bool,
    pub created_at: String,
}

/// Lightweight version for the categorizer (no display fields).
#[derive(Debug, Clone)]
pub struct CollectionRuleRaw {
    pub collection_id: i64,
    pub content_type: Option<String>,
    pub source_app: Option<String>,
    pub window_title: Option<String>,
    pub content_pattern: Option<String>,
}

pub struct DbState(pub SqlitePool);

#[derive(Debug, serde::Serialize)]
pub struct BootstrapData {
    pub settings:          Vec<Setting>,
    pub themes:            Vec<Theme>,
    pub content_types:     Vec<ContentTypeStyle>,
    pub collections:       Vec<Collection>,
    pub collection_counts: Vec<(i64, i64)>,
    pub subcollections:    Vec<Subcollection>,
    pub languages:         Vec<Language>,
    pub entry_counts:      (i64, i64),
}

/// Available UI language (BCP 47 code).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Language {
    pub code:        String, // BCP 47, e.g. "en", "es-MX"
    pub name:        String, // English name, e.g. "English", "Spanish (Mexico)"
    pub native_name: String, // Native name, e.g. "English", "Español (México)"
    pub is_active:   bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, FromRow)]
pub struct Theme {
    pub slug:           String,
    pub name:           String,
    pub base:           String,
    pub surface:        String,
    pub surface_raised: String,
    pub surface_active: String,
    pub stroke:         String,
    pub stroke_strong:  String,
    pub content:        String,
    pub content_2:      String,
    pub content_3:      String,
    pub accent:         String,
    pub accent_text:    String,
    pub is_builtin:     bool,
}

// ── Init ─────────────────────────────────────────────────────────────────────

pub async fn init_pool(app: &AppHandle) -> Result<SqlitePool, sqlx::Error> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    std::fs::create_dir_all(&data_dir)
        .map_err(|e| sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    std::fs::create_dir_all(data_dir.join("images"))
        .map_err(|e| sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

    let db_file = data_dir.join("clipboard.db");

    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_file.display()))
        .map_err(|e| sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    run_migrations(&pool).await?;

    Ok(pool)
}

/// Subquery that computes is_favorite from entry_collections (used in SELECT).
/// Must be used with `entries` in scope (references `entries.id`).
pub const IS_FAVORITE_SQL: &str = "EXISTS(
    SELECT 1 FROM entry_collections ec
    JOIN collections c ON ec.collection_id = c.id
    WHERE ec.entry_id = entries.id AND c.is_builtin = 1
)";

// ── Migrations ────────────────────────────────────────────────────────────────

/// Swallows "duplicate column name" errors from ALTER TABLE ADD COLUMN.
/// Any other error is propagated.
fn ignore_duplicate_column(
    result: Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error>,
) -> Result<(), sqlx::Error> {
    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(ref e)) if e.message().contains("duplicate column name") => {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    create_fresh_schema(pool).await?;

    // Idempotent column additions for existing databases.
    // "duplicate column name" error means it's already there — safe to ignore.
    ignore_duplicate_column(
        sqlx::query("ALTER TABLE entries ADD COLUMN alias TEXT")
            .execute(pool)
            .await,
    )?;

    // Subcollections: add subcollection_id column to entry_collections (existing DBs)
    ignore_duplicate_column(
        sqlx::query("ALTER TABLE entry_collections ADD COLUMN subcollection_id INTEGER REFERENCES subcollections(id)")
            .execute(pool)
            .await,
    )?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ec_subcollection ON entry_collections(subcollection_id)")
        .execute(pool)
        .await?;

    // Seed default subcollection for every collection that doesn't have one yet
    sqlx::query(
        "INSERT OR IGNORE INTO subcollections (collection_id, name, is_default)
         SELECT id, 'Sin clasificar', 1 FROM collections
         WHERE id NOT IN (SELECT collection_id FROM subcollections WHERE is_default = 1)"
    )
    .execute(pool)
    .await?;

    // Backfill: assign default subcollection to entry_collections rows missing one
    sqlx::query(
        "UPDATE entry_collections SET subcollection_id = (
            SELECT s.id FROM subcollections s
            WHERE s.collection_id = entry_collections.collection_id AND s.is_default = 1
        ) WHERE subcollection_id IS NULL"
    )
    .execute(pool)
    .await?;

    // FK dependency order:
    //   categories      → before context_rules (context_rules.category_id)
    //   content_types   → before content_rules (content_type_rules.content_type)
    seed_categories(pool).await?;
    seed_content_types(pool).await?;
    seed_context_rules(pool).await?;
    seed_content_rules(pool).await?;
    seed_settings(pool).await?;
    seed_themes(pool).await?;
    seed_languages(pool).await?;

    Ok(())
}

// ── Fresh install: final schema in one shot ───────────────────────────────────

/// Creates all tables in their final form with all FK constraints declared.
/// Only called on a brand-new database — no ALTER TABLE needed.
async fn create_fresh_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Dependency order: parent tables before children.

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL UNIQUE,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS content_types (
            name       TEXT PRIMARY KEY,
            label      TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 1,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS entries (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content      TEXT    NOT NULL,
            content_type TEXT    NOT NULL DEFAULT 'text'
                         REFERENCES content_types(name),
            category_id  INTEGER REFERENCES categories(id),
            source_app   TEXT,
            window_title TEXT,
            alias        TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entries_created_at   ON entries(created_at DESC)").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entries_source_app   ON entries(source_app)").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entries_content_type ON entries(content_type)").execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_entries_category_id  ON entries(category_id)").execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collections (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS subcollections (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            name          TEXT    NOT NULL,
            is_default    INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(collection_id, name)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_subcollections_collection ON subcollections(collection_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS entry_collections (
            entry_id          INTEGER NOT NULL REFERENCES entries(id)          ON DELETE CASCADE,
            collection_id     INTEGER NOT NULL REFERENCES collections(id)      ON DELETE CASCADE,
            subcollection_id  INTEGER REFERENCES subcollections(id),
            PRIMARY KEY (entry_id, collection_id)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ec_subcollection ON entry_collections(subcollection_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS context_rules (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id          INTEGER REFERENCES categories(id),
            source_app_pattern   TEXT,
            window_title_pattern TEXT,
            priority             INTEGER NOT NULL DEFAULT 0,
            enabled              INTEGER NOT NULL DEFAULT 1,
            is_builtin           INTEGER NOT NULL DEFAULT 1,
            created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS content_type_rules (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT    NOT NULL REFERENCES content_types(name),
            pattern      TEXT    NOT NULL,
            min_hits     INTEGER NOT NULL DEFAULT 1,
            priority     INTEGER NOT NULL DEFAULT 0,
            enabled      INTEGER NOT NULL DEFAULT 1,
            is_builtin   INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collection_rules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id   INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            content_type    TEXT    REFERENCES content_types(name),
            source_app      TEXT,
            window_title    TEXT,
            content_pattern TEXT,
            priority        INTEGER NOT NULL DEFAULT 0,
            enabled         INTEGER NOT NULL DEFAULT 1,
            is_builtin      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS languages (
            code        TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            native_name TEXT NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 1
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS themes (
            slug           TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            base           TEXT NOT NULL,
            surface        TEXT NOT NULL,
            surface_raised TEXT NOT NULL,
            surface_active TEXT NOT NULL,
            stroke         TEXT NOT NULL,
            stroke_strong  TEXT NOT NULL,
            content        TEXT NOT NULL,
            content_2      TEXT NOT NULL,
            content_3      TEXT NOT NULL,
            accent         TEXT NOT NULL,
            accent_text    TEXT NOT NULL,
            is_builtin     INTEGER NOT NULL DEFAULT 1,
            created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // Seed the builtin Favorites collection (only if it doesn't exist yet)
    sqlx::query(
        "INSERT INTO collections (name, color, is_builtin)
         SELECT 'Favorites', '#f59e0b', 1
         WHERE NOT EXISTS (SELECT 1 FROM collections WHERE name = 'Favorites' AND is_builtin = 1)",
    )
    .execute(pool)
    .await?;

    // Deduplicate Favorites: if old code inserted multiple builtin rows, keep the one
    // with the lowest id and migrate any entry_collections rows to it before deleting.
    //
    // Step 1: re-point entries from duplicate Favorites ids to the canonical (MIN) id
    sqlx::query(
        "INSERT OR IGNORE INTO entry_collections (entry_id, collection_id, subcollection_id)
         SELECT entry_id,
                (SELECT MIN(id) FROM collections WHERE is_builtin = 1 AND name = 'Favorites'),
                subcollection_id
         FROM entry_collections
         WHERE collection_id IN (
             SELECT id FROM collections
             WHERE is_builtin = 1 AND name = 'Favorites'
             AND id != (SELECT MIN(id) FROM collections WHERE is_builtin = 1 AND name = 'Favorites')
         )",
    )
    .execute(pool)
    .await?;

    // Step 2: delete every duplicate Favorites row (CASCADE removes their entry_collections)
    sqlx::query(
        "DELETE FROM collections
         WHERE is_builtin = 1 AND name = 'Favorites'
         AND id != (SELECT MIN(id) FROM collections WHERE is_builtin = 1 AND name = 'Favorites')",
    )
    .execute(pool)
    .await?;

    // Seed default subcollection for the builtin Favorites collection
    sqlx::query(
        "INSERT OR IGNORE INTO subcollections (collection_id, name, is_default)
         SELECT id, 'Sin clasificar', 1 FROM collections
         WHERE id NOT IN (SELECT collection_id FROM subcollections WHERE is_default = 1)",
    )
    .execute(pool)
    .await?;

    Ok(())
}


// ── Seed: categories ─────────────────────────────────────────────────────────

async fn seed_categories(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let builtin_cats: &[(&str, &str)] = &[
        ("development",   "#3b82f6"),
        ("terminal",      "#22c55e"),
        ("communication", "#f59e0b"),
        ("design",        "#ec4899"),
        ("web",           "#8b5cf6"),
        ("document",      "#6b7280"),
    ];
    for (name, color) in builtin_cats {
        sqlx::query(
            "INSERT OR IGNORE INTO categories (name, color, is_builtin) VALUES (?1, ?2, 1)",
        )
        .bind(name)
        .bind(color)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ── Seed: context rules ───────────────────────────────────────────────────────

async fn seed_context_rules(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM context_rules WHERE is_builtin = 1")
            .fetch_one(pool)
            .await?;

    if count > 0 {
        return Ok(());
    }

    // (category_name, source_app_pattern, window_title_pattern, priority)
    let rules: &[(&str, Option<&str>, Option<&str>, i64)] = &[
        // ── Development — IDEs / editors
        (
            "development",
            Some(r"^(code|codium|vscodium|vim|nvim|neovim|emacs|sublime_text|subl|atom|idea|pycharm|webstorm|clion|goland|rider|android-studio|kate|geany|lapce|zed)$"),
            None,
            10,
        ),
        // ── Development — browsers on dev sites
        (
            "development",
            None,
            Some(r"(github\.com|gitlab\.com|stackoverflow\.com|stackexchange\.com|developer\.|localhost|127\.0\.0\.1|codepen\.io|jsfiddle\.net|replit\.com|codesandbox\.io|vercel\.app|netlify\.app)"),
            8,
        ),
        // ── Terminal / CLI
        (
            "terminal",
            Some(r"^(bash|zsh|fish|sh|terminal|gnome-terminal|konsole|alacritty|kitty|xterm|xfce4-terminal|tilix|terminator|wezterm|foot|st|hyper)$"),
            None,
            10,
        ),
        // ── Communication
        (
            "communication",
            Some(r"^(slack|discord|telegram-desktop|telegram|whatsapp|teams|microsoft-teams|zoom|signal|thunderbird|evolution|geary|element|fractal|neomutt|mutt)$"),
            None,
            10,
        ),
        // ── Design
        (
            "design",
            Some(r"^(figma|inkscape|gimp|krita|blender|darktable|rawtherapee|pinta|kolourpaint|photoshop|illustrator|sketch|lunacy)$"),
            None,
            10,
        ),
        // ── Web — generic browser (lower priority than dev override)
        (
            "web",
            Some(r"^(chrome|google-chrome|chromium|firefox|brave|brave-browser|opera|vivaldi|microsoft-edge|edge|safari|waterfox|librewolf|zen)$"),
            None,
            5,
        ),
        // ── Document / notes
        (
            "document",
            Some(r"^(libreoffice|soffice|lowriter|localc|libreoffice-writer|libreoffice-calc|notion|obsidian|typora|zettlr|marktext|logseq|joplin|cherrytree|ghostwriter)$"),
            None,
            10,
        ),
    ];

    for (category_name, source_app, window_title, priority) in rules {
        // Use a subquery to resolve category_id from name
        sqlx::query(
            "INSERT INTO context_rules
             (category_id, source_app_pattern, window_title_pattern, priority, is_builtin)
             SELECT id, ?2, ?3, ?4, 1 FROM categories WHERE name = ?1",
        )
        .bind(category_name)
        .bind(source_app)
        .bind(window_title)
        .bind(priority)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ── Seed: content rules ───────────────────────────────────────────────────────

async fn seed_content_rules(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Rules grouped by content_type. Each group is inserted only if no builtin
    // rules exist yet for that type — this allows new types to be added to
    // existing databases without re-seeding types that are already present.
    let groups: &[(&str, &[(&str, i64, i64)])] = &[
        // ── URL (priority 50)
        ("url", &[(r"^(https?|ftp)://\S+", 1, 50)]),
        // ── Email (priority 40)
        ("email", &[(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", 1, 40)]),
        // ── Phone (priority 30)
        ("phone", &[(r"^[\+]?[\d\s\-\.\(\)]{7,25}$", 1, 30)]),
        // ── Color (priority 25)
        ("color", &[
            (r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", 1, 25),
            (r"^rgba?\(\s*\d+", 1, 25),
            (r"^hsla?\(\s*\d+", 1, 25),
        ]),
        // ── JSON (priority 22) — min_hits=3: starts with {/[, quoted key:, typed value, ends with }/]
        ("json", &[
            (r#"^\s*[\{\[]"#, 3, 22),
            (r#""[^"]+"\s*:"#, 3, 22),
            (r#":\s*(true|false|null|-?[0-9])"#, 3, 22),
            (r#"[\}\]]\s*$"#, 3, 22),
            (r#",\s*"[^"]+"#, 3, 22),
        ]),
        // ── SQL (priority 22) — min_hits=2
        // Pattern 1 uses compound SQL-specific constructs that don't appear in natural language
        // (prevents false positives from prose containing "delete", "from", "into", etc.)
        ("sql", &[
            (r"(?i)\bSELECT\s+[\w\*\(]|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bCREATE\s+(TABLE|INDEX|VIEW|DATABASE|PROCEDURE|FUNCTION)\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\b", 2, 22),
            (r"(?i)\b(FROM|WHERE|JOIN|SET|INTO|VALUES|HAVING|LIMIT|OFFSET|RETURNING)\b", 2, 22),
            (r"(?i)\b(GROUP\s+BY|ORDER\s+BY|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|CROSS\s+JOIN)\b", 2, 22),
            (r"(?i)\b(AND|OR)\s+\w+\s*(=|!=|<>|>|<|>=|<=|\bLIKE\b|\bIN\b|\bIS\b)", 2, 22),
            (r"--\s*\S|/\*|\b(COUNT|SUM|AVG|MAX|MIN|COALESCE)\s*\(", 2, 22),
        ]),
        // ── Shell (priority 21) — min_hits=2
        ("shell", &[
            (r"(?m)^#!/", 2, 21),
            (r"(?m)^\$\s+\S", 2, 21),
            (r"\b(apt-get|brew|npm|yarn|pip3?|cargo|git|docker|kubectl|systemctl|chmod|chown|mkdir|grep|awk|sed|curl|wget|rsync|ssh|scp|tar|xargs)\b", 2, 21),
            (r"\|\s*\w+|\s&&\s|\s\|\|\s|>>\s*\S|\s>\s*\S", 2, 21),
            (r"(?m)^(sudo\s|export\s|source\s|\.\s\S|alias\s|function\s)", 2, 21),
            (r"\$\([^)]+\)", 2, 21),
            (r"(?m)^\s*[A-Z_][A-Z0-9_]+=", 2, 21),
        ]),
        // ── Code (priority 20) — min_hits=3
        ("code", &[
            (r"(?m)(^|\s)(fn |def |class |function |func |sub )\s*\w", 3, 20),
            (r"\bimport\s+[\w\{\*]|\brequire\s*\(|\busing\s+\w", 3, 20),
            (r"\bexport\s+[\w\{]", 3, 20),
            (r"\b(const|let|var)\s+\w+\s*=", 3, 20),
            (r"\breturn\s", 3, 20),
            (r"\b(if|for|while|switch|match|foreach)\s*\(", 3, 20),
            (r"=>|->", 3, 20),
            (r"(?m)[{;]\s*$", 3, 20),
            (r"(?m)^\s*@\w+", 3, 20),
            (r"(?m)^\s*(public|private|protected|static|async|abstract|override)\s+\w", 3, 20),
        ]),
        // ── Markdown (priority 18) — min_hits=2
        ("markdown", &[
            (r"(?m)^#{1,6}\s+\S", 2, 18),
            (r"\[.+?\]\(.+?\)", 2, 18),
            (r"(?m)^\s*[-*+]\s+\S", 2, 18),
            (r"(?m)^```|^~~~", 2, 18),
            (r"\*\*[^*\n]+\*\*|__[^_\n]+__", 2, 18),
            (r"(?m)^>\s", 2, 18),
            (r"(?m)^\d+\.\s+\S", 2, 18),
            (r"\|.+\|.+\|", 2, 18),
            (r"(?m)^-{3,}\s*$|^\*{3,}\s*$", 2, 18),
            (r"!\[.*?\]\(.+?\)", 2, 18),
        ]),
    ];

    for (content_type, rules) in groups {
        // Always replace builtin rules so improvements ship to existing databases.
        // User-created rules (is_builtin = 0) are never touched.
        sqlx::query(
            "DELETE FROM content_type_rules WHERE content_type = ?1 AND is_builtin = 1",
        )
        .bind(content_type)
        .execute(pool)
        .await?;

        for (pattern, min_hits, priority) in *rules {
            sqlx::query(
                "INSERT INTO content_type_rules
                 (content_type, pattern, min_hits, priority, is_builtin)
                 VALUES (?1, ?2, ?3, ?4, 1)",
            )
            .bind(content_type)
            .bind(pattern)
            .bind(min_hits)
            .bind(priority)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

// ── Seed: settings ───────────────────────────────────────────────────────────

async fn seed_settings(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let defaults: &[(&str, &str)] = &[
        ("content_analysis_max_bytes", "8192"),
        ("max_history_entries", "0"),
        ("retention_days", "0"),
        ("dedup_interval_minutes", "5"),
        ("detail_panel_width", "320"),
        ("active_theme", "midnight"),
        ("page_size", "50"),
        ("language", "en"),
        ("max_image_size_bytes", "36700160"),
    ];

    for (key, value) in defaults {
        sqlx::query(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        )
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ── Seed: content_types ──────────────────────────────────────────────────────

async fn seed_content_types(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let types: &[(&str, &str, &str)] = &[
        ("text",     "Text",     "#6b7280"),
        ("url",      "URL",      "#3b82f6"),
        ("email",    "Email",    "#22c55e"),
        ("phone",    "Phone",    "#a855f7"),
        ("color",    "Color",    "#f59e0b"),
        ("code",     "Code",     "#8b5cf6"),
        ("json",     "JSON",     "#eab308"),
        ("sql",      "SQL",      "#f97316"),
        ("shell",    "Shell",    "#10b981"),
        ("markdown", "Markdown", "#64748b"),
        ("image",    "Image",    "#ec4899"),
    ];

    for (name, label, color) in types {
        sqlx::query(
            "INSERT OR IGNORE INTO content_types (name, label, color, is_builtin)
             VALUES (?1, ?2, ?3, 1)",
        )
        .bind(name)
        .bind(label)
        .bind(color)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ── Queries ───────────────────────────────────────────────────────────────────

pub async fn save_entry(
    pool: &SqlitePool,
    content: String,
    content_type: &str,
    category_id: Option<i64>,
    source_app: Option<String>,
    window_title: Option<String>,
) -> Result<ClipboardEntry, sqlx::Error> {
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO entries
             (content, content_type, category_id, source_app, window_title)
         VALUES (?1, ?2, ?3, ?4, ?5)
         RETURNING id",
    )
    .bind(&content)
    .bind(content_type)
    .bind(category_id)
    .bind(&source_app)
    .bind(&window_title)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ClipboardEntry>(&format!(
        "SELECT entries.id, entries.content, entries.content_type,
                COALESCE(cat.name, 'other') AS category,
                entries.source_app, entries.window_title,
                {IS_FAVORITE_SQL} AS is_favorite, entries.created_at,
                '' AS collection_ids,
                entries.alias
         FROM entries
         LEFT JOIN categories cat ON cat.id = entries.category_id
         WHERE entries.id = ?1",
    ))
    .bind(id)
    .fetch_one(pool)
    .await
}

pub async fn update_entry_alias(
    pool: &SqlitePool,
    id: i64,
    alias: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE entries SET alias = ?1 WHERE id = ?2")
        .bind(alias)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Collection rules ─────────────────────────────────────────────────────────

pub async fn get_all_collection_rules(pool: &SqlitePool) -> Result<Vec<CollectionRule>, sqlx::Error> {
    sqlx::query_as::<_, CollectionRule>(
        "SELECT cr.id, cr.collection_id,
                COALESCE(c.name, 'unknown') AS collection_name,
                cr.content_type, cr.source_app, cr.window_title, cr.content_pattern,
                cr.priority, cr.enabled, cr.is_builtin, cr.created_at
         FROM collection_rules cr
         LEFT JOIN collections c ON c.id = cr.collection_id
         ORDER BY cr.priority DESC, cr.id ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_enabled_collection_rules(pool: &SqlitePool) -> Result<Vec<CollectionRuleRaw>, sqlx::Error> {
    let rows: Vec<(i64, Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT collection_id, content_type, source_app, window_title, content_pattern
             FROM collection_rules
             WHERE enabled = 1
             ORDER BY priority DESC, id ASC",
        )
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(|(collection_id, content_type, source_app, window_title, content_pattern)| {
        CollectionRuleRaw { collection_id, content_type, source_app, window_title, content_pattern }
    }).collect())
}

pub async fn create_collection_rule(
    pool: &SqlitePool,
    collection_id: i64,
    content_type: Option<String>,
    source_app: Option<String>,
    window_title: Option<String>,
    content_pattern: Option<String>,
    priority: i64,
) -> Result<i64, sqlx::Error> {
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO collection_rules (collection_id, content_type, source_app, window_title, content_pattern, priority, is_builtin)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         RETURNING id",
    )
    .bind(collection_id)
    .bind(content_type)
    .bind(source_app)
    .bind(window_title)
    .bind(content_pattern)
    .bind(priority)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn delete_collection_rule(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM collection_rules WHERE id = ?1 AND is_builtin = 0")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn toggle_collection_rule(pool: &SqlitePool, id: i64, enabled: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE collection_rules SET enabled = ?1 WHERE id = ?2")
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn add_entry_to_collection(pool: &SqlitePool, entry_id: i64, collection_id: i64) -> Result<(), sqlx::Error> {
    let default_sub = get_default_subcollection_id(pool, collection_id).await?;
    sqlx::query("INSERT OR IGNORE INTO entry_collections (entry_id, collection_id, subcollection_id) VALUES (?1, ?2, ?3)")
        .bind(entry_id)
        .bind(collection_id)
        .bind(default_sub)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_context_rules(pool: &SqlitePool) -> Result<Vec<ContextRule>, sqlx::Error> {
    sqlx::query_as::<_, ContextRule>(
        "SELECT cr.id, cr.category_id,
                COALESCE(cat.name, 'unknown') AS category_name,
                cr.source_app_pattern, cr.window_title_pattern,
                cr.priority, cr.enabled, cr.is_builtin, cr.created_at
         FROM context_rules cr
         LEFT JOIN categories cat ON cat.id = cr.category_id
         WHERE cr.enabled = 1
         ORDER BY cr.priority DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_content_rules(pool: &SqlitePool) -> Result<Vec<ContentRule>, sqlx::Error> {
    sqlx::query_as::<_, ContentRule>(
        "SELECT id, content_type, pattern, min_hits, priority, enabled, is_builtin, created_at
         FROM content_type_rules
         WHERE enabled = 1
         ORDER BY priority DESC, id ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_settings(pool: &SqlitePool) -> Result<Vec<Setting>, sqlx::Error> {
    sqlx::query_as::<_, Setting>(
        "SELECT key, value, updated_at FROM settings ORDER BY key ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(v,)| v))
}

pub async fn update_setting(
    pool: &SqlitePool,
    key: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn get_themes(pool: &SqlitePool) -> Result<Vec<Theme>, sqlx::Error> {
    sqlx::query_as::<_, Theme>(
        "SELECT slug, name, base, surface, surface_raised, surface_active,
                stroke, stroke_strong, content, content_2, content_3,
                accent, accent_text, is_builtin
         FROM themes ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_content_types(pool: &SqlitePool) -> Result<Vec<ContentTypeStyle>, sqlx::Error> {
    sqlx::query_as::<_, ContentTypeStyle>(
        "SELECT name, label, color, is_builtin FROM content_types ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_distinct_apps(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT source_app FROM entries
         WHERE source_app IS NOT NULL AND source_app != ''
         ORDER BY source_app ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(app,)| app).collect())
}

pub async fn get_distinct_window_titles(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT window_title FROM entries
         WHERE window_title IS NOT NULL AND window_title != ''
         ORDER BY window_title ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(t,)| t).collect())
}

pub async fn get_all_categories(pool: &SqlitePool) -> Result<Vec<Category>, sqlx::Error> {
    sqlx::query_as::<_, Category>(
        "SELECT id, name, color, is_builtin, created_at FROM categories ORDER BY is_builtin DESC, name ASC",
    )
    .fetch_all(pool)
    .await
}

/// Returns all category names from the categories table (for filter dropdown).
pub async fn get_categories(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT name FROM categories ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(c,)| c).collect())
}

/// Enforce retention rules: delete by age and/or by count.
/// Entries in any collection (including Favorites) are always exempt.
pub async fn cleanup_entries(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let retention_days: i64 = get_setting(pool, "retention_days").await?.and_then(|v| v.parse().ok()).unwrap_or(0);
    let max_entries: i64 = get_setting(pool, "max_history_entries").await?.and_then(|v| v.parse().ok()).unwrap_or(0);

    if retention_days == 0 && max_entries == 0 {
        return Ok(());
    }

    // Protected from cleanup: entries in any collection (includes builtin Favorites)
    let protected = "id NOT IN (SELECT entry_id FROM entry_collections)";

    if retention_days > 0 {
        sqlx::query(&format!(
            "DELETE FROM entries
             WHERE {protected}
               AND created_at < datetime('now', ?1)",
        ))
        .bind(format!("-{retention_days} days"))
        .execute(pool)
        .await?;
    }

    if max_entries > 0 {
        sqlx::query(&format!(
            "DELETE FROM entries
             WHERE {protected}
               AND id NOT IN (
                 SELECT id FROM entries
                 WHERE {protected}
                 ORDER BY created_at DESC
                 LIMIT ?1
               )",
        ))
        .bind(max_entries)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Delete image files in `<app_data>/images/` that are no longer referenced by any entry.
pub async fn cleanup_orphaned_images(
    app_data_dir: &std::path::Path,
    pool: &SqlitePool,
) -> Result<(), sqlx::Error> {
    let referenced: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT content FROM entries WHERE content_type = 'image'",
    )
    .fetch_all(pool)
    .await?;

    let referenced_set: std::collections::HashSet<String> =
        referenced.into_iter().map(|(c,)| c).collect();

    let images_dir = app_data_dir.join("images");
    if let Ok(dir) = std::fs::read_dir(&images_dir) {
        for entry in dir.flatten() {
            let rel_path = format!("images/{}", entry.file_name().to_string_lossy());
            if !referenced_set.contains(&rel_path) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

pub async fn get_category_name_id_map(pool: &SqlitePool) -> Result<HashMap<String, i64>, sqlx::Error> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT name, id FROM categories")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Returns the content of the most recently saved entry, or None if the table is empty.
pub async fn last_entry_content(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT content FROM entries ORDER BY id DESC LIMIT 1")
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(c,)| c))
}

/// Delete duplicate entries keeping only the latest (highest id) per unique content.
/// Entries in any collection (including Favorites) are never deleted.
pub async fn dedup_entries(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM entries
         WHERE id NOT IN (
             SELECT MAX(id) FROM entries GROUP BY content
         )
         AND id NOT IN (SELECT entry_id FROM entry_collections)",
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub async fn get_entry_counts(pool: &SqlitePool) -> Result<(i64, i64), sqlx::Error> {
    let (all,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entries")
        .fetch_one(pool)
        .await?;
    let (favorites,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entry_collections ec
         JOIN collections c ON ec.collection_id = c.id
         WHERE c.is_builtin = 1",
    )
    .fetch_one(pool)
    .await?;
    Ok((all, favorites))
}

// ── Collections ───────────────────────────────────────────────────────────────

pub async fn get_collections(pool: &SqlitePool) -> Result<Vec<Collection>, sqlx::Error> {
    sqlx::query_as::<_, Collection>(
        "SELECT id, name, color, is_builtin, created_at FROM collections ORDER BY is_builtin DESC, created_at ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn create_collection(
    pool: &SqlitePool,
    name: &str,
    color: &str,
) -> Result<Collection, sqlx::Error> {
    let col = sqlx::query_as::<_, Collection>(
        "INSERT INTO collections (name, color)
         VALUES (?1, ?2)
         RETURNING id, name, color, is_builtin, created_at",
    )
    .bind(name)
    .bind(color)
    .fetch_one(pool)
    .await?;

    // Auto-create default subcollection
    sqlx::query(
        "INSERT INTO subcollections (collection_id, name, is_default) VALUES (?1, 'Sin clasificar', 1)",
    )
    .bind(col.id)
    .execute(pool)
    .await?;

    Ok(col)
}

pub async fn update_collection(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    color: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE collections SET name = ?1, color = ?2 WHERE id = ?3")
        .bind(name)
        .bind(color)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn delete_collection(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM collections WHERE id = ?1 AND is_builtin = 0")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

/// Toggles membership of an entry in the builtin Favorites collection.
pub async fn toggle_favorite(pool: &SqlitePool, entry_id: i64) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT ec.collection_id FROM entry_collections ec
         JOIN collections c ON ec.collection_id = c.id
         WHERE ec.entry_id = ?1 AND c.is_builtin = 1",
    )
    .bind(entry_id)
    .fetch_optional(&mut *tx)
    .await?;

    let result = if let Some((cid,)) = existing {
        sqlx::query("DELETE FROM entry_collections WHERE entry_id = ?1 AND collection_id = ?2")
            .bind(entry_id)
            .bind(cid)
            .execute(&mut *tx)
            .await?;
        false
    } else {
        let (cid,): (i64,) = sqlx::query_as(
            "SELECT id FROM collections WHERE is_builtin = 1 LIMIT 1",
        )
        .fetch_one(&mut *tx)
        .await?;
        let (default_sub,): (i64,) = sqlx::query_as(
            "SELECT id FROM subcollections WHERE collection_id = ?1 AND is_default = 1",
        )
        .bind(cid)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO entry_collections (entry_id, collection_id, subcollection_id) VALUES (?1, ?2, ?3)",
        )
        .bind(entry_id)
        .bind(cid)
        .bind(default_sub)
        .execute(&mut *tx)
        .await?;
        true
    };

    tx.commit().await?;
    Ok(result)
}

/// Returns collection ids the entry belongs to.
pub async fn get_entry_collection_ids(
    pool: &SqlitePool,
    entry_id: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT collection_id FROM entry_collections WHERE entry_id = ?1",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Replaces all collection memberships for an entry with the given ids.
/// New collections get the default subcollection; existing ones preserve their subcollection.
pub async fn set_entry_collections(
    pool: &SqlitePool,
    entry_id: i64,
    collection_ids: &[i64],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Snapshot current subcollection assignments so we can preserve them
    let existing: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT collection_id, subcollection_id FROM entry_collections WHERE entry_id = ?1",
    )
    .bind(entry_id)
    .fetch_all(&mut *tx)
    .await?;
    let existing_map: std::collections::HashMap<i64, Option<i64>> =
        existing.into_iter().collect();

    sqlx::query("DELETE FROM entry_collections WHERE entry_id = ?1")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    for &cid in collection_ids {
        let sub_id = if let Some(&Some(sid)) = existing_map.get(&cid) {
            // Preserve existing subcollection assignment
            sid
        } else {
            // Resolve default subcollection for this collection
            let (sid,): (i64,) = sqlx::query_as(
                "SELECT id FROM subcollections WHERE collection_id = ?1 AND is_default = 1",
            )
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
            sid
        };
        sqlx::query(
            "INSERT OR IGNORE INTO entry_collections (entry_id, collection_id, subcollection_id) VALUES (?1, ?2, ?3)",
        )
        .bind(entry_id)
        .bind(cid)
        .bind(sub_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Returns (collection_id, count) for all collections.
pub async fn get_collection_counts(pool: &SqlitePool) -> Result<Vec<(i64, i64)>, sqlx::Error> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT collection_id, COUNT(*) FROM entry_collections GROUP BY collection_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Subcollections ────────────────────────────────────────────────────────────

pub async fn get_all_subcollections(pool: &SqlitePool) -> Result<Vec<Subcollection>, sqlx::Error> {
    sqlx::query_as::<_, Subcollection>(
        "SELECT id, collection_id, name, is_default, created_at
         FROM subcollections
         ORDER BY is_default DESC, created_at ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_subcollections(pool: &SqlitePool, collection_id: i64) -> Result<Vec<Subcollection>, sqlx::Error> {
    sqlx::query_as::<_, Subcollection>(
        "SELECT id, collection_id, name, is_default, created_at
         FROM subcollections
         WHERE collection_id = ?1
         ORDER BY is_default DESC, created_at ASC",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
}

pub async fn create_subcollection(
    pool: &SqlitePool,
    collection_id: i64,
    name: &str,
) -> Result<Subcollection, sqlx::Error> {
    sqlx::query_as::<_, Subcollection>(
        "INSERT INTO subcollections (collection_id, name, is_default)
         VALUES (?1, ?2, 0)
         RETURNING id, collection_id, name, is_default, created_at",
    )
    .bind(collection_id)
    .bind(name)
    .fetch_one(pool)
    .await
}

pub async fn rename_subcollection(
    pool: &SqlitePool,
    id: i64,
    name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE subcollections SET name = ?1 WHERE id = ?2 AND is_default = 0")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn delete_subcollection(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Fetch the subcollection to guard: must not be default
    let row: Option<(i64, bool)> = sqlx::query_as(
        "SELECT collection_id, is_default FROM subcollections WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;

    let (collection_id, is_default) = match row {
        Some(r) => r,
        None => return Ok(()),
    };

    if is_default {
        return Ok(()); // Cannot delete default subcollection
    }

    // Move entries to the default subcollection before deleting
    let (default_id,): (i64,) = sqlx::query_as(
        "SELECT id FROM subcollections WHERE collection_id = ?1 AND is_default = 1",
    )
    .bind(collection_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE entry_collections SET subcollection_id = ?1 WHERE subcollection_id = ?2")
        .bind(default_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM subcollections WHERE id = ?1 AND is_default = 0")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_default_subcollection_id(pool: &SqlitePool, collection_id: i64) -> Result<i64, sqlx::Error> {
    let (id,): (i64,) = sqlx::query_as(
        "SELECT id FROM subcollections WHERE collection_id = ?1 AND is_default = 1",
    )
    .bind(collection_id)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn get_subcollection_counts(pool: &SqlitePool, collection_id: i64) -> Result<Vec<(i64, i64)>, sqlx::Error> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT subcollection_id, COUNT(*) FROM entry_collections
         WHERE collection_id = ?1 AND subcollection_id IS NOT NULL
         GROUP BY subcollection_id",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn move_entry_subcollection(
    pool: &SqlitePool,
    entry_id: i64,
    collection_id: i64,
    subcollection_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE entry_collections SET subcollection_id = ?1
         WHERE entry_id = ?2 AND collection_id = ?3",
    )
    .bind(subcollection_id)
    .bind(entry_id)
    .bind(collection_id)
    .execute(pool)
    .await
    .map(|_| ())
}

/// Returns (collection_id, subcollection_id) pairs for an entry.
pub async fn get_entry_subcollection_ids(
    pool: &SqlitePool,
    entry_id: i64,
) -> Result<Vec<(i64, i64)>, sqlx::Error> {
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT collection_id, COALESCE(subcollection_id, 0) FROM entry_collections WHERE entry_id = ?1",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Content Types CRUD ────────────────────────────────────────────────────────

pub async fn update_content_type_color(pool: &SqlitePool, name: &str, color: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE content_types SET color = ?1 WHERE name = ?2")
        .bind(color)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_content_type(
    pool: &SqlitePool,
    name: &str,
    label: &str,
    color: &str,
) -> Result<ContentTypeStyle, sqlx::Error> {
    sqlx::query_as::<_, ContentTypeStyle>(
        "INSERT INTO content_types (name, label, color, is_builtin)
         VALUES (?1, ?2, ?3, 0)
         RETURNING name, label, color, is_builtin",
    )
    .bind(name)
    .bind(label)
    .bind(color)
    .fetch_one(pool)
    .await
}

pub async fn delete_content_type(pool: &SqlitePool, name: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM content_types WHERE name = ?1 AND is_builtin = 0")
        .bind(name)
        .execute(pool)
        .await
        .map(|_| ())
}

// ── Categories CRUD ───────────────────────────────────────────────────────────

pub async fn create_category(
    pool: &SqlitePool,
    name: &str,
    color: &str,
) -> Result<Category, sqlx::Error> {
    sqlx::query_as::<_, Category>(
        "INSERT INTO categories (name, color, is_builtin)
         VALUES (?1, ?2, 0)
         RETURNING id, name, color, is_builtin, created_at",
    )
    .bind(name)
    .bind(color)
    .fetch_one(pool)
    .await
}

pub async fn update_category(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    color: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE categories SET name = ?1, color = ?2 WHERE id = ?3 AND is_builtin = 0")
        .bind(name)
        .bind(color)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn delete_category(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM categories WHERE id = ?1 AND is_builtin = 0")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

// ── Context Rules CRUD ────────────────────────────────────────────────────────

pub async fn get_all_context_rules(pool: &SqlitePool) -> Result<Vec<ContextRule>, sqlx::Error> {
    sqlx::query_as::<_, ContextRule>(
        "SELECT cr.id, cr.category_id,
                COALESCE(cat.name, 'unknown') AS category_name,
                cr.source_app_pattern, cr.window_title_pattern,
                cr.priority, cr.enabled, cr.is_builtin, cr.created_at
         FROM context_rules cr
         LEFT JOIN categories cat ON cat.id = cr.category_id
         ORDER BY cr.priority DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn create_context_rule(
    pool: &SqlitePool,
    category_id: Option<i64>,
    source_app_pattern: Option<&str>,
    window_title_pattern: Option<&str>,
    priority: i64,
) -> Result<ContextRule, sqlx::Error> {
    let (new_id,): (i64,) = sqlx::query_as(
        "INSERT INTO context_rules (category_id, source_app_pattern, window_title_pattern, priority, is_builtin)
         VALUES (?1, ?2, ?3, ?4, 0)
         RETURNING id",
    )
    .bind(category_id)
    .bind(source_app_pattern)
    .bind(window_title_pattern)
    .bind(priority)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ContextRule>(
        "SELECT cr.id, cr.category_id,
                COALESCE(cat.name, 'unknown') AS category_name,
                cr.source_app_pattern, cr.window_title_pattern,
                cr.priority, cr.enabled, cr.is_builtin, cr.created_at
         FROM context_rules cr
         LEFT JOIN categories cat ON cat.id = cr.category_id
         WHERE cr.id = ?1",
    )
    .bind(new_id)
    .fetch_one(pool)
    .await
}

pub async fn delete_context_rule(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM context_rules WHERE id = ?1 AND is_builtin = 0")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

// ── Content Type Rules CRUD ───────────────────────────────────────────────────

pub async fn get_all_content_type_rules(pool: &SqlitePool) -> Result<Vec<ContentRule>, sqlx::Error> {
    sqlx::query_as::<_, ContentRule>(
        "SELECT id, content_type, pattern, min_hits, priority, enabled, is_builtin, created_at
         FROM content_type_rules
         ORDER BY priority DESC, id ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn create_content_type_rule(
    pool: &SqlitePool,
    content_type: &str,
    pattern: &str,
    min_hits: i64,
    priority: i64,
) -> Result<ContentRule, sqlx::Error> {
    sqlx::query_as::<_, ContentRule>(
        "INSERT INTO content_type_rules (content_type, pattern, min_hits, priority, is_builtin)
         VALUES (?1, ?2, ?3, ?4, 0)
         RETURNING id, content_type, pattern, min_hits, priority, enabled, is_builtin, created_at",
    )
    .bind(content_type)
    .bind(pattern)
    .bind(min_hits)
    .bind(priority)
    .fetch_one(pool)
    .await
}

pub async fn delete_content_type_rule(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM content_type_rules WHERE id = ?1 AND is_builtin = 0")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn set_context_rule_enabled(
    pool: &SqlitePool,
    id: i64,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE context_rules SET enabled = ?1 WHERE id = ?2")
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn set_content_type_rule_enabled(
    pool: &SqlitePool,
    id: i64,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE content_type_rules SET enabled = ?1 WHERE id = ?2")
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

// ── Seed: languages ───────────────────────────────────────────────────────────

async fn seed_languages(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let languages: &[(&str, &str, &str)] = &[
        ("en",    "English",          "English"),
        ("es-MX", "Spanish (Mexico)", "Español (México)"),
    ];

    for (code, name, native_name) in languages {
        sqlx::query(
            "INSERT OR IGNORE INTO languages (code, name, native_name) VALUES (?1, ?2, ?3)",
        )
        .bind(code)
        .bind(name)
        .bind(native_name)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn get_languages(pool: &SqlitePool) -> Result<Vec<Language>, sqlx::Error> {
    sqlx::query_as::<_, Language>(
        "SELECT code, name, native_name, is_active FROM languages ORDER BY code ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn bootstrap_data(pool: &SqlitePool) -> Result<BootstrapData, sqlx::Error> {
    let settings          = get_settings(pool).await?;
    let themes            = get_themes(pool).await?;
    let content_types     = get_content_types(pool).await?;
    let collections       = get_collections(pool).await?;
    let collection_counts = get_collection_counts(pool).await?;
    let subcollections    = get_all_subcollections(pool).await?;
    let languages         = get_languages(pool).await?;
    let entry_counts      = get_entry_counts(pool).await?;
    Ok(BootstrapData {
        settings,
        themes,
        content_types,
        collections,
        collection_counts,
        subcollections,
        languages,
        entry_counts,
    })
}

// ── Seed: themes ──────────────────────────────────────────────────────────────

async fn seed_themes(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let themes: &[(&str, &str, &str, &str, &str, &str, &str, &str, &str, &str, &str, &str, &str)] = &[
        ("midnight", "Midnight", "#0a0a0a", "#141414", "#1e1e1e", "#2a2a2a", "#2a2a2a", "#484848", "#f0f0f0", "#a8a8a8", "#686868", "#5b8af5", "#a8c4ff"),
        ("slate",    "Slate",    "#090c12", "#111620", "#1a2030", "#232c3d", "#242c3e", "#3d4f6e", "#e8edf5", "#8fa3c0", "#556070", "#2ec4b6", "#7de8e0"),
        ("dusk",     "Dusk",     "#0e0b08", "#181410", "#221d17", "#2d2620", "#2e2720", "#4e4238", "#f2ede8", "#b09a82", "#6e5c48", "#d4832a", "#f0b870"),
        ("forest",   "Forest",   "#080d0a", "#101810", "#172018", "#1f2b20", "#1e2c1f", "#344d36", "#e4ede5", "#7fa882", "#4a6e4d", "#4caf7d", "#8dd8ad"),
        ("plum",     "Plum",     "#0b090e", "#141118", "#1d1924", "#272230", "#272130", "#42385a", "#eee9f5", "#a090c0", "#64587a", "#8b68e8", "#bda8f8"),
    ];

    for (slug, name, base, surface, surface_raised, surface_active, stroke, stroke_strong, content, content_2, content_3, accent, accent_text) in themes {
        sqlx::query(
            "INSERT OR IGNORE INTO themes
             (slug, name, base, surface, surface_raised, surface_active,
              stroke, stroke_strong, content, content_2, content_3, accent, accent_text)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        )
        .bind(slug).bind(name).bind(base).bind(surface)
        .bind(surface_raised).bind(surface_active).bind(stroke).bind(stroke_strong)
        .bind(content).bind(content_2).bind(content_3).bind(accent).bind(accent_text)
        .execute(pool)
        .await?;
    }
    Ok(())
}
