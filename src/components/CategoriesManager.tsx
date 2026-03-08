import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Category, ContextRule } from "../types";
import { ColorPicker } from "./ColorPicker";
import { BuiltinBadge } from "./BuiltinBadge";
import { PRESET_COLORS } from "../constants";
import { validateRegexPattern } from "../utils/regex";

interface Props {
  categories: Category[];
  contextRules: ContextRule[];
  onCreateCategory: (name: string, color: string) => Promise<void>;
  onUpdateCategory: (id: number, name: string, color: string) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onCreateRule: (
    categoryId: number,
    sourceAppPattern: string | null,
    windowTitlePattern: string | null,
    priority: number,
  ) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onToggleRule: (id: number, enabled: boolean) => Promise<void>;
}

export function CategoriesManager({
  categories,
  contextRules,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onCreateRule,
  onDeleteRule,
  onToggleRule,
}: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newAppPat, setNewAppPat] = useState("");
  const [newTitlePat, setNewTitlePat] = useState("");
  const [newPriority, setNewPriority] = useState(10);

  // F-3: reset rule form when switching expanded row
  useEffect(() => {
    setNewAppPat("");
    setNewTitlePat("");
    setNewPriority(10);
  }, [expandedId]);

  function rulesFor(categoryId: number) {
    return contextRules.filter((r) => r.category_id === categoryId);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await onCreateCategory(name, newColor);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) return;
    await onUpdateCategory(editingId, name, editColor);
    setEditingId(null);
  }

  const appPatError = validateRegexPattern(newAppPat.trim());
  const titlePatError = validateRegexPattern(newTitlePat.trim());

  async function handleAddRule(categoryId: number) {
    const app = newAppPat.trim() || null;
    const title = newTitlePat.trim() || null;
    if (!app && !title) return;
    if (appPatError || titlePatError) return;
    await onCreateRule(categoryId, app, title, newPriority);
    setNewAppPat("");
    setNewTitlePat("");
    setNewPriority(10);
  }

  return (
    <div className="space-y-2">
      {categories.map((cat) => {
        const catRules = rulesFor(cat.id);
        const isExpanded = expandedId === cat.id;
        return (
          <div key={cat.id} className="rounded-lg bg-surface border border-stroke overflow-hidden">
            {/* Header row */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              {editingId === cat.id ? (
                <>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border border-stroke bg-surface-raised shrink-0"
                  />
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleUpdate(); if (e.key === "Escape") setEditingId(null); }}
                    className="flex-1 bg-surface-raised border border-stroke rounded px-2 py-1 text-sm text-content focus:outline-none focus:border-accent"
                  />
                  <button onClick={handleUpdate} className="text-xs text-accent hover:text-accent-text transition-colors px-2 py-1">{t("common.save")}</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-content-3 hover:text-content-2 transition-colors px-1 py-1">{t("common.cancel")}</button>
                </>
              ) : (
                <>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="flex-1 text-sm text-content font-medium truncate">{cat.name}</span>
                  <span className="text-[10px] text-content-3 shrink-0">{t("categories_mgr.rules_count", { count: catRules.length })}</span>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                    className="p-1 rounded text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors"
                    title={isExpanded ? t("categories_mgr.collapse") : t("categories_mgr.expand_rules")}
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!cat.is_builtin && (
                    <button
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditColor(cat.color); }}
                      className="p-1 rounded text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors"
                      title={t("common.edit")}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                  {cat.is_builtin ? (
                    <BuiltinBadge />
                  ) : (
                    <button
                      onClick={() => onDeleteCategory(cat.id)}
                      className="p-1 rounded text-content-3 hover:text-danger hover:bg-surface-raised transition-colors"
                      title={t("categories_mgr.delete_category")}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Expanded rules */}
            {isExpanded && (
              <div className="border-t border-stroke px-3 py-2.5 space-y-2 bg-base/40">
                {!cat.is_builtin && (
                  <div className="flex items-center gap-2 pb-2 border-b border-stroke/50">
                    <span className="text-[10px] text-content-3 uppercase tracking-wide font-medium w-10 shrink-0">{t("categories_mgr.color")}</span>
                    <ColorPicker size="sm" value={cat.color} onChange={(c) => onUpdateCategory(cat.id, cat.name, c)} />
                  </div>
                )}
                <p className="text-[10px] text-content-3 uppercase tracking-wide font-medium">
                  {t("categories_mgr.context_rules_title")}
                </p>
                {catRules.length === 0 && (
                  <p className="text-[11px] text-content-3 py-1">{t("categories_mgr.no_rules")}</p>
                )}
                {catRules.map((rule) => (
                  <div key={rule.id} className="flex items-start gap-2 group">
                    <div className="flex-1 space-y-1">
                      {rule.source_app_pattern && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-content-3 shrink-0 w-10">{t("categories_mgr.app")}</span>
                          <code className="flex-1 text-[11px] font-mono text-content-2 bg-surface-raised px-2 py-0.5 rounded truncate">
                            {rule.source_app_pattern}
                          </code>
                        </div>
                      )}
                      {rule.window_title_pattern && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-content-3 shrink-0 w-10">{t("categories_mgr.title_label")}</span>
                          <code className="flex-1 text-[11px] font-mono text-content-2 bg-surface-raised px-2 py-0.5 rounded truncate">
                            {rule.window_title_pattern}
                          </code>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-content-3 shrink-0 pt-0.5">p:{rule.priority}</span>
                    {/* Enable/disable toggle — works for all rules including builtin */}
                    <button
                      onClick={() => onToggleRule(rule.id, !rule.enabled)}
                      title={rule.enabled ? t("categories_mgr.disable_rule") : t("categories_mgr.enable_rule")}
                      className={`relative shrink-0 w-7 h-4 rounded-full transition-colors ${rule.enabled ? "bg-accent/50" : "bg-stroke"}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${rule.enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
                    </button>
                    {rule.is_builtin ? (
                      <BuiltinBadge size="sm" />
                    ) : (
                      <button
                        onClick={() => onDeleteRule(rule.id)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-content-3 hover:text-danger hover:bg-surface-raised transition-all"
                        title={t("categories_mgr.delete_rule")}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}

                {/* Add rule form */}
                <div className="pt-1 space-y-2 border-t border-stroke/50">
                  <p className="text-[10px] font-medium text-content-3 uppercase tracking-wide">{t("categories_mgr.add_rule")}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-content-3 w-10 shrink-0">{t("categories_mgr.app")}</span>
                      <div className="flex-1 space-y-0.5">
                        <input
                          placeholder={t("categories_mgr.app_pattern_placeholder")}
                          value={newAppPat}
                          onChange={(e) => setNewAppPat(e.target.value)}
                          className={`w-full bg-surface-raised border rounded px-2 py-1 text-xs font-mono text-content placeholder:text-content-3 focus:outline-none focus:border-accent ${appPatError && newAppPat ? "border-danger" : "border-stroke"}`}
                        />
                        {appPatError && newAppPat && (
                          <p className="text-[10px] text-danger">{appPatError}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-content-3 w-10 shrink-0">{t("categories_mgr.title_label")}</span>
                      <div className="flex-1 space-y-0.5">
                        <input
                          placeholder={t("categories_mgr.title_pattern_placeholder")}
                          value={newTitlePat}
                          onChange={(e) => setNewTitlePat(e.target.value)}
                          className={`w-full bg-surface-raised border rounded px-2 py-1 text-xs font-mono text-content placeholder:text-content-3 focus:outline-none focus:border-accent ${titlePatError && newTitlePat ? "border-danger" : "border-stroke"}`}
                        />
                        {titlePatError && newTitlePat && (
                          <p className="text-[10px] text-danger">{titlePatError}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-content-3 w-10 shrink-0">{t("categories_mgr.priority")}</label>
                      <input
                        type="number"
                        value={newPriority}
                        onChange={(e) => setNewPriority(Number(e.target.value))}
                        className="w-16 bg-surface-raised border border-stroke rounded px-2 py-1 text-xs font-mono text-content focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => handleAddRule(cat.id)}
                        disabled={(!newAppPat.trim() && !newTitlePat.trim()) || !!appPatError || !!titlePatError}
                        className="ml-auto px-2.5 py-1 rounded bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {t("common.add")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Create new category */}
      <div className="p-3 rounded-lg bg-surface border border-stroke space-y-3">
        <p className="text-xs font-medium text-content-2">{t("categories_mgr.new_category")}</p>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border border-stroke shrink-0" style={{ backgroundColor: newColor }} />
          <input
            placeholder={t("categories_mgr.name_placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            className="flex-1 bg-surface-raised border border-stroke rounded px-2 py-1.5 text-sm text-content placeholder:text-content-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-3 py-1.5 rounded bg-accent/20 text-accent text-sm font-medium hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("common.add")}
          </button>
        </div>
        <ColorPicker value={newColor} onChange={setNewColor} />
      </div>
    </div>
  );
}
