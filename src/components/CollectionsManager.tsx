import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Collection, CollectionRule, ContentTypeStyle } from "../types";
import { ColorPicker } from "./ColorPicker";
import { BuiltinBadge } from "./BuiltinBadge";
import { TypeaheadSelect } from "./TypeaheadSelect";
import { PRESET_COLORS } from "../constants";
import { validateRegexPattern } from "../utils/regex";

interface Props {
  collections: Collection[];
  contentTypes: ContentTypeStyle[];
  counts: Record<number, number>;
  collectionRules: CollectionRule[];
  onCreate: (name: string, color: string) => Promise<void>;
  onUpdate: (id: number, name: string, color: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCreateRule: (
    collectionId: number,
    contentType: string | null,
    sourceApp: string | null,
    windowTitle: string | null,
    contentPattern: string | null,
    priority: number,
  ) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onToggleRule: (id: number, enabled: boolean) => Promise<void>;
}

export function CollectionsManager({
  collections, contentTypes, counts, collectionRules,
  onCreate, onUpdate, onDelete,
  onCreateRule, onDeleteRule, onToggleRule,
}: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Rule form state — only content_type and content_pattern exposed
  const [newContentType, setNewContentType] = useState("");
  const [newContentPattern, setNewContentPattern] = useState("");

  useEffect(() => {
    setNewContentType("");
    setNewContentPattern("");
  }, [expandedId]);

  function rulesFor(collectionId: number) {
    return collectionRules.filter((r) => r.collection_id === collectionId);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await onCreate(name, newColor);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
  }

  function startEdit(col: Collection) {
    setEditingId(col.id);
    setEditName(col.name);
    setEditColor(col.color);
  }

  async function handleUpdate() {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) return;
    await onUpdate(editingId, name, editColor);
    setEditingId(null);
  }

  const contentPatError = validateRegexPattern(newContentPattern.trim());
  const hasAnyCriteria = !!newContentType || !!newContentPattern.trim();

  async function handleAddRule(collectionId: number) {
    if (!hasAnyCriteria) return;
    if (contentPatError) return;
    await onCreateRule(
      collectionId,
      newContentType || null,
      null, // source_app — not exposed in UI
      null, // window_title — not exposed in UI
      newContentPattern.trim() || null,
      0,    // priority — simplified, always 0
    );
    setNewContentType("");
    setNewContentPattern("");
  }

  return (
    <div className="space-y-2">
      {collections.length === 0 && (
        <p className="text-xs text-content-3 text-center py-4">{t("collections_mgr.no_collections")}</p>
      )}
      {collections.map((col) => {
        const colRules = rulesFor(col.id);
        const isExpanded = expandedId === col.id;
        return (
          <div key={col.id} className={`rounded-lg bg-surface border border-stroke ${isExpanded ? "overflow-visible" : "overflow-hidden"}`}>
            {/* Header row */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              {editingId === col.id ? (
                <>
                  <ColorPicker size="sm" value={editColor} onChange={setEditColor} />
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
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                  <span className="flex-1 text-sm text-content font-medium truncate">{col.name}</span>
                  <span className="text-[10px] text-content-3 shrink-0">{t("collections_mgr.entries_count", { count: counts[col.id] ?? 0 })}</span>
                  {colRules.length > 0 && (
                    <span className="text-[10px] text-content-3 shrink-0">{t("collections_mgr.rules_count", { count: colRules.length })}</span>
                  )}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : col.id)}
                    className="p-1 rounded text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors"
                    title={isExpanded ? t("collections_mgr.collapse") : t("collections_mgr.expand_rules")}
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => startEdit(col)}
                    className="p-1 rounded text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors"
                    title={t("common.edit")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {col.is_builtin ? (
                    <BuiltinBadge />
                  ) : (
                    <button
                      onClick={() => onDelete(col.id)}
                      className="p-1 rounded text-content-3 hover:text-danger hover:bg-surface-raised transition-colors"
                      title={t("common.delete")}
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
                {!col.is_builtin && (
                  <div className="flex items-center gap-2 pb-2 border-b border-stroke/50">
                    <span className="text-[10px] text-content-3 uppercase tracking-wide font-medium w-10 shrink-0">{t("categories_mgr.color")}</span>
                    <ColorPicker size="sm" value={col.color} onChange={(c) => onUpdate(col.id, col.name, c)} />
                  </div>
                )}
                <p className="text-[10px] text-content-3 uppercase tracking-wide font-medium">
                  {t("collections_mgr.rules_title")}
                </p>
                {colRules.length === 0 && (
                  <p className="text-[11px] text-content-3 py-1">{t("collections_mgr.no_rules")}</p>
                )}
                {colRules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2 group">
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      {rule.content_type && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-raised text-content-2 border border-stroke truncate">
                          {contentTypes.find((ct) => ct.name === rule.content_type)?.label ?? rule.content_type}
                        </span>
                      )}
                      {rule.content_type && rule.content_pattern && (
                        <span className="text-[10px] text-content-3">+</span>
                      )}
                      {rule.content_pattern && (
                        <code className="text-[11px] font-mono text-content-2 bg-surface-raised px-1.5 py-0.5 rounded border border-stroke truncate">
                          {rule.content_pattern}
                        </code>
                      )}
                    </div>
                    <button
                      onClick={() => onToggleRule(rule.id, !rule.enabled)}
                      title={rule.enabled ? t("collections_mgr.disable_rule") : t("collections_mgr.enable_rule")}
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
                        title={t("collections_mgr.delete_rule")}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}

                {/* Add rule form — simplified: content type + content pattern */}
                <div className="pt-1 space-y-2 border-t border-stroke/50">
                  <p className="text-[10px] font-medium text-content-3 uppercase tracking-wide">{t("collections_mgr.add_rule")}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-28 shrink-0">
                      <TypeaheadSelect
                        value={newContentType}
                        onChange={setNewContentType}
                        options={contentTypes.map((ct) => ({ value: ct.name, label: ct.label }))}
                        placeholder={t("collections_mgr.content_type_label")}
                      />
                    </div>
                    <div className="flex-1 space-y-0.5">
                      <input
                        placeholder={t("collections_mgr.content_pattern_placeholder")}
                        value={newContentPattern}
                        onChange={(e) => setNewContentPattern(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddRule(col.id); }}
                        className={`w-full bg-surface-raised border rounded px-2 py-1 text-xs font-mono text-content placeholder:text-content-3 focus:outline-none focus:border-accent ${contentPatError && newContentPattern ? "border-danger" : "border-stroke"}`}
                      />
                      {contentPatError && newContentPattern && <p className="text-[10px] text-danger">{contentPatError}</p>}
                    </div>
                    <button
                      onClick={() => handleAddRule(col.id)}
                      disabled={!hasAnyCriteria || !!contentPatError}
                      className="px-2.5 py-1 rounded bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      {t("common.add")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Create new collection */}
      <div className="p-3 rounded-lg bg-surface border border-stroke space-y-3">
        <p className="text-xs font-medium text-content-2">{t("collections_mgr.new_collection")}</p>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border border-stroke shrink-0" style={{ backgroundColor: newColor }} />
          <input
            placeholder={t("collections_mgr.name_placeholder")}
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
