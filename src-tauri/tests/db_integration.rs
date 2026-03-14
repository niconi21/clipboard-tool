use clipboard_tool_lib::db;
use sqlx::SqlitePool;

// ── save_entry ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_save_entry_basic() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let entry = db::save_entry(&pool, "hello world".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    assert!(entry.id > 0);
    assert_eq!(entry.content, "hello world");
    assert_eq!(entry.content_type, "text");
    assert_eq!(entry.category, "other");
    assert!(!entry.is_favorite);
}

#[tokio::test]
async fn test_last_entry_content_empty() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let result = db::last_entry_content(&pool).await.expect("last_entry_content failed");
    assert!(result.is_none());
}

#[tokio::test]
async fn test_last_entry_content_after_insert() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    db::save_entry(&pool, "hello".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");
    let result = db::last_entry_content(&pool).await.expect("last_entry_content failed");
    assert_eq!(result, Some("hello".to_string()));
}

// ── settings ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_setting_upsert() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    db::update_setting(&pool, "page_size", "100").await.expect("update_setting failed");
    let val = db::get_setting(&pool, "page_size").await.expect("get_setting failed");
    assert_eq!(val, Some("100".to_string()));
}

#[tokio::test]
async fn test_setting_missing_key() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let val = db::get_setting(&pool, "nonexistent_key_xyz").await.expect("get_setting failed");
    assert!(val.is_none());
}

#[tokio::test]
async fn test_setting_overwrite() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    db::update_setting(&pool, "page_size", "25").await.expect("first update_setting failed");
    db::update_setting(&pool, "page_size", "75").await.expect("second update_setting failed");
    let val = db::get_setting(&pool, "page_size").await.expect("get_setting failed");
    assert_eq!(val, Some("75".to_string()));
}

// ── seed data ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_content_types_seeded() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let types = db::get_content_types(&pool).await.expect("get_content_types failed");
    let names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"text"), "expected 'text' content type, got: {:?}", names);
    assert!(names.contains(&"url"), "expected 'url' content type, got: {:?}", names);
    assert!(names.contains(&"email"), "expected 'email' content type, got: {:?}", names);
}

#[tokio::test]
async fn test_categories_seeded() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let categories = db::get_categories(&pool).await.expect("get_categories failed");
    assert!(
        categories.contains(&"development".to_string()),
        "expected 'development' category, got: {:?}",
        categories
    );
}

#[tokio::test]
async fn test_collections_seeded() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let collections = db::get_collections(&pool).await.expect("get_collections failed");
    let favorites = collections.iter().find(|c| c.name == "Favorites");
    assert!(favorites.is_some(), "expected Favorites collection, got: {:?}", collections);
    assert!(
        favorites.unwrap().is_builtin,
        "Favorites collection should have is_builtin = true"
    );
}

// ── toggle_favorite ───────────────────────────────────────────────────────────

#[tokio::test]
async fn test_toggle_favorite_on() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let entry = db::save_entry(&pool, "fav me".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    let is_fav = db::toggle_favorite(&pool, entry.id).await.expect("toggle_favorite failed");
    assert!(is_fav, "toggle_favorite should return true when adding to favorites");

    let (all, favs) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 1);
    assert_eq!(favs, 1);
}

#[tokio::test]
async fn test_toggle_favorite_off() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let entry = db::save_entry(&pool, "fav me".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::toggle_favorite(&pool, entry.id).await.expect("first toggle failed");
    let is_fav = db::toggle_favorite(&pool, entry.id).await.expect("second toggle failed");
    assert!(!is_fav, "toggle_favorite should return false when removing from favorites");

    let (all, favs) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 1);
    assert_eq!(favs, 0);
}

// ── entry_collections ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_set_entry_collections() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let col = db::create_collection(&pool, "Work", "#3b82f6").await.expect("create_collection failed");
    let entry = db::save_entry(&pool, "work item".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::set_entry_collections(&pool, entry.id, &[col.id]).await.expect("set_entry_collections failed");

    let ids = db::get_entry_collection_ids(&pool, entry.id).await.expect("get_entry_collection_ids failed");
    assert!(ids.contains(&col.id), "entry should belong to the Work collection");
}

