/// Upgrade simulation tests.
///
/// Each test builds a schema that matches a specific past release, inserts
/// realistic user data, then runs the current migration pipeline on top of it.
/// If a migration references a column or table that doesn't exist yet for that
/// version the test fails — exactly the class of bug that caused the v1.2.0
/// startup crash on upgrade from v1.1.0.
///
/// After a successful migration every query that the bootstrap command runs is
/// executed to confirm the app would start correctly on an upgraded database.
use clipboard_tool_lib::db;
use sqlx::{Row, SqlitePool};
use sqlx::sqlite::SqlitePoolOptions;

// ── Schema builders ───────────────────────────────────────────────────────────

/// Schema as it existed in v1.0.0 / v1.1.0 (identical between the two
/// releases — no schema changes landed between them).
///
/// Missing versus the current schema:
/// - entries.alias                   (added in v1.2.0)
/// - entries.manual_override         (added in v1.2.0)
/// - subcollections table            (added in v1.2.0)
/// - entry_collections.subcollection_id (added in v1.2.0)
/// - collection_rules table          (added in v1.2.0)
/// - languages table                 (added in v1.2.0)
async fn build_v110_schema(pool: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL UNIQUE,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE content_types (
            name       TEXT PRIMARY KEY,
            label      TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 1,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    // entries: no alias, no manual_override
    sqlx::query(
        "CREATE TABLE entries (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content      TEXT    NOT NULL,
            content_type TEXT    NOT NULL DEFAULT 'text' REFERENCES content_types(name),
            category_id  INTEGER REFERENCES categories(id),
            source_app   TEXT,
            window_title TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE collections (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT '#6b7280',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    // entry_collections: no subcollection_id column
    sqlx::query(
        "CREATE TABLE entry_collections (
            entry_id      INTEGER NOT NULL REFERENCES entries(id)      ON DELETE CASCADE,
            collection_id INTEGER NOT NULL REFERENCES collections(id)  ON DELETE CASCADE,
            PRIMARY KEY (entry_id, collection_id)
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE context_rules (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id          INTEGER REFERENCES categories(id),
            source_app_pattern   TEXT,
            window_title_pattern TEXT,
            priority             INTEGER NOT NULL DEFAULT 0,
            enabled              INTEGER NOT NULL DEFAULT 1,
            is_builtin           INTEGER NOT NULL DEFAULT 1,
            created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE content_type_rules (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT    NOT NULL REFERENCES content_types(name),
            pattern      TEXT    NOT NULL,
            min_hits     INTEGER NOT NULL DEFAULT 1,
            priority     INTEGER NOT NULL DEFAULT 0,
            enabled      INTEGER NOT NULL DEFAULT 1,
            is_builtin   INTEGER NOT NULL DEFAULT 1,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE themes (
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
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    ).execute(pool).await.unwrap();

    // Seed minimal data that a real user would have after using v1.1.0
    sqlx::query("INSERT INTO content_types (name, label, color) VALUES ('text','Text','#6b7280'), ('url','URL','#3b82f6'), ('email','Email','#22c55e')").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('page_size','50'), ('active_theme','midnight'), ('language','en')").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO collections (name, color, is_builtin) VALUES ('Favorites','#f59e0b',1)").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO entries (content, content_type) VALUES ('https://example.com','url'), ('hello world','text'), ('user@example.com','email')").execute(pool).await.unwrap();
    // Entry 1 is in Favorites, entry 2 is in a regular collection
    sqlx::query("INSERT INTO entry_collections (entry_id, collection_id) VALUES (1,1)").execute(pool).await.unwrap();
}

async fn make_empty_pool() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory pool")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns the list of column names for a table via PRAGMA.
async fn column_names(pool: &SqlitePool, table: &str) -> Vec<String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({})", table))
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.iter()
        .map(|r| r.get::<String, _>("name"))
        .collect()
}

/// Returns true if a table exists in the database.
async fn table_exists(pool: &SqlitePool, table: &str) -> bool {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));
    count > 0
}

// ── Upgrade tests ─────────────────────────────────────────────────────────────

/// Core regression test for the v1.2.0 startup crash.
///
/// v1.2.0 referenced `subcollection_id` and the `subcollections` table before
/// the ALTER TABLE migration had added the column to existing databases.
/// This test reproduces that scenario exactly: it builds a v1.1.0 database with
/// real user data, then runs the current migration and verifies it completes.
#[tokio::test]
async fn test_upgrade_from_v110_does_not_crash() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;

    db::run_migrations_for_test(&pool)
        .await
        .expect("migration must not crash on a v1.1.0 database — this is the v1.2.0 regression");
}

/// User data inserted before the upgrade must survive intact.
#[tokio::test]
async fn test_upgrade_from_v110_preserves_user_data() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    // All three pre-existing entries survive
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entries")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 3, "all pre-existing entries must be preserved");

    // Entry 1 is still in Favorites
    let (fav,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM entry_collections WHERE entry_id = 1",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(fav, 1, "entry 1 must still be in Favorites after upgrade");

    // Settings survived
    let page_size = db::get_setting(&pool, "page_size").await.unwrap();
    assert_eq!(page_size.as_deref(), Some("50"));
}

/// After upgrading from v1.1.0 the `entries` table must have the new columns.
#[tokio::test]
async fn test_upgrade_from_v110_entries_has_new_columns() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    let cols = column_names(&pool, "entries").await;
    assert!(cols.contains(&"alias".to_string()),          "entries.alias must exist after upgrade");
    assert!(cols.contains(&"manual_override".to_string()), "entries.manual_override must exist after upgrade");
}

