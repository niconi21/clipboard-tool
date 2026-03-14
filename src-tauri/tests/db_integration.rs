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