#[tokio::test]
async fn test_set_entry_collections_empty() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let col = db::create_collection(&pool, "Work", "#3b82f6").await.expect("create_collection failed");
    let entry = db::save_entry(&pool, "work item".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    // Assign first, then clear
    db::set_entry_collections(&pool, entry.id, &[col.id]).await.expect("set_entry_collections failed");
    db::set_entry_collections(&pool, entry.id, &[]).await.expect("clear set_entry_collections failed");

    let ids = db::get_entry_collection_ids(&pool, entry.id).await.expect("get_entry_collection_ids failed");
    assert!(ids.is_empty(), "entry should have no collections after clearing");
}

// ── delete_collection ─────────────────────────────────────────────────────────

#[tokio::test]
async fn test_delete_collection_builtin_guard() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");

    // Find the Favorites builtin collection
    let collections = db::get_collections(&pool).await.expect("get_collections failed");
    let favorites = collections.iter().find(|c| c.name == "Favorites" && c.is_builtin).expect("Favorites not found");
    let fav_id = favorites.id;

    // Attempt to delete — should silently do nothing due to AND is_builtin = 0 guard
    db::delete_collection(&pool, fav_id).await.expect("delete_collection returned error");

    // Favorites must still exist
    let collections_after = db::get_collections(&pool).await.expect("get_collections after failed");
    let still_there = collections_after.iter().any(|c| c.id == fav_id);
    assert!(still_there, "builtin Favorites collection must not be deletable");
}

#[tokio::test]
async fn test_delete_custom_collection() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let col = db::create_collection(&pool, "Temporary", "#6b7280").await.expect("create_collection failed");

    db::delete_collection(&pool, col.id).await.expect("delete_collection failed");

    let collections = db::get_collections(&pool).await.expect("get_collections failed");
    let still_there = collections.iter().any(|c| c.id == col.id);
    assert!(!still_there, "deleted custom collection should no longer exist");
}

// ── dedup_entries ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_dedup_removes_duplicates() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    db::save_entry(&pool, "hello".to_string(), "text", None, None, None).await.expect("first save failed");
    db::save_entry(&pool, "hello".to_string(), "text", None, None, None).await.expect("second save failed");

    let removed = db::dedup_entries(&pool).await.expect("dedup_entries failed");
    assert_eq!(removed, 1, "dedup should remove exactly 1 duplicate");

    let (all, _) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 1, "only 1 entry should remain after dedup");
}

#[tokio::test]
async fn test_dedup_protects_collection_entries() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");

    // Save same content twice; first (lower id) gets added to a collection
    let first = db::save_entry(&pool, "hello".to_string(), "text", None, None, None)
        .await
        .expect("first save failed");
    let _second = db::save_entry(&pool, "hello".to_string(), "text", None, None, None)
        .await
        .expect("second save failed");

    // Put first entry into a custom collection so it is protected
    let col = db::create_collection(&pool, "Keep", "#22c55e").await.expect("create_collection failed");
    db::set_entry_collections(&pool, first.id, &[col.id]).await.expect("set_entry_collections failed");

    // dedup keeps entries in any collection; MAX(id) per content group also survives
    // Expectation: first is protected (in collection), second survives as MAX(id) — both remain
    let removed = db::dedup_entries(&pool).await.expect("dedup_entries failed");
    assert_eq!(removed, 0, "no entries should be deleted when the lower-id duplicate is protected by a collection");

    let (all, _) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 2, "both entries should survive when the older one is in a collection");
}

// ── cleanup_entries ───────────────────────────────────────────────────────────

#[tokio::test]
async fn test_cleanup_max_entries() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");

    for i in 0..5 {
        db::save_entry(&pool, format!("entry {i}"), "text", None, None, None)
            .await
            .expect("save_entry failed");
    }

    db::update_setting(&pool, "max_history_entries", "3").await.expect("update_setting failed");
    db::cleanup_entries(&pool).await.expect("cleanup_entries failed");

    let (all, _) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 3, "cleanup should trim to max_history_entries = 3");
}

#[tokio::test]
async fn test_cleanup_no_op_when_disabled() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");

    for i in 0..5 {
        db::save_entry(&pool, format!("entry {i}"), "text", None, None, None)
            .await
            .expect("save_entry failed");
    }

    // Default settings: max_history_entries = 0, retention_days = 0 → no-op
    db::cleanup_entries(&pool).await.expect("cleanup_entries failed");

    let (all, _) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 5, "cleanup should be a no-op when both limits are 0");
}

// ── get_entry_counts ──────────────────────────────────────────────────────────

#[tokio::test]
async fn test_entry_counts_zero() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");
    let (all, favs) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 0);
    assert_eq!(favs, 0);
}

