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
#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{CollectionRuleRaw, ContentRule, ContextRule};

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn make_context_rule(
        id: i64,
        category_id: Option<i64>,
        source_app_pattern: Option<&str>,
        window_title_pattern: Option<&str>,
        priority: i64,
    ) -> ContextRule {
        ContextRule {
            id,
            category_id,
            category_name: "test".to_string(),
            source_app_pattern: source_app_pattern.map(String::from),
            window_title_pattern: window_title_pattern.map(String::from),
            priority,
            enabled: true,
            is_builtin: false,
            created_at: "2024-01-01".to_string(),
        }
    }

    fn make_content_rule(
        id: i64,
        content_type: &str,
        pattern: &str,
        min_hits: i64,
        priority: i64,
    ) -> ContentRule {
        ContentRule {
            id,
            content_type: content_type.to_string(),
            pattern: pattern.to_string(),
            min_hits,
            priority,
            enabled: true,
            is_builtin: false,
            created_at: "2024-01-01".to_string(),
        }
    }

    /// Build the seeded content rules matching the DB seed in db.rs.
    fn seeded_content_rules() -> Vec<ContentRule> {
        let mut rules = Vec::new();
        let mut id = 1i64;

        // url (priority 50, min_hits 1)
        rules.push(make_content_rule(id, "url", r"^(https?|ftp)://\S+", 1, 50));
        id += 1;

        // email (priority 40, min_hits 1)
        rules.push(make_content_rule(id, "email", r"^[^\s@]+@[^\s@]+\.[^\s@]+$", 1, 40));
        id += 1;

        // phone (priority 30, min_hits 1)
        rules.push(make_content_rule(id, "phone", r"^[\+]?[\d\s\-\.\(\)]{7,25}$", 1, 30));
        id += 1;

        // color hex3/hex6 (priority 25, min_hits 1)
        rules.push(make_content_rule(id, "color", r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", 1, 25));
        id += 1;
        // color rgb/rgba (priority 25, min_hits 1)
        rules.push(make_content_rule(id, "color", r"^rgba?\(\s*\d+", 1, 25));
        id += 1;

        // json (priority 22, min_hits 3) — 5 patterns
        for pat in &[
            r#"^\s*[\{\[]"#,
            r#"^\s*[\}\]]"#,
            r#""[^"]+"\s*:"#,
            r#":\s*(true|false|null|-?\d)"#,
            r#",\s*"[^"]+"#,
        ] {
            rules.push(make_content_rule(id, "json", pat, 3, 22));
            id += 1;
        }

        // sql (priority 22, min_hits 2) — 5 patterns
        for pat in &[
            r"(?i)\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|VIEW)|DROP\s+(TABLE|INDEX|VIEW)|ALTER\s+TABLE)\b",
            r"(?i)\b(WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT)\b",
            r"(?i)\b(BEGIN|COMMIT|ROLLBACK|TRANSACTION|SAVEPOINT)\b",
            r"(?i)\b(PRIMARY\s+KEY|FOREIGN\s+KEY|NOT\s+NULL|UNIQUE|DEFAULT|REFERENCES|ON\s+DELETE|ON\s+UPDATE|CASCADE)\b",
            r"--\s*\S|/\*|\b(COUNT|SUM|AVG|MAX|MIN|COALESCE)\s*\(",
        ] {
            rules.push(make_content_rule(id, "sql", pat, 2, 22));
            id += 1;
        }

        // shell (priority 21, min_hits 2) — 7 patterns
        for pat in &[
            r"(?m)^#!/",
            r"(?m)^\$\s+\S",
            r"(?m)^\s*#.*$",
            r"\|\s*\w",
            r"(?m)^\s*(if|for|while|case|fi|done|esac)\b",
            r"\b(grep|awk|sed|curl|wget|chmod|sudo|apt|yum|brew|pip|npm|cargo|make)\b",
            r"(?m)^\s*[A-Z_][A-Z0-9_]+=",
        ] {
            rules.push(make_content_rule(id, "shell", pat, 2, 21));
            id += 1;
        }

        // code (priority 20, min_hits 3) — 10 patterns
        for pat in &[
            r"(?m)(^|\s)(fn |def |class |function |func |sub )\s*\w",
            r"(?m)^\s*(import |use |require |include |from \S+ import)\S",
            r"(?m)^\s*(if|else|elif|for|while|switch|match)\s*[\(\{]",
            r"(?m)^\s*(return|yield|throw|raise|break|continue)\b",
            r"(?m)^\s*(let |const |var |int |str |bool |float |double |char |void |auto )\w",
            r"(?m)^\s*//|/\*|\*/|(?m)^\s*#\s",
            r"[;{}]\s*$",
            r"\w+\s*\(.*\)\s*\{",
            r"(?m)^\s*@\w+",
            r"(?m)^\s*(public|private|protected|static|async|abstract|override)\s+\w",
        ] {
            rules.push(make_content_rule(id, "code", pat, 3, 20));
            id += 1;
        }

        // markdown (priority 18, min_hits 2) — 10 patterns
        for pat in &[
            r"(?m)^#{1,6}\s+\S",
            r"\[.+?\]\(.+?\)",
            r"(?m)^>\s+",
            r"(?m)^\s*[-*+]\s+\S",
            r"(?m)^\s*\d+\.\s+\S",
            r"(?m)^```",
            r"(?m)^\s*---+\s*$",
            r"\*\*[^*]+\*\*|__[^_]+__",
            r"\*[^*]+\*|_[^_]+_",
            r"(?m)^\|\s*.+\s*\|",
        ] {
            rules.push(make_content_rule(id, "markdown", pat, 2, 18));
            id += 1;
        }

        rules
    }

    // ── compile_context_rules ─────────────────────────────────────────────────

    #[test]
    fn compile_context_rules_drops_when_both_patterns_none() {
        let rule = make_context_rule(1, Some(10), None, None, 50);
        let compiled = compile_context_rules(vec![rule]);
        assert!(compiled.is_empty());
    }

    #[test]
    fn compile_context_rules_drops_invalid_source_app_regex() {
        let rule = make_context_rule(1, Some(10), Some("[invalid("), None, 50);
        let compiled = compile_context_rules(vec![rule]);
        assert!(compiled.is_empty());
    }

    #[test]
    fn compile_context_rules_keeps_source_app_only() {
        let rule = make_context_rule(1, Some(10), Some("code"), None, 50);
        let compiled = compile_context_rules(vec![rule]);
        assert_eq!(compiled.len(), 1);
        assert!(compiled[0].source_app_re.is_some());
        assert!(compiled[0].window_title_re.is_none());
    }

    #[test]
    fn compile_context_rules_keeps_window_title_only() {
        let rule = make_context_rule(1, Some(10), None, Some("editor"), 50);
        let compiled = compile_context_rules(vec![rule]);
        assert_eq!(compiled.len(), 1);
        assert!(compiled[0].source_app_re.is_none());
        assert!(compiled[0].window_title_re.is_some());
    }

    // ── compile_content_rules ─────────────────────────────────────────────────

    #[test]
    fn compile_content_rules_groups_same_type_together() {
        let rules = vec![
            make_content_rule(1, "color", r"^#[0-9a-fA-F]{6}$", 1, 25),
            make_content_rule(2, "color", r"^rgba?\(", 1, 25),
        ];
        let groups = compile_content_rules(rules);
        let color_group = groups.iter().find(|g| g.content_type == "color");
        assert!(color_group.is_some());
        assert_eq!(color_group.unwrap().patterns.len(), 2);
    }

    #[test]
    fn compile_content_rules_sorts_by_priority_descending() {
        let rules = vec![
            make_content_rule(1, "markdown", r"(?m)^#{1,6}\s+\S", 2, 18),
            make_content_rule(2, "url", r"^(https?|ftp)://\S+", 1, 50),
            make_content_rule(3, "code", r"(?m)(fn |def )\s*\w", 3, 20),
        ];
        let groups = compile_content_rules(rules);
        assert_eq!(groups[0].content_type, "url");
        assert_eq!(groups[1].content_type, "code");
        assert_eq!(groups[2].content_type, "markdown");
    }

    #[test]
    fn compile_content_rules_skips_invalid_regex() {
        let rules = vec![
            make_content_rule(1, "url", r"^(https?|ftp)://\S+", 1, 50),
            make_content_rule(2, "bad", r"[invalid(", 1, 99),
        ];
        let groups = compile_content_rules(rules);
        assert!(groups.iter().all(|g| g.content_type != "bad"));
        assert!(groups.iter().any(|g| g.content_type == "url"));
    }

    // ── match_content_type ────────────────────────────────────────────────────

    #[test]
    fn match_content_type_url() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "https://github.com/niconi21/clipboard-tool", 8192);
        assert_eq!(result, "url");
    }

    #[test]
    fn match_content_type_email() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "user@example.com", 8192);
        assert_eq!(result, "email");
    }

    #[test]
    fn match_content_type_phone_valid() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "+1 (555) 123-4567", 8192);
        assert_eq!(result, "phone");
    }

    #[test]
    fn match_content_type_phone_rejects_alpha() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "call 555-HELP-NOW", 8192);
        assert_ne!(result, "phone");
    }

    #[test]
    fn match_content_type_phone_rejects_newline() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "555\n1234567", 8192);
        assert_ne!(result, "phone");
    }

    #[test]
    fn match_content_type_phone_rejects_too_few_digits() {
        let groups = compile_content_rules(seeded_content_rules());
        // "123-456" has only 6 digits — below the 7-digit minimum
        let result = match_content_type(&groups, "123-456", 8192);
        assert_ne!(result, "phone");
    }

    #[test]
    fn match_content_type_color_hex3() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "#fff", 8192);
        assert_eq!(result, "color");
    }

    #[test]
    fn match_content_type_color_hex6() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "#3b82f6", 8192);
        assert_eq!(result, "color");
    }

    #[test]
    fn match_content_type_color_rgba() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "rgba(255, 0, 0, 0.5)", 8192);
        assert_eq!(result, "color");
    }

    #[test]
    fn match_content_type_json() {
        let groups = compile_content_rules(seeded_content_rules());
        // Valid JSON object with enough keys to trigger 3+ pattern hits
        let text = r#"{"name": "Alice", "age": 30, "active": true, "score": null}"#;
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "json");
    }

    #[test]
    fn match_content_type_sql_select() {
        let groups = compile_content_rules(seeded_content_rules());
        let text = "SELECT id, name FROM users WHERE active = 1 ORDER BY name";
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "sql");
    }

    #[test]
    fn match_content_type_sql_insert() {
        let groups = compile_content_rules(seeded_content_rules());
        let text = "INSERT INTO entries (content, content_type) VALUES ('hello', 'text');\n-- end";
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "sql");
    }

    #[test]
    fn match_content_type_shell() {
        let groups = compile_content_rules(seeded_content_rules());
        let text = "#!/bin/bash\ncurl -s https://example.com | grep foo";
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "shell");
    }

    #[test]
    fn match_content_type_code() {
        let groups = compile_content_rules(seeded_content_rules());
        let text = "fn add(a: i32, b: i32) -> i32 {\n    let result = a + b;\n    return result;\n}";
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "code");
    }

    #[test]
    fn match_content_type_markdown() {
        let groups = compile_content_rules(seeded_content_rules());
        let text = "# My Document\n\n- item one\n- item two\n- item three";
        let result = match_content_type(&groups, text, 8192);
        assert_eq!(result, "markdown");
    }

    #[test]
    fn match_content_type_plain_text_fallback() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "just some plain text here", 8192);
        assert_eq!(result, "text");
    }

    #[test]
    fn match_content_type_max_bytes_truncation() {
        let groups = compile_content_rules(seeded_content_rules());
        // URL at the start followed by lots of garbage — the match is within the first 20 bytes
        // The URL "https://x.com" is 14 bytes, well within the 20-byte window.
        let mut text = "https://x.com".to_string();
        text.push_str(&"z".repeat(200));
        // With max_bytes=20 the slice will contain "https://x.comzzzzzzz" (20 chars)
        // The URL pattern requires the whole string to start with https:// and have no spaces —
        // but after truncation the suffix letters are still non-space, so it still matches.
        let result = match_content_type(&groups, &text, 20);
        assert_eq!(result, "url");
    }

    // ── match_category ────────────────────────────────────────────────────────

    #[test]
    fn match_category_source_app_only() {
        let rules = compile_context_rules(vec![make_context_rule(
            1,
            Some(42),
            Some("code"),
            None,
            10,
        )]);
        let result = match_category(&rules, Some("vscode"), None);
        assert_eq!(result, Some(42));
    }

    #[test]
    fn match_category_window_title_only() {
        let rules = compile_context_rules(vec![make_context_rule(
            1,
            Some(7),
            None,
            Some("vim"),
            10,
        )]);
        let result = match_category(&rules, None, Some("init.vim - nvim"));
        assert_eq!(result, Some(7));
    }

    #[test]
    fn match_category_both_required_both_match() {
        let rules = compile_context_rules(vec![make_context_rule(
            1,
            Some(5),
            Some("terminal"),
            Some("bash"),
            10,
        )]);
        let result = match_category(&rules, Some("terminal"), Some("bash shell"));
        assert_eq!(result, Some(5));
    }

    #[test]
    fn match_category_both_required_one_missing() {
        let rules = compile_context_rules(vec![make_context_rule(
            1,
            Some(5),
            Some("terminal"),
            Some("bash"),
            10,
        )]);
        // source_app matches but window_title does not
        let result = match_category(&rules, Some("terminal"), Some("python repl"));
        assert_eq!(result, None);
    }

    #[test]
    fn match_category_highest_priority_wins() {
        // All three rules match the source_app "firefox" via a broad pattern.
        // The rule with priority=100 should win.
        let rules = compile_context_rules(vec![
            make_context_rule(1, Some(1), Some("fire"), None, 5),
            make_context_rule(2, Some(99), Some("fire"), None, 100),
            make_context_rule(3, Some(50), Some("fire"), None, 10),
        ]);
        let result = match_category(&rules, Some("firefox"), None);
        assert_eq!(result, Some(99));
    }

    #[test]
    fn match_category_no_rules_returns_none() {
        let result = match_category(&[], Some("any-app"), Some("any title"));
        assert_eq!(result, None);
    }

    // ── default_category_for_type ─────────────────────────────────────────────

    #[test]
    fn default_category_code_is_development() {
        assert_eq!(default_category_for_type("code"), Some("development"));
    }

    #[test]
    fn default_category_sql_is_development() {
        assert_eq!(default_category_for_type("sql"), Some("development"));
    }

    #[test]
    fn default_category_json_is_development() {
        assert_eq!(default_category_for_type("json"), Some("development"));
    }

    #[test]
    fn default_category_shell_is_development() {
        assert_eq!(default_category_for_type("shell"), Some("development"));
    }

    #[test]
    fn default_category_markdown_is_document() {
        assert_eq!(default_category_for_type("markdown"), Some("document"));
    }

    #[test]
    fn default_category_url_is_none() {
        assert_eq!(default_category_for_type("url"), None);
    }

    #[test]
    fn default_category_text_is_none() {
        assert_eq!(default_category_for_type("text"), None);
    }

    // ── compile_collection_rules ──────────────────────────────────────────────

    #[test]
    fn compile_collection_rules_drops_all_none() {
        let rule = CollectionRuleRaw {
            collection_id: 1,
            content_type: None,
            source_app: None,
            window_title: None,
            content_pattern: None,
        };
        let compiled = compile_collection_rules(vec![rule]);
        assert!(compiled.is_empty());
    }

    #[test]
    fn compile_collection_rules_keeps_with_one_criterion() {
        let rule = CollectionRuleRaw {
            collection_id: 1,
            content_type: Some("url".to_string()),
            source_app: None,
            window_title: None,
            content_pattern: None,
        };
        let compiled = compile_collection_rules(vec![rule]);
        assert_eq!(compiled.len(), 1);
    }

    // ── match_collections ─────────────────────────────────────────────────────

    #[test]
    fn match_collections_by_content_type() {
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 10,
            content_type: Some("url".to_string()),
            source_app: None,
            window_title: None,
            content_pattern: None,
        }]);
        let ids = match_collections(&rules, "https://example.com", "url", None, None);
        assert_eq!(ids, vec![10]);
    }

    #[test]
    fn match_collections_type_mismatch_returns_empty() {
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 10,
            content_type: Some("url".to_string()),
            source_app: None,
            window_title: None,
            content_pattern: None,
        }]);
        let ids = match_collections(&rules, "hello world", "text", None, None);
        assert!(ids.is_empty());
    }

    #[test]
    fn match_collections_by_content_pattern() {
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 20,
            content_type: None,
            source_app: None,
            window_title: None,
            content_pattern: Some(r"secret".to_string()),
        }]);
        let ids = match_collections(&rules, "my secret key is here", "text", None, None);
        assert_eq!(ids, vec![20]);
    }

    #[test]
    fn match_collections_and_logic_type_matches_pattern_doesnt() {
        // content_type matches "url" but content_pattern requires "github" which isn't present
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 30,
            content_type: Some("url".to_string()),
            source_app: None,
            window_title: None,
            content_pattern: Some(r"github\.com".to_string()),
        }]);
        let ids = match_collections(&rules, "https://example.com", "url", None, None);
        assert!(ids.is_empty());
    }

    #[test]
    fn match_collections_dedup_same_collection_id() {
        // Two rules for the same collection_id — both match — should appear only once
        let rules = compile_collection_rules(vec![
            CollectionRuleRaw {
                collection_id: 5,
                content_type: Some("url".to_string()),
                source_app: None,
                window_title: None,
                content_pattern: None,
            },
            CollectionRuleRaw {
                collection_id: 5,
                content_type: None,
                source_app: None,
                window_title: None,
                content_pattern: Some(r"example".to_string()),
            },
        ]);
        let ids = match_collections(&rules, "https://example.com", "url", None, None);
        assert_eq!(ids, vec![5]);
    }

    // ── max_bytes = 0 means unlimited ─────────────────────────────────────────

    #[test]
    fn match_content_type_max_bytes_zero_means_unlimited() {
        let groups = compile_content_rules(seeded_content_rules());
        // Large URL that would be truncated if max_bytes were small
        let text = format!("https://example.com/{}", "a".repeat(10000));
        // With max_bytes=0 the full string is analyzed — URL pattern should still match
        let result = match_content_type(&groups, &text, 0);
        assert_eq!(result, "url");
    }

    // ── phone digit range boundaries ──────────────────────────────────────────

    #[test]
    fn match_content_type_phone_exactly_7_digits() {
        let groups = compile_content_rules(seeded_content_rules());
        let result = match_content_type(&groups, "555-1234", 8192); // 7 digits
        assert_eq!(result, "phone");
    }

    #[test]
    fn match_content_type_phone_exactly_15_digits() {
        let groups = compile_content_rules(seeded_content_rules());
        // 15-digit number (international max)
        let result = match_content_type(&groups, "+123456789012345", 8192);
        assert_eq!(result, "phone");
    }

    #[test]
    fn match_content_type_phone_rejects_too_many_digits() {
        let groups = compile_content_rules(seeded_content_rules());
        // 16 digits exceeds the max
        let result = match_content_type(&groups, "1234567890123456", 8192);
        assert_ne!(result, "phone");
    }

    // ── match_category edge cases ─────────────────────────────────────────────

    #[test]
    fn match_category_returns_none_when_category_id_is_none() {
        // Rule matches but has no category_id — should return None
        let rules = compile_context_rules(vec![make_context_rule(1, None, Some("browser"), None, 50)]);
        let result = match_category(&rules, Some("browser"), None);
        assert_eq!(result, None);
    }

    #[test]
    fn match_category_no_match_returns_none() {
        let rules = compile_context_rules(vec![make_context_rule(1, Some(5), Some("vscode"), None, 10)]);
        // "firefox" doesn't match "vscode" pattern
        let result = match_category(&rules, Some("firefox"), None);
        assert_eq!(result, None);
    }

    // ── match_collections: source_app and window_title ────────────────────────

    #[test]
    fn match_collections_by_source_app() {
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 42,
            content_type: None,
            source_app: Some(r"(?i)slack".to_string()),
            window_title: None,
            content_pattern: None,
        }]);
        let ids = match_collections(&rules, "any content", "text", Some("Slack"), None);
        assert_eq!(ids, vec![42]);
    }

    #[test]
    fn match_collections_by_window_title() {
        let rules = compile_collection_rules(vec![CollectionRuleRaw {
            collection_id: 77,
            content_type: None,
            source_app: None,
            window_title: Some(r"GitHub".to_string()),
            content_pattern: None,
        }]);
        let ids = match_collections(&rules, "any content", "text", None, Some("GitHub - niconi21/clipboard-tool"));
        assert_eq!(ids, vec![77]);
    }

    #[test]
    fn match_collections_returns_multiple_matching_collection_ids() {
        let rules = compile_collection_rules(vec![
            CollectionRuleRaw {
                collection_id: 1,
                content_type: Some("url".to_string()),
                source_app: None,
                window_title: None,
                content_pattern: None,
            },
            CollectionRuleRaw {
                collection_id: 2,
                content_type: None,
                source_app: None,
                window_title: None,
                content_pattern: Some(r"github\.com".to_string()),
            },
        ]);
        let ids = match_collections(&rules, "https://github.com/foo", "url", None, None);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&2));
    }
}
