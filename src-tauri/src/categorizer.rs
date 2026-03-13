use regex::Regex;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::db::{CollectionRuleRaw, ContentRule, ContextRule};

// ── Public result ─────────────────────────────────────────────────────────────

pub struct Classification {
    pub content_type: String,
    pub category_id: Option<i64>,
    pub collection_ids: Vec<i64>,
}

// ── Compiled rules ────────────────────────────────────────────────────────────

struct CompiledContextRule {
    category_id: Option<i64>,
    source_app_re: Option<Regex>,
    window_title_re: Option<Regex>,
    priority: i64,
}

/// All patterns belonging to the same content_type and sharing a min_hits threshold.
struct CompiledContentGroup {
    content_type: String,
    patterns: Vec<Regex>,
    min_hits: i64,
    priority: i64,
}

struct CompiledCollectionRule {
    collection_id: i64,
    content_type: Option<String>,
    source_app_re: Option<Regex>,
    window_title_re: Option<Regex>,
    content_pattern_re: Option<Regex>,
}

// ── Cache ─────────────────────────────────────────────────────────────────────

struct Inner {
    context: Vec<CompiledContextRule>,
    content: Vec<CompiledContentGroup>,
    collection: Vec<CompiledCollectionRule>,
    content_max_bytes: usize,
    category_map: HashMap<String, i64>, // category name → id
}

#[derive(Clone)]
pub struct RulesCache(Arc<RwLock<Inner>>);

impl RulesCache {
    pub async fn new(pool: &SqlitePool) -> Self {
        let context_rules = crate::db::get_context_rules(pool).await.unwrap_or_else(|e| {
            eprintln!("[categorizer] failed to load context rules: {e}");
            vec![]
        });
        let content_rules = crate::db::get_content_rules(pool).await.unwrap_or_else(|e| {
            eprintln!("[categorizer] failed to load content rules: {e}");
            vec![]
        });
        let collection_rules = crate::db::get_enabled_collection_rules(pool).await.unwrap_or_else(|e| {
            eprintln!("[categorizer] failed to load collection rules: {e}");
            vec![]
        });
        let content_max_bytes = load_max_bytes(pool).await;
        let category_map = crate::db::get_category_name_id_map(pool).await.unwrap_or_else(|e| {
            eprintln!("[categorizer] failed to load category map: {e}");
            Default::default()
        });
        let inner = Inner {
            context: compile_context_rules(context_rules),
            content: compile_content_rules(content_rules),
            collection: compile_collection_rules(collection_rules),
            content_max_bytes,
            category_map,
        };
        Self(Arc::new(RwLock::new(inner)))
    }

    pub async fn refresh(&self, pool: &SqlitePool) {
        let ctx = crate::db::get_context_rules(pool).await.unwrap_or_default();
        let cnt = crate::db::get_content_rules(pool).await.unwrap_or_default();
        let col = crate::db::get_enabled_collection_rules(pool).await.unwrap_or_default();
        let max_bytes = load_max_bytes(pool).await;
        let category_map = crate::db::get_category_name_id_map(pool).await.unwrap_or_default();
        if let Ok(mut cache) = self.0.write() {
            cache.context = compile_context_rules(ctx);
            cache.content = compile_content_rules(cnt);
            cache.collection = compile_collection_rules(col);
            cache.content_max_bytes = max_bytes;
            cache.category_map = category_map;
        }
    }

    pub fn classify(
        &self,
        content: &str,
        source_app: Option<&str>,
        window_title: Option<&str>,
    ) -> Classification {
        let guard = self.0.read();

        let content_type = guard
            .as_ref()
            .map(|inner| match_content_type(&inner.content, content, inner.content_max_bytes))
            .unwrap_or_else(|_| "text".to_string());

        let category_id = guard
            .as_ref()
            .map(|inner| {
                let from_context = match_category(&inner.context, source_app, window_title);
                if from_context.is_some() {
                    from_context
                } else {
                    default_category_for_type(&content_type)
                        .and_then(|name| inner.category_map.get(name).copied())
                }
            })
            .unwrap_or(None);

        let collection_ids = guard
            .as_ref()
            .map(|inner| match_collections(&inner.collection, content, &content_type, source_app, window_title))
            .unwrap_or_default();

        Classification {
            content_type,
            category_id,
            collection_ids,
        }
    }
}

const DEFAULT_MAX_BYTES: usize = 8192;

async fn load_max_bytes(pool: &SqlitePool) -> usize {
    crate::db::get_setting(pool, "content_analysis_max_bytes")
        .await
        .ok()
        .flatten()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(DEFAULT_MAX_BYTES)
}

// ── Compilation ───────────────────────────────────────────────────────────────

fn compile_context_rules(rules: Vec<ContextRule>) -> Vec<CompiledContextRule> {
    rules
        .into_iter()
        .filter_map(|rule| {
            let source_app_re = rule
                .source_app_pattern
                .as_deref()
                .and_then(|p| Regex::new(p).ok());

            let window_title_re = rule
                .window_title_pattern
                .as_deref()
                .and_then(|p| Regex::new(p).ok());

            if rule.source_app_pattern.is_some() && source_app_re.is_none() {
                eprintln!("[categorizer] invalid source_app regex in context rule {}", rule.id);
                return None;
            }
            if rule.window_title_pattern.is_some() && window_title_re.is_none() {
                eprintln!("[categorizer] invalid window_title regex in context rule {}", rule.id);
                return None;
            }
            if source_app_re.is_none() && window_title_re.is_none() {
                return None;
            }

            Some(CompiledContextRule {
                category_id: rule.category_id,
                source_app_re,
                window_title_re,
                priority: rule.priority,
            })
        })
        .collect()
}