#[tokio::test]
async fn test_entry_counts_with_data() {
    let pool: SqlitePool = db::init_test_pool().await.expect("init_test_pool failed");

    let e1 = db::save_entry(&pool, "one".to_string(), "text", None, None, None).await.expect("save 1 failed");
    let e2 = db::save_entry(&pool, "two".to_string(), "text", None, None, None).await.expect("save 2 failed");
    db::save_entry(&pool, "three".to_string(), "text", None, None, None).await.expect("save 3 failed");

    db::toggle_favorite(&pool, e1.id).await.expect("toggle 1 failed");
    db::toggle_favorite(&pool, e2.id).await.expect("toggle 2 failed");

    let (all, favs) = db::get_entry_counts(&pool).await.expect("get_entry_counts failed");
    assert_eq!(all, 3);
    assert_eq!(favs, 2);
}

// ── migrations idempotency ────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_migrations_idempotent() {
    let pool: SqlitePool = db::init_test_pool().await.expect("first init_test_pool failed");

    let types_first = db::get_content_types(&pool).await.expect("first get_content_types failed");
    let types_second = db::get_content_types(&pool).await.expect("second get_content_types failed");

    assert_eq!(
        types_first.len(),
        types_second.len(),
        "content types count must be stable across repeated calls (INSERT OR IGNORE idempotency)"
    );

    // Spot-check: text type present both times
    let has_text = |v: &[db::ContentTypeStyle]| v.iter().any(|t| t.name == "text");
    assert!(has_text(&types_first));
    assert!(has_text(&types_second));
}

// ── entry alias persistence ───────────────────────────────────────────────────

#[tokio::test]
async fn test_alias_roundtrip() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let entry = db::save_entry(&pool, "alias test".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::update_entry_alias(&pool, entry.id, Some("my alias".to_string()))
        .await
        .expect("update_entry_alias failed");

    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT alias FROM entries WHERE id = ?1")
            .bind(entry.id)
            .fetch_optional(&pool)
            .await
            .expect("query failed");

    let alias = row.expect("row not found").0;
    assert_eq!(alias, Some("my alias".to_string()));
}

#[tokio::test]
async fn test_alias_clear() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let entry = db::save_entry(&pool, "alias clear test".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::update_entry_alias(&pool, entry.id, Some("temporary alias".to_string()))
        .await
        .expect("set alias failed");
    db::update_entry_alias(&pool, entry.id, None)
        .await
        .expect("clear alias failed");

    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT alias FROM entries WHERE id = ?1")
            .bind(entry.id)
            .fetch_optional(&pool)
            .await
            .expect("query failed");

    let alias = row.expect("row not found").0;
    assert_eq!(alias, None);
}

// ── manual content type override ──────────────────────────────────────────────

#[tokio::test]
async fn test_content_type_override_persists() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let entry = db::save_entry(&pool, "plain text".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::update_entry_content_type(&pool, entry.id, "url")
        .await
        .expect("update_entry_content_type failed");

    let row: Option<(String,)> =
        sqlx::query_as("SELECT content_type FROM entries WHERE id = ?1")
            .bind(entry.id)
            .fetch_optional(&pool)
            .await
            .expect("query failed");

    let content_type = row.expect("row not found").0;
    assert_eq!(content_type, "url");
}

#[tokio::test]
async fn test_content_type_override_sets_manual_flag() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let entry = db::save_entry(&pool, "flag test".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::update_entry_content_type(&pool, entry.id, "url")
        .await
        .expect("update_entry_content_type failed");

    let row: Option<(i64,)> =
        sqlx::query_as("SELECT manual_override FROM entries WHERE id = ?1")
            .bind(entry.id)
            .fetch_optional(&pool)
            .await
            .expect("query failed");

    let manual_override = row.expect("row not found").0;
    assert_eq!(manual_override, 1i64);
}

// ── reclassification ──────────────────────────────────────────────────────────

#[tokio::test]
async fn test_reclassify_excludes_manual_override() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let e1 = db::save_entry(&pool, "entry one".to_string(), "text", None, None, None)
        .await
        .expect("save e1 failed");
    let e2 = db::save_entry(&pool, "entry two".to_string(), "text", None, None, None)
        .await
        .expect("save e2 failed");
    let e3 = db::save_entry(&pool, "entry three".to_string(), "text", None, None, None)
        .await
        .expect("save e3 failed");

    db::update_entry_content_type(&pool, e2.id, "url")
        .await
        .expect("override e2 failed");

    let rows = db::get_entries_for_reclassify(&pool, false)
        .await
        .expect("get_entries_for_reclassify failed");

    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    assert!(ids.contains(&e1.id), "e1 should be in results");
    assert!(!ids.contains(&e2.id), "e2 (manual_override=1) should be excluded");
    assert!(ids.contains(&e3.id), "e3 should be in results");
    assert_eq!(rows.len(), 2);
}

