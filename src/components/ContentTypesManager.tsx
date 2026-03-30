import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContentRule, ContentTypeStyle } from "../types";
import { ColorPicker } from "./ColorPicker";
import { BuiltinBadge } from "./BuiltinBadge";
import { PRESET_COLORS } from "../constants";
import { validateRegexPattern } from "../utils/regex";

interface Props {
  contentTypes: ContentTypeStyle[];
  rules: ContentRule[];
  onColorChange: (name: string, color: string) => void;
  onCreateType: (name: string, label: string, color: string) => Promise<void>;
  onDeleteType: (name: string) => Promise<void>;
  onCreateRule: (contentType: string, pattern: string, minHits: number, priority: number) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onToggleRule: (id: number, enabled: boolean) => Promise<void>;
}

export function ContentTypesManager({
  contentTypes,
  rules,
  onColorChange,
  onCreateType,
  onDeleteType,
  onCreateRule,
  onDeleteRule,
  onToggleRule,
}: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [newMinHits, setNewMinHits] = useState(1);
  const [newPriority, setNewPriority] = useState(10);

  // F-3: reset rule form when switching expanded row
  useEffect(() => {
    setNewPattern("");
    setNewMinHits(1);
    setNewPriority(10);
  }, [expandedType]);

  function rulesFor(typeName: string) {
    return rules.filter((r) => r.content_type === typeName);
  }

  async function handleCreateType() {
    const name = newName.trim();
    const label = newLabel.trim();
    if (!name || !label) return;
    await onCreateType(name, label, newColor);
    setNewName("");
    setNewLabel("");
    setNewColor(PRESET_COLORS[0]);
  }

  const newNameError = newName.trim() && contentTypes.some((ct) => ct.name.toLowerCase() === newName.trim().toLowerCase())
    ? t("validation.duplicate_id")
    : null;
  const newLabelError = newLabel.trim() && contentTypes.some((ct) => ct.label.toLowerCase() === newLabel.trim().toLowerCase())
    ? t("validation.duplicate_name")
    : null;

  const patternError = validateRegexPattern(newPattern.trim());

  async function handleAddRule(typeName: string) {
    const pattern = newPattern.trim();
    if (!pattern || patternError) return;
    await onCreateRule(typeName, pattern, newMinHits, newPriority);
    setNewPattern("");
    setNewMinHits(1);
    setNewPriority(10);
  }

  return (
    <div className="space-y-2">
      {contentTypes.map((ct) => {
        const typeRules = rulesFor(ct.name);
        const isExpanded = expandedType === ct.name;
        return (
          <div key={ct.name} className="rounded-lg bg-surface border border-stroke overflow-hidden">
            {/* Header row */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ct.color }} />
              <span className="flex-1 text-sm text-content font-medium truncate">{ct.label}</span>
              <span className="text-[10px] font-mono text-content-3 shrink-0">{ct.name}</span>
              <span className="text-[10px] text-content-3 shrink-0">{t("content_types_mgr.rules_count", { count: typeRules.length })}</span>
              <button
                onClick={() => setExpandedType(isExpanded ? null : ct.name)}
                className="p-1 rounded text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors"
                title={isExpanded ? t("content_types_mgr.collapse") : t("content_types_mgr.expand_rules")}
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {ct.is_builtin ? (
                <BuiltinBadge />
              ) : (
                <button
                  onClick={() => onDeleteType(ct.name)}
                  className="p-1 rounded text-content-3 hover:text-danger hover:bg-surface-raised transition-colors"
                  title={t("content_types_mgr.delete_type")}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>

            {/* Expanded rules */}
            {isExpanded && (
              <div className="border-t border-stroke px-3 py-2.5 space-y-2 bg-base/40">
                <div className="flex items-center gap-2 pb-2 border-b border-stroke/50">
                  <span className="text-[10px] text-content-3 uppercase tracking-wide font-medium w-10 shrink-0">{t("content_types_mgr.color")}</span>
                  <ColorPicker size="sm" value={ct.color} onChange={(c) => onColorChange(ct.name, c)} />
                </div>
                {typeRules.length === 0 && (
                  <p className="text-[11px] text-content-3 py-1">{t("content_types_mgr.no_rules")}</p>
                )}
                {typeRules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2 group">
                    <code className="flex-1 text-[11px] font-mono text-content-2 bg-surface-raised px-2 py-1 rounded truncate">
                      {rule.pattern}
                    </code>
                    <span className="text-[10px] text-content-3 shrink-0">{t("content_types_mgr.min_hits", { n: rule.min_hits })}</span>
                    <span className="text-[10px] text-content-3 shrink-0">{t("content_types_mgr.priority_display", { n: rule.priority })}</span>
                    {/* Enable/disable toggle — works for all rules including builtin */}
                    <button
                      onClick={() => onToggleRule(rule.id, !rule.enabled)}
                      title={rule.enabled ? t("content_types_mgr.disable_rule") : t("content_types_mgr.enable_rule")}
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
                        title={t("content_types_mgr.delete_rule")}
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
                  <p className="text-[10px] font-medium text-content-3 uppercase tracking-wide">{t("content_types_mgr.add_rule")}</p>
                  <div className="space-y-0.5">
                    <input
                      placeholder={t("content_types_mgr.pattern_placeholder")}
                      value={newPattern}
                      onChange={(e) => setNewPattern(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddRule(ct.name); }}
                      className={`w-full bg-surface-raised border rounded px-2 py-1 text-xs font-mono text-content placeholder:text-content-3 focus:outline-none focus:border-accent ${patternError && newPattern ? "border-danger" : "border-stroke"}`}
                    />
                    {patternError && newPattern && (
                      <p className="text-[10px] text-danger">{patternError}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-content-3 shrink-0">{t("content_types_mgr.min_hits_label")}</label>
                    <input
                      type="number" min="1" value={newMinHits}
                      onChange={(e) => setNewMinHits(Number(e.target.value))}
                      className="w-16 bg-surface-raised border border-stroke rounded px-2 py-1 text-xs font-mono text-content focus:outline-none focus:border-accent"
                    />
                    <label className="text-[10px] text-content-3 shrink-0">{t("content_types_mgr.priority_label")}</label>
                    <input
                      type="number" value={newPriority}
                      onChange={(e) => setNewPriority(Number(e.target.value))}
                      className="w-16 bg-surface-raised border border-stroke rounded px-2 py-1 text-xs font-mono text-content focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => handleAddRule(ct.name)}
                      disabled={!newPattern.trim() || !!patternError}
                      className="ml-auto px-2.5 py-1 rounded bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

      {/* Create new content type */}
      <div className="p-3 rounded-lg bg-surface border border-stroke space-y-3">
        <p className="text-xs font-medium text-content-2">{t("content_types_mgr.new_type")}</p>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border border-stroke shrink-0" style={{ backgroundColor: newColor }} />
          <div className="flex flex-col gap-0.5">
            <input
              placeholder={t("content_types_mgr.name_placeholder")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`w-28 bg-surface-raised border rounded px-2 py-1.5 text-xs font-mono text-content placeholder:text-content-3 focus:outline-none transition-colors ${newNameError ? "border-danger focus:border-danger" : "border-stroke focus:border-accent"}`}
            />
            {newNameError && <p className="text-[10px] text-danger">{newNameError}</p>}
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <input
              placeholder={t("content_types_mgr.label_placeholder")}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !newNameError && !newLabelError) handleCreateType(); }}
              className={`w-full bg-surface-raised border rounded px-2 py-1.5 text-sm text-content placeholder:text-content-3 focus:outline-none transition-colors ${newLabelError ? "border-danger focus:border-danger" : "border-stroke focus:border-accent"}`}
            />
            {newLabelError && <p className="text-[10px] text-danger">{newLabelError}</p>}
          </div>
          <button
            onClick={handleCreateType}
            disabled={!newName.trim() || !newLabel.trim() || !!newNameError || !!newLabelError}
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