/// After upgrading the `entry_collections` table must have `subcollection_id`.
/// This is the exact column whose absence caused the v1.2.0 crash.
#[tokio::test]
async fn test_upgrade_from_v110_entry_collections_has_subcollection_id() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    let cols = column_names(&pool, "entry_collections").await;
    assert!(
        cols.contains(&"subcollection_id".to_string()),
        "entry_collections.subcollection_id must exist after upgrade — \
         absence of this column caused the v1.2.0 startup crash"
    );
}

/// After upgrading, the new tables introduced in v1.2.0 must exist.
#[tokio::test]
async fn test_upgrade_from_v110_new_tables_exist() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    assert!(table_exists(&pool, "subcollections").await,    "subcollections table must exist after upgrade");
    assert!(table_exists(&pool, "collection_rules").await,  "collection_rules table must exist after upgrade");
    assert!(table_exists(&pool, "languages").await,         "languages table must exist after upgrade");
}

/// All queries executed by the bootstrap command must succeed after upgrade.
/// A failure here means the app would crash at startup on an upgraded database.
#[tokio::test]
async fn test_upgrade_from_v110_bootstrap_queries_succeed() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    db::get_settings(&pool).await
        .expect("get_settings must work after upgrade");
    db::get_themes(&pool).await
        .expect("get_themes must work after upgrade");
    db::get_content_types(&pool).await
        .expect("get_content_types must work after upgrade");
    db::get_collections(&pool).await
        .expect("get_collections must work after upgrade");
    db::get_collection_counts(&pool).await
        .expect("get_collection_counts must work after upgrade");
    db::get_all_subcollections(&pool).await
        .expect("get_all_subcollections must work after upgrade");
    db::get_entry_counts(&pool).await
        .expect("get_entry_counts must work after upgrade");
}

/// Seed data (categories, content types, themes) is fully applied after upgrade.
#[tokio::test]
async fn test_upgrade_from_v110_seed_data_applied() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    let types = db::get_content_types(&pool).await.unwrap();
    let type_names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
    assert!(type_names.contains(&"image"),    "image content type must be seeded on upgrade");
    assert!(type_names.contains(&"markdown"), "markdown content type must be seeded on upgrade");
    assert!(type_names.contains(&"shell"),    "shell content type must be seeded on upgrade");

    let themes = db::get_themes(&pool).await.unwrap();
    assert!(!themes.is_empty(), "themes must be seeded after upgrade");

    let (all, _) = db::get_entry_counts(&pool).await.unwrap();
    assert_eq!(all, 3, "pre-existing entry count must be unchanged after seeding");
}

/// Entries written before the upgrade remain readable via save_entry queries.
#[tokio::test]
async fn test_upgrade_from_v110_existing_entries_readable() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    // Save a new entry to confirm write path works after migration
    let entry = db::save_entry(&pool, "post-upgrade entry".to_string(), "text", None, None, None)
        .await
        .expect("save_entry must work after upgrade");
    assert_eq!(entry.content, "post-upgrade entry");
    assert!(entry.alias.is_none());

    let (all, _) = db::get_entry_counts(&pool).await.unwrap();
    assert_eq!(all, 4, "3 pre-existing + 1 new = 4 entries");
}

/// Running migrations twice on the same database must not produce an error.
/// Guards against non-idempotent statements being added to run_migrations.
#[tokio::test]
async fn test_upgrade_is_idempotent() {
    let pool = make_empty_pool().await;
    build_v110_schema(&pool).await;
    db::run_migrations_for_test(&pool).await.unwrap();

    // Second run must also succeed
    db::run_migrations_for_test(&pool).await
        .expect("running migrations twice must be idempotent");

    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entries")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 3, "idempotent migration must not duplicate entries");
}

// ── Schema invariant tests (fresh install) ────────────────────────────────────
//
// These verify that the current fresh-install schema has all expected columns.
// Regression guard: if a column is accidentally removed from create_fresh_schema
// the test fails immediately — before any upgrade path is affected.

#[tokio::test]
async fn test_fresh_schema_entries_columns() {
    let pool = db::init_test_pool().await.unwrap();
    let cols = column_names(&pool, "entries").await;
    for expected in &["id", "content", "content_type", "category_id", "source_app",
                      "window_title", "alias", "manual_override", "created_at"] {
        assert!(cols.contains(&expected.to_string()), "entries.{expected} must exist in fresh schema");
    }
}

#[tokio::test]
async fn test_fresh_schema_entry_collections_columns() {
    let pool = db::init_test_pool().await.unwrap();
    let cols = column_names(&pool, "entry_collections").await;
    for expected in &["entry_id", "collection_id", "subcollection_id"] {
        assert!(cols.contains(&expected.to_string()), "entry_collections.{expected} must exist in fresh schema");
    }
}

#[tokio::test]
async fn test_fresh_schema_all_tables_exist() {
    let pool = db::init_test_pool().await.unwrap();
    for table in &["categories", "content_types", "entries", "settings",
                   "collections", "subcollections", "entry_collections",
                   "context_rules", "content_type_rules", "collection_rules",
                   "themes", "languages"] {
        assert!(table_exists(&pool, table).await, "table '{table}' must exist in fresh schema");
    }
}