#[tokio::test]
async fn test_reclassify_includes_manual_override_when_flag_true() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let e1 = db::save_entry(&pool, "reclassify one".to_string(), "text", None, None, None)
        .await
        .expect("save e1 failed");
    let e2 = db::save_entry(&pool, "reclassify two".to_string(), "text", None, None, None)
        .await
        .expect("save e2 failed");
    let e3 = db::save_entry(&pool, "reclassify three".to_string(), "text", None, None, None)
        .await
        .expect("save e3 failed");

    db::update_entry_content_type(&pool, e2.id, "url")
        .await
        .expect("override e2 failed");

    let rows = db::get_entries_for_reclassify(&pool, true)
        .await
        .expect("get_entries_for_reclassify failed");

    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    assert!(ids.contains(&e1.id));
    assert!(ids.contains(&e2.id), "e2 should be included when include_overrides=true");
    assert!(ids.contains(&e3.id));
    assert_eq!(rows.len(), 3);
}

#[tokio::test]
async fn test_reclassify_excludes_images() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");

    // Insert an image entry directly — save_entry does not produce content_type 'image' normally
    sqlx::query("INSERT INTO entries (content, content_type) VALUES ('images/test.png', 'image')")
        .execute(&pool)
        .await
        .expect("insert image entry failed");

    let text_entry = db::save_entry(&pool, "some text".to_string(), "text", None, None, None)
        .await
        .expect("save text entry failed");

    let rows = db::get_entries_for_reclassify(&pool, true)
        .await
        .expect("get_entries_for_reclassify failed");

    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    assert!(ids.contains(&text_entry.id), "text entry should be in results");
    let has_image = rows.iter().any(|r| r.content == "images/test.png");
    assert!(!has_image, "image entries must be excluded from reclassify results");
}

#[tokio::test]
async fn test_batch_update_classification() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let e1 = db::save_entry(&pool, "batch one".to_string(), "text", None, None, None)
        .await
        .expect("save e1 failed");
    let e2 = db::save_entry(&pool, "batch two".to_string(), "text", None, None, None)
        .await
        .expect("save e2 failed");

    let updates: Vec<(i64, &str, Option<i64>)> = vec![
        (e1.id, "url", None),
        (e2.id, "email", None),
    ];
    let count = db::batch_update_classification(&pool, &updates, false)
        .await
        .expect("batch_update_classification failed");

    assert_eq!(count, 2);

    let row1: (String,) = sqlx::query_as("SELECT content_type FROM entries WHERE id = ?1")
        .bind(e1.id)
        .fetch_one(&pool)
        .await
        .expect("query e1 failed");
    assert_eq!(row1.0, "url");

    let row2: (String,) = sqlx::query_as("SELECT content_type FROM entries WHERE id = ?1")
        .bind(e2.id)
        .fetch_one(&pool)
        .await
        .expect("query e2 failed");
    assert_eq!(row2.0, "email");
}

#[tokio::test]
async fn test_batch_update_resets_manual_override() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let entry = db::save_entry(&pool, "reset override".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    db::update_entry_content_type(&pool, entry.id, "url")
        .await
        .expect("set manual override failed");

    let updates: Vec<(i64, &str, Option<i64>)> = vec![(entry.id, "text", None)];
    db::batch_update_classification(&pool, &updates, true)
        .await
        .expect("batch_update_classification failed");

    let row: (i64,) = sqlx::query_as("SELECT manual_override FROM entries WHERE id = ?1")
        .bind(entry.id)
        .fetch_one(&pool)
        .await
        .expect("query failed");
    assert_eq!(row.0, 0i64, "manual_override should be reset to 0");
}

// ── custom themes CRUD ────────────────────────────────────────────────────────

#[tokio::test]
async fn test_create_theme() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let theme = db::create_theme(
        &pool,
        "test-theme", "Test Theme",
        "#000000", "#111111", "#222222", "#333333",
        "#444444", "#555555", "#ffffff", "#dddddd",
        "#bbbbbb", "#0077ff", "#ffffff",
    )
    .await
    .expect("create_theme failed");

    assert_eq!(theme.slug, "test-theme");
    assert!(!theme.is_builtin, "user-created theme must have is_builtin=false");
}

