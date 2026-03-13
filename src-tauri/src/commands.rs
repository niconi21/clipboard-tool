use regex::Regex;
use tauri::{Manager, State};

use crate::audit::{AppLog, AuditLog};
use crate::categorizer::RulesCache;
use crate::clipboard::{AppCopiedContent, AppCopiedImageHash};
use crate::db::{
    BootstrapData, Category, ClipboardEntry, Collection, ContentRule, ContentTypeStyle,
    ContextRule, DbState, ImportSummary, Language, Setting, Subcollection, Theme,
};

// ── Error sanitization ────────────────────────────────────────────────────────

/// Log the full error internally and return a safe, non-leaking message.
fn db_err(e: sqlx::Error) -> String {
    eprintln!("[db error] {e}");
    match &e {
        sqlx::Error::RowNotFound => "Record not found".to_string(),
        sqlx::Error::Database(db_err) => {
            let msg = db_err.message();
            if msg.contains("UNIQUE") {
                "A record with that name already exists".to_string()
            } else if msg.contains("FOREIGN KEY") {
                "Referenced record does not exist".to_string()
            } else {
                "Database error".to_string()
            }
        }
        _ => "Operation failed".to_string(),
    }
}

// ── Input validation ──────────────────────────────────────────────────────────

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.len() > 256 {
        return Err("Name is too long (max 256 characters)".to_string());
    }
    Ok(())
}

fn validate_color(color: &str) -> Result<(), String> {
    if !color.starts_with('#') || (color.len() != 4 && color.len() != 7) {
        return Err("Invalid color (expected #RGB or #RRGGBB)".to_string());
    }
    if !color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid hex color value".to_string());
    }
    Ok(())
}

fn validate_regex_pattern(pattern: &str) -> Result<(), String> {
    if pattern.len() > 1000 {
        return Err("Pattern too long (max 1000 characters)".to_string());
    }
    Regex::new(pattern)
        .map(|_| ())
        .map_err(|e| format!("Invalid regex: {e}"))
}

/// Validate and log a `validation_failed` event on error.
/// Never logs the actual submitted value — only the command, field, and error.
fn audited_validate(
    audit: &AuditLog,
    result: Result<(), String>,
    cmd: &str,
    field: &str,
) -> Result<(), String> {
    if let Err(ref e) = result {
        audit.log(
            "validation_failed",
            serde_json::json!({ "cmd": cmd, "field": field, "error": e }),
        );
    }
    result
}