fn compile_content_rules(rules: Vec<ContentRule>) -> Vec<CompiledContentGroup> {
    let mut groups: Vec<CompiledContentGroup> = Vec::new();

    for rule in rules {
        let re = match Regex::new(&rule.pattern) {
            Ok(r) => r,
            Err(_) => {
                eprintln!("[categorizer] invalid pattern in content rule {}: {}", rule.id, rule.pattern);
                continue;
            }
        };

        if let Some(group) = groups.iter_mut().find(|g| g.content_type == rule.content_type) {
            group.patterns.push(re);
        } else {
            groups.push(CompiledContentGroup {
                content_type: rule.content_type,
                patterns: vec![re],
                min_hits: rule.min_hits,
                priority: rule.priority,
            });
        }
    }

    groups.sort_by(|a, b| b.priority.cmp(&a.priority));
    groups
}

// ── Matching ──────────────────────────────────────────────────────────────────

fn match_content_type(groups: &[CompiledContentGroup], text: &str, max_bytes: usize) -> String {
    let trimmed = text.trim();
    let s = if max_bytes > 0 && trimmed.len() > max_bytes {
        match trimmed.char_indices().find(|&(i, _)| i >= max_bytes) {
            Some((i, _)) => &trimmed[..i],
            None => trimmed,
        }
    } else {
        trimmed
    };

    // Phone pre-check: reject if contains letters (avoids regex false positives)
    for group in groups {
        if group.content_type == "phone" {
            if s.contains('\n') || s.chars().any(|c| c.is_alphabetic()) {
                continue;
            }
            let digits: usize = s.chars().filter(|c| c.is_ascii_digit()).count();
            if !(7..=15).contains(&digits) {
                continue;
            }
        }

        let hits = group.patterns.iter().filter(|re| re.is_match(s)).count();
        if hits >= group.min_hits as usize {
            return group.content_type.clone();
        }
    }

    "text".to_string()
}

/// Maps content types to a default category name when no context rule matched.
fn default_category_for_type(content_type: &str) -> Option<&'static str> {
    match content_type {
        "code" | "sql" | "json" | "shell" => Some("development"),
        "markdown" => Some("document"),
        _ => None,
    }
}

fn match_category(
    rules: &[CompiledContextRule],
    source_app: Option<&str>,
    window_title: Option<&str>,
) -> Option<i64> {
    let app = source_app.unwrap_or("");
    let title = window_title.unwrap_or("");

    let mut best: Option<(i64, Option<i64>)> = None;

    for rule in rules {
        let app_ok = rule
            .source_app_re
            .as_ref()
            .map(|re| re.is_match(&app))
            .unwrap_or(true);

        let title_ok = rule
            .window_title_re
            .as_ref()
            .map(|re| re.is_match(&title))
            .unwrap_or(true);

        let matches = match (&rule.source_app_re, &rule.window_title_re) {
            (Some(_), Some(_)) => app_ok && title_ok,
            (Some(_), None) => app_ok,
            (None, Some(_)) => title_ok,
            (None, None) => false,
        };

        if matches {
            match best {
                None => best = Some((rule.priority, rule.category_id)),
                Some((p, _)) if rule.priority > p => best = Some((rule.priority, rule.category_id)),
                _ => {}
            }
        }
    }

    best.and_then(|(_, cid)| cid)
}

// ── Collection rules ─────────────────────────────────────────────────────────

fn compile_collection_rules(rules: Vec<CollectionRuleRaw>) -> Vec<CompiledCollectionRule> {
    rules
        .into_iter()
        .filter_map(|rule| {
            let source_app_re = rule.source_app.as_deref().and_then(|p| Regex::new(p).ok());
            let window_title_re = rule.window_title.as_deref().and_then(|p| Regex::new(p).ok());
            let content_pattern_re = rule.content_pattern.as_deref().and_then(|p| Regex::new(p).ok());

            // At least one criterion must be set
            if rule.content_type.is_none()
                && source_app_re.is_none()
                && window_title_re.is_none()
                && content_pattern_re.is_none()
            {
                return None;
            }

            Some(CompiledCollectionRule {
                collection_id: rule.collection_id,
                content_type: rule.content_type,
                source_app_re,
                window_title_re,
                content_pattern_re,
            })
        })
        .collect()
}

/// Returns all collection IDs that match the given entry. Multiple rules for the
/// same collection = OR logic; multiple criteria within one rule = AND logic.
fn match_collections(
    rules: &[CompiledCollectionRule],
    content: &str,
    content_type: &str,
    source_app: Option<&str>,
    window_title: Option<&str>,
) -> Vec<i64> {
    let app = source_app.unwrap_or("");
    let title = window_title.unwrap_or("");

    let mut matched: Vec<i64> = Vec::new();

    for rule in rules {
        let type_ok = rule
            .content_type
            .as_deref()
            .map(|ct| ct == content_type)
            .unwrap_or(true);

        let app_ok = rule
            .source_app_re
            .as_ref()
            .map(|re| re.is_match(app))
            .unwrap_or(true);

        let title_ok = rule
            .window_title_re
            .as_ref()
            .map(|re| re.is_match(title))
            .unwrap_or(true);

        let content_ok = rule
            .content_pattern_re
            .as_ref()
            .map(|re| re.is_match(content))
            .unwrap_or(true);

        if type_ok && app_ok && title_ok && content_ok && !matched.contains(&rule.collection_id) {
            matched.push(rule.collection_id);
        }
    }

    matched
}