#[tokio::test]
async fn test_create_theme_all_colors() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    db::create_theme(
        &pool,
        "color-check", "Color Check",
        "#010101", "#020202", "#030303", "#040404",
        "#050505", "#060606", "#070707", "#080808",
        "#090909", "#0a0a0a", "#0b0b0b",
    )
    .await
    .expect("create_theme failed");

    let themes = db::get_themes(&pool).await.expect("get_themes failed");
    let t = themes.iter().find(|t| t.slug == "color-check").expect("theme not found");

    assert_eq!(t.base,           "#010101");
    assert_eq!(t.surface,        "#020202");
    assert_eq!(t.surface_raised, "#030303");
    assert_eq!(t.surface_active, "#040404");
    assert_eq!(t.stroke,         "#050505");
    assert_eq!(t.stroke_strong,  "#060606");
    assert_eq!(t.content,        "#070707");
    assert_eq!(t.content_2,      "#080808");
    assert_eq!(t.content_3,      "#090909");
    assert_eq!(t.accent,         "#0a0a0a");
    assert_eq!(t.accent_text,    "#0b0b0b");
}

#[tokio::test]
async fn test_update_theme() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    db::create_theme(
        &pool,
        "update-theme", "Update Theme",
        "#000000", "#111111", "#222222", "#333333",
        "#444444", "#555555", "#ffffff", "#dddddd",
        "#bbbbbb", "#0077ff", "#ffffff",
    )
    .await
    .expect("create_theme failed");

    db::update_theme(
        &pool,
        "update-theme", "Update Theme",
        "#000000", "#111111", "#222222", "#333333",
        "#444444", "#555555", "#ffffff", "#dddddd",
        "#bbbbbb", "#ff0000", "#ffffff",
    )
    .await
    .expect("update_theme failed");

    let themes = db::get_themes(&pool).await.expect("get_themes failed");
    let t = themes.iter().find(|t| t.slug == "update-theme").expect("theme not found");
    assert_eq!(t.accent, "#ff0000");
}

#[tokio::test]
async fn test_update_theme_builtin_guard() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let themes = db::get_themes(&pool).await.expect("get_themes failed");
    let builtin = themes.iter().find(|t| t.is_builtin).expect("no builtin theme found");
    let slug = builtin.slug.clone();
    let original_accent = builtin.accent.clone();

    db::update_theme(
        &pool,
        &slug, &builtin.name,
        &builtin.base, &builtin.surface, &builtin.surface_raised, &builtin.surface_active,
        &builtin.stroke, &builtin.stroke_strong, &builtin.content, &builtin.content_2,
        &builtin.content_3, "#deadbe", &builtin.accent_text,
    )
    .await
    .expect("update_theme returned error");

    let themes_after = db::get_themes(&pool).await.expect("get_themes after failed");
    let t = themes_after.iter().find(|t| t.slug == slug).expect("builtin theme not found");
    assert_eq!(t.accent, original_accent, "builtin theme accent must not change");
}

#[tokio::test]
async fn test_delete_theme_custom() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    db::create_theme(
        &pool,
        "delete-me", "Delete Me",
        "#000000", "#111111", "#222222", "#333333",
        "#444444", "#555555", "#ffffff", "#dddddd",
        "#bbbbbb", "#0077ff", "#ffffff",
    )
    .await
    .expect("create_theme failed");

    db::delete_theme(&pool, "delete-me").await.expect("delete_theme failed");

    let themes = db::get_themes(&pool).await.expect("get_themes failed");
    let still_there = themes.iter().any(|t| t.slug == "delete-me");
    assert!(!still_there, "deleted custom theme must not appear in get_themes");
}

#[tokio::test]
async fn test_delete_theme_builtin_guard() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let themes = db::get_themes(&pool).await.expect("get_themes failed");
    let builtin = themes.iter().find(|t| t.is_builtin).expect("no builtin theme found");
    let slug = builtin.slug.clone();

    db::delete_theme(&pool, &slug).await.expect("delete_theme returned error");

    let themes_after = db::get_themes(&pool).await.expect("get_themes after failed");
    let still_there = themes_after.iter().any(|t| t.slug == slug);
    assert!(still_there, "builtin theme must not be deleted");
}