// ── Entries ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_entries(
    state: State<'_, DbState>,
    search: Option<String>,
    source_app: Option<String>,
    category: Option<String>,
    content_type: Option<String>,
    window_title: Option<String>,
    favorite_only: Option<bool>,
    collection_id: Option<i64>,
    subcollection_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ClipboardEntry>, String> {
    let pool = &state.0;

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if let Some(q) = search.as_deref().filter(|s| !s.is_empty()) {
        let i = params.len() + 1;
        conditions.push(format!("(entries.content LIKE ?{i} OR entries.window_title LIKE ?{i} OR entries.alias LIKE ?{i})"));
        params.push(format!("%{}%", q));
    }
    if let Some(app) = source_app.as_deref().filter(|s| !s.is_empty()) {
        conditions.push(format!("entries.source_app = ?{}", params.len() + 1));
        params.push(app.to_string());
    }
    if let Some(cat) = category.as_deref().filter(|s| !s.is_empty()) {
        if cat == "other" {
            conditions.push("entries.category_id IS NULL".to_string());
        } else {
            conditions.push(format!("cat.name = ?{}", params.len() + 1));
            params.push(cat.to_string());
        }
    }
    if let Some(ct) = content_type.as_deref().filter(|s| !s.is_empty()) {
        conditions.push(format!("entries.content_type = ?{}", params.len() + 1));
        params.push(ct.to_string());
    }
    if let Some(wt) = window_title.as_deref().filter(|s| !s.is_empty()) {
        conditions.push(format!("entries.window_title = ?{}", params.len() + 1));
        params.push(wt.to_string());
    }
    if favorite_only == Some(true) {
        conditions.push(
            "EXISTS(SELECT 1 FROM entry_collections ec
                    JOIN collections c ON ec.collection_id = c.id
                    WHERE ec.entry_id = entries.id AND c.is_builtin = 1)"
                .to_string(),
        );
    }
    if let Some(cid) = collection_id {
        if let Some(sid) = subcollection_id {
            conditions.push(format!(
                "entries.id IN (SELECT entry_id FROM entry_collections WHERE collection_id = ?{} AND subcollection_id = ?{})",
                params.len() + 1,
                params.len() + 2
            ));
            params.push(cid.to_string());
            params.push(sid.to_string());
        } else {
            conditions.push(format!(
                "entries.id IN (SELECT entry_id FROM entry_collections WHERE collection_id = ?{})",
                params.len() + 1
            ));
            params.push(cid.to_string());
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // Bind LIMIT and OFFSET as parameters — never interpolate them
    let page_limit = limit.unwrap_or(50).max(1).min(1000);
    let page_offset = offset.unwrap_or(0).max(0);
    let limit_idx = params.len() + 1;
    params.push(page_limit.to_string());
    let offset_idx = params.len() + 1;
    params.push(page_offset.to_string());

    let sql = format!(
        "SELECT entries.id, entries.content, entries.content_type,
                COALESCE(cat.name, 'other') AS category,
                entries.source_app, entries.window_title,
                {is_fav} AS is_favorite, entries.created_at,
                COALESCE(GROUP_CONCAT(DISTINCT ec_all.collection_id), '') AS collection_ids,
                entries.alias
         FROM entries
         LEFT JOIN categories cat ON cat.id = entries.category_id
         LEFT JOIN entry_collections ec_all ON ec_all.entry_id = entries.id
         {where_clause}
         GROUP BY entries.id
         ORDER BY entries.created_at DESC
         LIMIT ?{limit_idx} OFFSET ?{offset_idx}",
        is_fav = crate::db::IS_FAVORITE_SQL,
    );

    let mut query = sqlx::query_as::<_, ClipboardEntry>(&sql);
    for p in &params {
        query = query.bind(p);
    }

    query.fetch_all(pool).await.map_err(db_err)
}

#[tauri::command]
pub async fn update_entry_alias(
    state: State<'_, DbState>,
    id: i64,
    alias: Option<String>,
) -> Result<(), String> {
    let alias = alias.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    crate::db::update_entry_alias(&state.0, id, alias)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn update_entry_content_type(
    state: State<'_, DbState>,
    id: i64,
    content_type: String,
) -> Result<(), String> {
    validate_name(&content_type)?;
    crate::db::update_entry_content_type(&state.0, id, &content_type)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn reclassify_entries(
    state: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    app_log: State<'_, AppLog>,
    include_overrides: bool,
) -> Result<u64, String> {
    cache.refresh(&state.0).await;
    let rows = crate::db::get_entries_for_reclassify(&state.0, include_overrides)
        .await
        .map_err(db_err)?;

    let mut updates: Vec<(i64, String, Option<i64>)> = Vec::new();
    for row in &rows {
        let result = cache.classify(
            &row.content,
            row.source_app.as_deref(),
            row.window_title.as_deref(),
        );
        if result.content_type != row.content_type || result.category_id != row.category_id {
            updates.push((row.id, result.content_type, result.category_id));
        }
    }

    let refs: Vec<(i64, &str, Option<i64>)> = updates
        .iter()
        .map(|(id, ct, cat)| (*id, ct.as_str(), *cat))
        .collect();

    let count = crate::db::batch_update_classification(&state.0, &refs, include_overrides)
        .await
        .map_err(db_err)?;

    app_log.info("reclassify", &format!("reclassified {count} entries (include_overrides={include_overrides})"));
    Ok(count)
}

#[tauri::command]
pub async fn delete_entry(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
    collection_id: Option<i64>,
    subcollection_id: Option<i64>,
) -> Result<(), String> {
    // Context-aware deletion:
    // - subcollection_id set → move entry to default subcollection
    // - collection_id set (no subcollection_id) → unlink entry from that collection
    // - neither set → permanent delete (cascade removes associations)

    if let Some(sub_id) = subcollection_id {
        let col_id = collection_id.ok_or("collection_id required with subcollection_id")?;
        // Move to default subcollection
        let default_sub: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM subcollections WHERE collection_id = ?1 AND is_default = 1",
        )
        .bind(col_id)
        .fetch_optional(&state.0)
        .await
        .map_err(db_err)?;
        let default_id = default_sub.ok_or("No default subcollection found")?.0;
        if default_id != sub_id {
            sqlx::query(
                "UPDATE entry_collections SET subcollection_id = ?1 \
                 WHERE entry_id = ?2 AND collection_id = ?3",
            )
            .bind(default_id)
            .bind(id)
            .bind(col_id)
            .execute(&state.0)
            .await
            .map_err(db_err)?;
        }
        audit.log("entry_moved_to_default_sub", serde_json::json!({ "entry_id": id, "collection_id": col_id }));
        return Ok(());
    }

    if let Some(col_id) = collection_id {
        // Block if entry is in a non-default subcollection
        let in_sub: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT ec.subcollection_id FROM entry_collections ec \
             WHERE ec.entry_id = ?1 AND ec.collection_id = ?2",
        )
        .bind(id)
        .bind(col_id)
        .fetch_optional(&state.0)
        .await
        .map_err(db_err)?;

        if let Some((Some(sub_id),)) = in_sub {
            let is_default: Option<(bool,)> = sqlx::query_as(
                "SELECT is_default FROM subcollections WHERE id = ?1",
            )
            .bind(sub_id)
            .fetch_optional(&state.0)
            .await
            .map_err(db_err)?;
            if !is_default.map(|(d,)| d).unwrap_or(true) {
                let sub_name: Option<(String,)> = sqlx::query_as(
                    "SELECT name FROM subcollections WHERE id = ?1",
                )
                .bind(sub_id)
                .fetch_optional(&state.0)
                .await
                .map_err(db_err)?;
                let name = sub_name.map(|(n,)| n).unwrap_or_default();
                return Err(format!("ENTRY_IN_SUBCOLLECTION:{}", name));
            }
        }

        // Unlink entry from collection (keep the entry itself)
        sqlx::query(
            "DELETE FROM entry_collections WHERE entry_id = ?1 AND collection_id = ?2",
        )
        .bind(id)
        .bind(col_id)
        .execute(&state.0)
        .await
        .map_err(db_err)?;
        audit.log("entry_unlinked", serde_json::json!({ "entry_id": id, "collection_id": col_id }));
        return Ok(());
    }

    // Permanent delete — only allowed if entry has no collection associations
    let collection_names: Vec<(String,)> = sqlx::query_as(
        "SELECT c.name FROM collections c \
         JOIN entry_collections ec ON ec.collection_id = c.id \
         WHERE ec.entry_id = ?1",
    )
    .bind(id)
    .fetch_all(&state.0)
    .await
    .map_err(db_err)?;

    if !collection_names.is_empty() {
        let names: Vec<&str> = collection_names.iter().map(|(n,)| n.as_str()).collect();
        return Err(format!("ENTRY_IN_COLLECTION:{}", names.join(",")));
    }

    // Fetch entry info before deletion for image cleanup
    let entry_info: Option<(String, String)> = sqlx::query_as(
        "SELECT content, content_type FROM entries WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(&state.0)
    .await
    .map_err(db_err)?;

    sqlx::query("DELETE FROM entries WHERE id = ?1")
        .bind(id)
        .execute(&state.0)
        .await
        .map(|_| {
            audit.log("entry_deleted", serde_json::json!({ "id": id }));
        })
        .map_err(db_err)?;

    // Clean up orphaned image file
    if let Some((content, content_type)) = entry_info {
        if content_type == "image" {
            let still_used: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM entries WHERE content = ?1",
            )
            .bind(&content)
            .fetch_one(&state.0)
            .await
            .map_err(db_err)?;

            if still_used.0 == 0 {
                if let Ok(data_dir) = app.path().app_data_dir() {
                    let _ = std::fs::remove_file(data_dir.join(&content));
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_favorite(state: State<'_, DbState>, id: i64) -> Result<bool, String> {
    crate::db::toggle_favorite(&state.0, id).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_entry_counts(state: State<'_, DbState>) -> Result<(i64, i64), String> {
    crate::db::get_entry_counts(&state.0).await.map_err(db_err)
}

// ── Filter metadata ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_apps(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    crate::db::get_distinct_apps(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_window_titles(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    crate::db::get_distinct_window_titles(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_categories(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    crate::db::get_categories(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_all_categories(state: State<'_, DbState>) -> Result<Vec<Category>, String> {
    crate::db::get_all_categories(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_context_rules(state: State<'_, DbState>) -> Result<Vec<ContextRule>, String> {
    crate::db::get_context_rules(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn get_content_rules(state: State<'_, DbState>) -> Result<Vec<ContentRule>, String> {
    crate::db::get_content_rules(&state.0).await.map_err(db_err)
}

// ── Themes ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_themes(state: State<'_, DbState>) -> Result<Vec<Theme>, String> {
    crate::db::get_themes(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn set_active_theme(state: State<'_, DbState>, slug: String) -> Result<(), String> {
    crate::db::update_setting(&state.0, "active_theme", &slug)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_theme(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    slug: String,
    name: String,
    base: String,
    surface: String,
    surface_raised: String,
    surface_active: String,
    stroke: String,
    stroke_strong: String,
    content: String,
    content_2: String,
    content_3: String,
    accent: String,
    accent_text: String,
) -> Result<Theme, String> {
    validate_name(&name)?;
    validate_name(&slug)?;
    for c in [&base, &surface, &surface_raised, &surface_active, &stroke, &stroke_strong,
              &content, &content_2, &content_3, &accent, &accent_text] {
        validate_color(c)?;
    }
    let theme = crate::db::create_theme(
        &state.0, &slug, &name, &base, &surface, &surface_raised, &surface_active,
        &stroke, &stroke_strong, &content, &content_2, &content_3, &accent, &accent_text,
    )
    .await
    .map_err(db_err)?;
    audit.log("theme_created", serde_json::json!({ "slug": slug }));
    Ok(theme)
}

#[tauri::command]
pub async fn update_theme(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    slug: String,
    name: String,
    base: String,
    surface: String,
    surface_raised: String,
    surface_active: String,
    stroke: String,
    stroke_strong: String,
    content: String,
    content_2: String,
    content_3: String,
    accent: String,
    accent_text: String,
) -> Result<(), String> {
    validate_name(&name)?;
    for c in [&base, &surface, &surface_raised, &surface_active, &stroke, &stroke_strong,
              &content, &content_2, &content_3, &accent, &accent_text] {
        validate_color(c)?;
    }
    crate::db::update_theme(
        &state.0, &slug, &name, &base, &surface, &surface_raised, &surface_active,
        &stroke, &stroke_strong, &content, &content_2, &content_3, &accent, &accent_text,
    )
    .await
    .map_err(db_err)?;
    audit.log("theme_updated", serde_json::json!({ "slug": slug }));
    Ok(())
}

#[tauri::command]
pub async fn delete_theme(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    slug: String,
) -> Result<(), String> {
    crate::db::delete_theme(&state.0, &slug)
        .await
        .map_err(db_err)?;
    audit.log("theme_deleted", serde_json::json!({ "slug": slug }));
    Ok(())
}

// ── Languages ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_languages(state: State<'_, DbState>) -> Result<Vec<Language>, String> {
    crate::db::get_languages(&state.0).await.map_err(db_err)
}

// ── Content types ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_content_types(
    state: State<'_, DbState>,
) -> Result<Vec<ContentTypeStyle>, String> {
    crate::db::get_content_types(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn update_content_type_color(
    state: State<'_, DbState>,
    name: String,
    color: String,
) -> Result<(), String> {
    validate_color(&color)?;
    crate::db::update_content_type_color(&state.0, &name, &color)
        .await
        .map_err(db_err)
}

// ── Clipboard copy (prevents self-save in watcher) ────────────────────────────

#[tauri::command]
pub async fn copy_to_clipboard(
    app_copied: State<'_, AppCopiedContent>,
    content: String,
) -> Result<(), String> {
    {
        let mut lock = app_copied.0.lock().unwrap();
        *lock = Some(content.clone());
    }
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_text(content))
        .map_err(|e| e.to_string())
}

// ── Clipboard write (raw — watcher WILL record this as a new entry) ───────────

#[tauri::command]
pub async fn write_clipboard_raw(content: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_text(content))
        .map_err(|e| e.to_string())
}

// ── Settings ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_settings(state: State<'_, DbState>) -> Result<Vec<Setting>, String> {
    crate::db::get_settings(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn update_setting(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    key: String,
    value: String,
) -> Result<(), String> {
    crate::db::update_setting(&db.0, &key, &value)
        .await
        .map_err(db_err)?;

    // Log the key but never the value (may contain sensitive data)
    audit.log("setting_updated", serde_json::json!({ "key": key }));

    const CACHE_KEYS: &[&str] = &["content_analysis_max_bytes"];
    if CACHE_KEYS.contains(&key.as_str()) {
        cache.refresh(&db.0).await;
    }

    // Update tray menu labels immediately when the language changes
    if key == "language" {
        let (lbl_open, lbl_close, lbl_quit) = crate::tray_labels(&value);
        if let Some(tray) = app.try_state::<crate::TrayMenuState>() {
            if let Ok(mut open) = tray.open_label.lock() { *open = lbl_open.to_string(); }
            if let Ok(mut close) = tray.close_label.lock() { *close = lbl_close.to_string(); }
            let _ = tray.quit.set_text(lbl_quit);
            // Set toggle label based on current window visibility
            let visible = app.get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            let _ = tray.toggle.set_text(if visible { lbl_close } else { lbl_open });
        }
    }

    Ok(())
}

// ── Collections ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_collections(state: State<'_, DbState>) -> Result<Vec<Collection>, String> {
    crate::db::get_collections(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    name: String,
    color: String,
) -> Result<Collection, String> {
    audited_validate(&audit, validate_name(&name), "create_collection", "name")?;
    audited_validate(&audit, validate_color(&color), "create_collection", "color")?;
    let col = crate::db::create_collection(&state.0, &name, &color)
        .await
        .map_err(db_err)?;
    audit.log("collection_created", serde_json::json!({ "name": name }));
    Ok(col)
}

#[tauri::command]
pub async fn update_collection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    audited_validate(&audit, validate_name(&name), "update_collection", "name")?;
    audited_validate(&audit, validate_color(&color), "update_collection", "color")?;
    crate::db::update_collection(&state.0, id, &name, &color)
        .await
        .map_err(db_err)?;
    audit.log("collection_updated", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn delete_collection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_collection(&state.0, id)
        .await
        .map_err(db_err)?;
    audit.log("collection_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn get_entry_collection_ids(
    state: State<'_, DbState>,
    entry_id: i64,
) -> Result<Vec<i64>, String> {
    crate::db::get_entry_collection_ids(&state.0, entry_id)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn set_entry_collections(
    state: State<'_, DbState>,
    entry_id: i64,
    collection_ids: Vec<i64>,
) -> Result<(), String> {
    crate::db::set_entry_collections(&state.0, entry_id, &collection_ids)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn get_collection_counts(state: State<'_, DbState>) -> Result<Vec<(i64, i64)>, String> {
    crate::db::get_collection_counts(&state.0).await.map_err(db_err)
}

// ── Subcollections ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_subcollections(
    state: State<'_, DbState>,
    collection_id: i64,
) -> Result<Vec<Subcollection>, String> {
    crate::db::get_subcollections(&state.0, collection_id)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_subcollection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    collection_id: i64,
    name: String,
) -> Result<Subcollection, String> {
    audited_validate(&audit, validate_name(&name), "create_subcollection", "name")?;
    let sub = crate::db::create_subcollection(&state.0, collection_id, &name)
        .await
        .map_err(db_err)?;
    audit.log("subcollection_created", serde_json::json!({ "collection_id": collection_id, "name": name }));
    Ok(sub)
}

#[tauri::command]
pub async fn rename_subcollection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
    name: String,
) -> Result<(), String> {
    audited_validate(&audit, validate_name(&name), "rename_subcollection", "name")?;
    crate::db::rename_subcollection(&state.0, id, &name)
        .await
        .map_err(db_err)?;
    audit.log("subcollection_renamed", serde_json::json!({ "id": id, "name": name }));
    Ok(())
}

#[tauri::command]
pub async fn delete_subcollection(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_subcollection(&state.0, id)
        .await
        .map_err(db_err)?;
    audit.log("subcollection_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn get_subcollection_counts(
    state: State<'_, DbState>,
    collection_id: i64,
) -> Result<Vec<(i64, i64)>, String> {
    crate::db::get_subcollection_counts(&state.0, collection_id)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn move_entry_subcollection(
    state: State<'_, DbState>,
    entry_id: i64,
    collection_id: i64,
    subcollection_id: i64,
) -> Result<(), String> {
    crate::db::move_entry_subcollection(&state.0, entry_id, collection_id, subcollection_id)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn get_entry_subcollection_ids(
    state: State<'_, DbState>,
    entry_id: i64,
) -> Result<Vec<(i64, i64)>, String> {
    crate::db::get_entry_subcollection_ids(&state.0, entry_id)
        .await
        .map_err(db_err)
}

// ── Content Types CRUD ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_content_type(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    name: String,
    label: String,
    color: String,
) -> Result<ContentTypeStyle, String> {
    audited_validate(&audit, validate_name(&name), "create_content_type", "name")?;
    audited_validate(&audit, validate_name(&label), "create_content_type", "label")?;
    audited_validate(&audit, validate_color(&color), "create_content_type", "color")?;
    let ct = crate::db::create_content_type(&db.0, &name, &label, &color)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("content_type_created", serde_json::json!({ "name": name }));
    Ok(ct)
}

#[tauri::command]
pub async fn delete_content_type(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    name: String,
) -> Result<(), String> {
    crate::db::delete_content_type(&db.0, &name)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("content_type_deleted", serde_json::json!({ "name": name }));
    Ok(())
}

// ── Categories CRUD ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_category(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    name: String,
    color: String,
) -> Result<Category, String> {
    audited_validate(&audit, validate_name(&name), "create_category", "name")?;
    audited_validate(&audit, validate_color(&color), "create_category", "color")?;
    let cat = crate::db::create_category(&db.0, &name, &color)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("category_created", serde_json::json!({ "name": name }));
    Ok(cat)
}

#[tauri::command]
pub async fn update_category(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    audited_validate(&audit, validate_name(&name), "update_category", "name")?;
    audited_validate(&audit, validate_color(&color), "update_category", "color")?;
    crate::db::update_category(&db.0, id, &name, &color)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("category_updated", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn delete_category(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_category(&db.0, id)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("category_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

// ── Context Rules CRUD ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_context_rules(state: State<'_, DbState>) -> Result<Vec<ContextRule>, String> {
    crate::db::get_all_context_rules(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn create_context_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    category_id: Option<i64>,
    source_app_pattern: Option<String>,
    window_title_pattern: Option<String>,
    priority: i64,
) -> Result<ContextRule, String> {
    if let Some(p) = source_app_pattern.as_deref() {
        audited_validate(&audit, validate_regex_pattern(p), "create_context_rule", "source_app_pattern")?;
    }
    if let Some(p) = window_title_pattern.as_deref() {
        audited_validate(&audit, validate_regex_pattern(p), "create_context_rule", "window_title_pattern")?;
    }
    let rule = crate::db::create_context_rule(
        &db.0,
        category_id,
        source_app_pattern.as_deref(),
        window_title_pattern.as_deref(),
        priority,
    )
    .await
    .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("context_rule_created", serde_json::json!({ "id": rule.id, "category_id": category_id }));
    Ok(rule)
}

#[tauri::command]
pub async fn delete_context_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_context_rule(&db.0, id)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("context_rule_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

// ── Content Type Rules CRUD ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_content_type_rules(
    state: State<'_, DbState>,
) -> Result<Vec<ContentRule>, String> {
    crate::db::get_all_content_type_rules(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn create_content_type_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    content_type: String,
    pattern: String,
    min_hits: i64,
    priority: i64,
) -> Result<ContentRule, String> {
    audited_validate(&audit, validate_regex_pattern(&pattern), "create_content_type_rule", "pattern")?;
    let rule = crate::db::create_content_type_rule(&db.0, &content_type, &pattern, min_hits, priority)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log(
        "content_type_rule_created",
        serde_json::json!({ "id": rule.id, "content_type": content_type }),
    );
    Ok(rule)
}

#[tauri::command]
pub async fn delete_content_type_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_content_type_rule(&db.0, id)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("content_type_rule_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn set_context_rule_enabled(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    crate::db::set_context_rule_enabled(&db.0, id, enabled)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log(
        "context_rule_toggled",
        serde_json::json!({ "id": id, "enabled": enabled }),
    );
    Ok(())
}

#[tauri::command]
pub async fn set_content_type_rule_enabled(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    crate::db::set_content_type_rule_enabled(&db.0, id, enabled)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log(
        "content_type_rule_toggled",
        serde_json::json!({ "id": id, "enabled": enabled }),
    );
    Ok(())
}

// ── Collection rules ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_collection_rules(
    state: State<'_, DbState>,
) -> Result<Vec<crate::db::CollectionRule>, String> {
    crate::db::get_all_collection_rules(&state.0).await.map_err(db_err)
}

#[tauri::command]
pub async fn create_collection_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    collection_id: i64,
    content_type: Option<String>,
    source_app: Option<String>,
    window_title: Option<String>,
    content_pattern: Option<String>,
    priority: i64,
) -> Result<i64, String> {
    // Validate regex patterns
    if let Some(ref p) = source_app {
        audited_validate(&audit, validate_regex_pattern(p), "create_collection_rule", "source_app")?;
    }
    if let Some(ref p) = window_title {
        audited_validate(&audit, validate_regex_pattern(p), "create_collection_rule", "window_title")?;
    }
    if let Some(ref p) = content_pattern {
        audited_validate(&audit, validate_regex_pattern(p), "create_collection_rule", "content_pattern")?;
    }
    let id = crate::db::create_collection_rule(
        &db.0, collection_id, content_type, source_app, window_title, content_pattern, priority,
    )
    .await
    .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log(
        "collection_rule_created",
        serde_json::json!({ "id": id, "collection_id": collection_id }),
    );
    Ok(id)
}

#[tauri::command]
pub async fn delete_collection_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    crate::db::delete_collection_rule(&db.0, id)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log("collection_rule_deleted", serde_json::json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn toggle_collection_rule(
    db: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    audit: State<'_, AuditLog>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    crate::db::toggle_collection_rule(&db.0, id, enabled)
        .await
        .map_err(db_err)?;
    cache.refresh(&db.0).await;
    audit.log(
        "collection_rule_toggled",
        serde_json::json!({ "id": id, "enabled": enabled }),
    );
    Ok(())
}

// ── Frontend security events ───────────────────────────────────────────────────

/// Called by the frontend to log security-relevant events that originate in the UI.
/// Only whitelisted event types are accepted to prevent log injection.
#[tauri::command]
pub fn log_security_event(
    audit: State<'_, AuditLog>,
    event: String,
    details: serde_json::Value,
) -> Result<(), String> {
    const ALLOWED: &[&str] = &["url_blocked"];
    if !ALLOWED.contains(&event.as_str()) {
        return Err(format!("Unknown security event: {event}"));
    }
    audit.log(&event, details);
    Ok(())
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, DbState>) -> Result<BootstrapData, String> {
    crate::db::bootstrap_data(&state.0).await.map_err(db_err)
}

// ── Window control ─────────────────────────────────────────────────────────────

/// Hide the window and update the tray menu label to the localized "Open".
/// Used by the custom window controls in the frontend to keep the tray in sync.
#[tauri::command]
pub fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(true);
        let _ = window.hide();
        if let Some(state) = app.try_state::<crate::TrayMenuState>() {
            let label = state.open_label.lock()
                .map(|l| l.clone())
                .unwrap_or_else(|_| "Open".to_string());
            let _ = state.toggle.set_text(&label);
        }
    }
}

// ── Data path ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

// ── Image commands ───────────────────────────────────────────────────────────

/// Returns a data URI (data:image/png;base64,...) for an image stored on disk.
#[tauri::command]
pub async fn get_image_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if path.contains("..") || !path.starts_with("images/") {
        return Err("Invalid image path".to_string());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let full_path = data_dir.join(&path);
    let bytes = std::fs::read(&full_path).map_err(|e| format!("Failed to read image: {e}"))?;
    use base64::Engine;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Copy an image back to the system clipboard from its stored PNG file.
#[tauri::command]
pub async fn copy_image_to_clipboard(
    app: tauri::AppHandle,
    app_copied_hash: State<'_, AppCopiedImageHash>,
    path: String,
) -> Result<(), String> {
    if path.contains("..") || !path.starts_with("images/") {
        return Err("Invalid image path".to_string());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let full_path = data_dir.join(&path);

    let img = image::open(&full_path).map_err(|e| format!("Failed to open image: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();

    // Set self-copy prevention hash
    {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(rgba.as_raw());
        let hash = format!("{:x}", hasher.finalize());
        let mut lock = app_copied_hash.0.lock().unwrap();
        *lock = Some(hash);
    }

    let img_data = arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
    };
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_image(img_data))
        .map_err(|e| e.to_string())
}

// ── Config Export / Import ──────────────────────────────────────────────────

#[tauri::command]
pub async fn export_config(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    app_log: State<'_, AppLog>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let config = crate::db::export_config(&state.0).await.map_err(db_err)?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    let path = app.dialog()
        .file()
        .set_file_name("clipboard-tool-config.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(path) = path else {
        return Ok(String::new());
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;
    std::fs::write(file_path, &json).map_err(|e| e.to_string())?;

    app_log.info("export_config", &format!("exported to {}", file_path.display()));
    Ok(file_path.display().to_string())
}

#[tauri::command]
pub async fn import_config(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    cache: State<'_, RulesCache>,
    app_log: State<'_, AppLog>,
) -> Result<ImportSummary, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(path) = path else {
        return Err("CANCELLED".to_string());
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;
    let json = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let config: crate::db::ConfigExport = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid config file: {e}"))?;

    if config.version != 1 {
        return Err(format!("Unsupported config version: {}", config.version));
    }

    let summary = crate::db::import_config(&state.0, &config).await.map_err(db_err)?;
    cache.refresh(&state.0).await;

    app_log.info("import_config", &format!("imported config: {:?}", summary));
    Ok(summary)
}
