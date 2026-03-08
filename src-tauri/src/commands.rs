use regex::Regex;
use tauri::State;

use crate::audit::AuditLog;
use crate::categorizer::RulesCache;
use crate::clipboard::AppCopiedContent;
use crate::db::{
    BootstrapData, Category, ClipboardEntry, Collection, ContentRule, ContentTypeStyle, ContextRule, DbState,
    Language, Setting, Theme,
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
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ClipboardEntry>, String> {
    let pool = &state.0;

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if let Some(q) = search.as_deref().filter(|s| !s.is_empty()) {
        let i = params.len() + 1;
        conditions.push(format!("(entries.content LIKE ?{i} OR entries.window_title LIKE ?{i})"));
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
        conditions.push(format!(
            "entries.id IN (SELECT entry_id FROM entry_collections WHERE collection_id = ?{})",
            params.len() + 1
        ));
        params.push(cid.to_string());
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
                {is_fav} AS is_favorite, entries.created_at
         FROM entries
         LEFT JOIN categories cat ON cat.id = entries.category_id
         {where_clause}
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
pub async fn delete_entry(
    state: State<'_, DbState>,
    audit: State<'_, AuditLog>,
    id: i64,
) -> Result<(), String> {
    // Prevent deleting an entry that belongs to one or more collections
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
        // Return a parseable error code so the frontend can translate it.
        // Format: "ENTRY_IN_COLLECTION:<comma-separated names>"
        let names: Vec<&str> = collection_names.iter().map(|(n,)| n.as_str()).collect();
        return Err(format!("ENTRY_IN_COLLECTION:{}", names.join(",")));
    }

    sqlx::query("DELETE FROM entries WHERE id = ?1")
        .bind(id)
        .execute(&state.0)
        .await
        .map(|_| {
            audit.log("entry_deleted", serde_json::json!({ "id": id }));
        })
        .map_err(db_err)
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