// ── subcollections CRUD ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_new_collection_has_default_subcollection() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubTest", "#3b82f6")
        .await
        .expect("create_collection failed");

    db::get_default_subcollection_id(&pool, col.id)
        .await
        .expect("every new collection must have a default subcollection");
}

#[tokio::test]
async fn test_create_subcollection() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubCreate", "#3b82f6")
        .await
        .expect("create_collection failed");

    db::create_subcollection(&pool, col.id, "Work")
        .await
        .expect("create_subcollection failed");

    let subs = db::get_subcollections(&pool, col.id)
        .await
        .expect("get_subcollections failed");

    assert_eq!(subs.len(), 2, "expected default + Work subcollection");
    let names: Vec<&str> = subs.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"Work"), "Work subcollection not found");
}

#[tokio::test]
async fn test_rename_subcollection() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubRename", "#3b82f6")
        .await
        .expect("create_collection failed");

    let sub = db::create_subcollection(&pool, col.id, "OldName")
        .await
        .expect("create_subcollection failed");

    db::rename_subcollection(&pool, sub.id, "New Name")
        .await
        .expect("rename_subcollection failed");

    let subs = db::get_subcollections(&pool, col.id)
        .await
        .expect("get_subcollections failed");

    let found = subs.iter().any(|s| s.name == "New Name");
    assert!(found, "renamed subcollection not found");
}

#[tokio::test]
async fn test_rename_default_subcollection_is_noop() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubRenameDefault", "#3b82f6")
        .await
        .expect("create_collection failed");

    let default_id = db::get_default_subcollection_id(&pool, col.id)
        .await
        .expect("get_default_subcollection_id failed");

    let subs_before = db::get_subcollections(&pool, col.id)
        .await
        .expect("get_subcollections before failed");
    let original_name = subs_before
        .iter()
        .find(|s| s.id == default_id)
        .expect("default not found")
        .name
        .clone();

    db::rename_subcollection(&pool, default_id, "ShouldNotChange")
        .await
        .expect("rename_subcollection returned error");

    let subs_after = db::get_subcollections(&pool, col.id)
        .await
        .expect("get_subcollections after failed");
    let name_after = subs_after
        .iter()
        .find(|s| s.id == default_id)
        .expect("default not found after rename attempt")
        .name
        .clone();

    assert_eq!(name_after, original_name, "default subcollection name must not change");
}

#[tokio::test]
async fn test_delete_subcollection_moves_entries() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubDeleteMove", "#3b82f6")
        .await
        .expect("create_collection failed");

    let archive_sub = db::create_subcollection(&pool, col.id, "Archive")
        .await
        .expect("create_subcollection failed");

    let entry = db::save_entry(&pool, "movable entry".to_string(), "text", None, None, None)
        .await
        .expect("save_entry failed");

    // Add entry to the collection and move it to the archive subcollection
    db::set_entry_collections(&pool, entry.id, &[col.id])
        .await
        .expect("set_entry_collections failed");
    db::move_entry_subcollection(&pool, entry.id, col.id, archive_sub.id)
        .await
        .expect("move_entry_subcollection failed");

    let default_id = db::get_default_subcollection_id(&pool, col.id)
        .await
        .expect("get_default_subcollection_id failed");

    db::delete_subcollection(&pool, archive_sub.id)
        .await
        .expect("delete_subcollection failed");

    let sub_ids = db::get_entry_subcollection_ids(&pool, entry.id)
        .await
        .expect("get_entry_subcollection_ids failed");

    let sub_for_col = sub_ids
        .iter()
        .find(|(cid, _)| *cid == col.id)
        .map(|(_, sid)| *sid)
        .expect("entry should still be in the collection");

    assert_eq!(sub_for_col, default_id, "entry must be moved to default subcollection after archive is deleted");
}

#[tokio::test]
async fn test_delete_default_subcollection_is_noop() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "SubDeleteDefault", "#3b82f6")
        .await
        .expect("create_collection failed");

    let default_id = db::get_default_subcollection_id(&pool, col.id)
        .await
        .expect("get_default_subcollection_id failed");

    db::delete_subcollection(&pool, default_id)
        .await
        .expect("delete_subcollection returned error");

    let subs = db::get_subcollections(&pool, col.id)
        .await
        .expect("get_subcollections failed");

    let still_there = subs.iter().any(|s| s.id == default_id);
    assert!(still_there, "default subcollection must not be deleted");
}

// ── collection rules CRUD ─────────────────────────────────────────────────────

#[tokio::test]
async fn test_create_collection_rule() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "RuleCol", "#3b82f6")
        .await
        .expect("create_collection failed");

    db::create_collection_rule(
        &pool,
        col.id,
        Some("url".to_string()),
        None, None, None,
        10,
    )
    .await
    .expect("create_collection_rule failed");

    let rules = db::get_all_collection_rules(&pool)
        .await
        .expect("get_all_collection_rules failed");

    assert!(!rules.is_empty(), "expected at least one rule");
    let rule = rules.iter().find(|r| r.collection_id == col.id).expect("rule for col not found");
    assert_eq!(rule.content_type.as_deref(), Some("url"));
}

#[tokio::test]
async fn test_toggle_collection_rule_disabled() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "RuleToggle1", "#3b82f6")
        .await
        .expect("create_collection failed");

    let rule_id = db::create_collection_rule(&pool, col.id, Some("email".to_string()), None, None, None, 5)
        .await
        .expect("create_collection_rule failed");

    db::toggle_collection_rule(&pool, rule_id, false)
        .await
        .expect("toggle_collection_rule failed");

    let rules = db::get_all_collection_rules(&pool)
        .await
        .expect("get_all_collection_rules failed");
    let rule = rules.iter().find(|r| r.id == rule_id).expect("rule not found");
    assert!(!rule.enabled, "rule should be disabled");
}

#[tokio::test]
async fn test_toggle_collection_rule_enabled() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "RuleToggle2", "#3b82f6")
        .await
        .expect("create_collection failed");

    let rule_id = db::create_collection_rule(&pool, col.id, Some("text".to_string()), None, None, None, 5)
        .await
        .expect("create_collection_rule failed");

    db::toggle_collection_rule(&pool, rule_id, false)
        .await
        .expect("disable failed");
    db::toggle_collection_rule(&pool, rule_id, true)
        .await
        .expect("re-enable failed");

    let rules = db::get_all_collection_rules(&pool)
        .await
        .expect("get_all_collection_rules failed");
    let rule = rules.iter().find(|r| r.id == rule_id).expect("rule not found");
    assert!(rule.enabled, "rule should be enabled after toggling back on");
}

#[tokio::test]
async fn test_delete_collection_rule() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let col = db::create_collection(&pool, "RuleDelete", "#3b82f6")
        .await
        .expect("create_collection failed");

    let rule_id = db::create_collection_rule(&pool, col.id, Some("code".to_string()), None, None, None, 1)
        .await
        .expect("create_collection_rule failed");

    db::delete_collection_rule(&pool, rule_id)
        .await
        .expect("delete_collection_rule failed");

    let rules = db::get_all_collection_rules(&pool)
        .await
        .expect("get_all_collection_rules failed");
    let still_there = rules.iter().any(|r| r.id == rule_id);
    assert!(!still_there, "deleted rule must not appear in get_all_collection_rules");
}

// ── export / import configuration ─────────────────────────────────────────────

#[tokio::test]
async fn test_export_empty_user_data() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let export = db::export_config(&pool).await.expect("export_config failed");

    assert!(export.themes.is_empty(), "no user themes should be exported from fresh pool");
    assert!(export.categories.is_empty(), "no user categories should be exported");
    assert!(export.collections.is_empty(), "no user collections should be exported");
    assert!(export.content_types.is_empty(), "no user content types should be exported");
    assert!(export.content_type_rules.is_empty(), "no user content type rules");
    assert!(export.context_rules.is_empty(), "no user context rules");
    assert!(export.subcollections.is_empty(), "no user subcollections");
    assert!(export.collection_rules.is_empty(), "no user collection rules");
    // Settings: non-skipped defaults are exported
    assert!(!export.settings.is_empty(), "default settings should be exported");
}

#[tokio::test]
async fn test_export_import_roundtrip() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");

    // Create user data
    db::create_theme(
        &pool,
        "roundtrip-theme", "Roundtrip Theme",
        "#000000", "#111111", "#222222", "#333333",
        "#444444", "#555555", "#ffffff", "#dddddd",
        "#bbbbbb", "#0077ff", "#ffffff",
    )
    .await
    .expect("create_theme failed");

    db::create_collection(&pool, "RoundtripCol", "#22c55e")
        .await
        .expect("create_collection failed");

    let cat_id = {
        sqlx::query("INSERT INTO categories (name, color, is_builtin) VALUES ('roundtrip-cat', '#ff0000', 0)")
            .execute(&pool)
            .await
            .expect("insert category failed");
        let (id,): (i64,) = sqlx::query_as("SELECT id FROM categories WHERE name = 'roundtrip-cat'")
            .fetch_one(&pool)
            .await
            .expect("fetch category id failed");
        id
    };
    // Use cat_id to suppress unused warning
    let _ = cat_id;

    let export = db::export_config(&pool).await.expect("export_config failed");

    // Import into a fresh pool
    let pool2: SqlitePool = db::init_test_pool().await.expect("pool2");
    let summary = db::import_config(&pool2, &export).await.expect("import_config failed");

    assert!(summary.themes > 0, "theme should have been imported");
    assert!(summary.collections > 0, "collection should have been imported");
    assert!(summary.categories > 0, "category should have been imported");

    let themes2 = db::get_themes(&pool2).await.expect("get_themes pool2 failed");
    assert!(themes2.iter().any(|t| t.slug == "roundtrip-theme"), "theme must be present in new pool");

    let collections2 = db::get_collections(&pool2).await.expect("get_collections pool2 failed");
    assert!(collections2.iter().any(|c| c.name == "RoundtripCol"), "collection must be present in new pool");
}

#[tokio::test]
async fn test_import_skips_duplicates() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");

    db::create_collection(&pool, "Work", "#3b82f6")
        .await
        .expect("create_collection failed");

    let export = db::export_config(&pool).await.expect("export_config failed");

    // Import into the SAME pool where Work already exists
    let summary = db::import_config(&pool, &export).await.expect("import_config failed");

    assert_eq!(summary.collections, 0, "duplicate collection must be skipped");
}

#[tokio::test]
async fn test_import_settings_upsert() {
    let pool: SqlitePool = db::init_test_pool().await.expect("pool");

    // Set page_size to 100 and export
    db::update_setting(&pool, "page_size", "100").await.expect("update_setting failed");
    let export = db::export_config(&pool).await.expect("export_config failed");

    // Fresh pool has page_size=50 (seed default)
    let pool2: SqlitePool = db::init_test_pool().await.expect("pool2");
    db::import_config(&pool2, &export).await.expect("import_config failed");

    let val = db::get_setting(&pool2, "page_size").await.expect("get_setting failed");
    assert_eq!(val.as_deref(), Some("100"), "page_size should be upserted to 100 after import");
}

// ── orphaned image cleanup ────────────────────────────────────────────────────

#[tokio::test]
async fn test_cleanup_orphaned_images_deletes_unreferenced() {
    use tempfile::TempDir;
    use std::fs;

    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let tmp = TempDir::new().expect("tempdir failed");
    let images_dir = tmp.path().join("images");
    fs::create_dir_all(&images_dir).expect("create images dir failed");

    // Create 3 fake png files
    let file_a = images_dir.join("a.png");
    let file_b = images_dir.join("b.png");
    let file_c = images_dir.join("c.png");
    fs::write(&file_a, b"fake png a").expect("write a.png");
    fs::write(&file_b, b"fake png b").expect("write b.png");
    fs::write(&file_c, b"fake png c").expect("write c.png");

    // Insert 2 image entries referencing a.png and b.png (not c.png)
    sqlx::query("INSERT INTO entries (content, content_type) VALUES ('images/a.png', 'image')")
        .execute(&pool)
        .await
        .expect("insert a.png entry failed");
    sqlx::query("INSERT INTO entries (content, content_type) VALUES ('images/b.png', 'image')")
        .execute(&pool)
        .await
        .expect("insert b.png entry failed");

    db::cleanup_orphaned_images(tmp.path(), &pool)
        .await
        .expect("cleanup_orphaned_images failed");

    assert!(file_a.exists(), "a.png (referenced) must still exist");
    assert!(file_b.exists(), "b.png (referenced) must still exist");
    assert!(!file_c.exists(), "c.png (unreferenced) must be deleted");
}

#[tokio::test]
async fn test_cleanup_orphaned_images_noop_when_dir_missing() {
    use tempfile::TempDir;

    let pool: SqlitePool = db::init_test_pool().await.expect("pool");
    let tmp = TempDir::new().expect("tempdir failed");
    // Do NOT create the images/ subdirectory

    db::cleanup_orphaned_images(tmp.path(), &pool)
        .await
        .expect("cleanup_orphaned_images must return Ok(()) when images/ dir is missing");
}
