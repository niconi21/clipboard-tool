import { useCallback, useRef, useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation, Trans } from "react-i18next";
import type { Category, Collection, CollectionRule, ContentRule, ContentTypeStyle, ContextRule, Language, Setting, Subcollection, Theme } from "../types";
import { CollectionsManager } from "./CollectionsManager";
import { ContentTypesManager } from "./ContentTypesManager";
import { CategoriesManager } from "./CategoriesManager";

export interface ThemeColors {
  base: string; surface: string; surface_raised: string; surface_active: string;
  stroke: string; stroke_strong: string; content: string; content_2: string;
  content_3: string; accent: string; accent_text: string;
}

const COLOR_SLOTS: { key: keyof ThemeColors; labelKey: string }[] = [
  { key: "base",           labelKey: "settings.appearance.theme_slot_base" },
  { key: "surface",        labelKey: "settings.appearance.theme_slot_surface" },
  { key: "surface_raised", labelKey: "settings.appearance.theme_slot_surface_raised" },
  { key: "surface_active", labelKey: "settings.appearance.theme_slot_surface_active" },
  { key: "stroke",         labelKey: "settings.appearance.theme_slot_stroke" },
  { key: "stroke_strong",  labelKey: "settings.appearance.theme_slot_stroke_strong" },
  { key: "content",        labelKey: "settings.appearance.theme_slot_content" },
  { key: "content_2",      labelKey: "settings.appearance.theme_slot_content_2" },
  { key: "content_3",      labelKey: "settings.appearance.theme_slot_content_3" },
  { key: "accent",         labelKey: "settings.appearance.theme_slot_accent" },
  { key: "accent_text",    labelKey: "settings.appearance.theme_slot_accent_text" },
];

function themeToColors(theme: Theme): ThemeColors {
  return {
    base: theme.base, surface: theme.surface, surface_raised: theme.surface_raised,
    surface_active: theme.surface_active, stroke: theme.stroke, stroke_strong: theme.stroke_strong,
    content: theme.content, content_2: theme.content_2, content_3: theme.content_3,
    accent: theme.accent, accent_text: theme.accent_text,
  };
}

interface Props {
  settings: Setting[];
  contentTypes: ContentTypeStyle[];
  contentTypeRules: ContentRule[];
  themes: Theme[];
  activeThemeSlug: string;
  collections: Collection[];
  collectionCounts: Record<number, number>;
  categories: Category[];
  contextRules: ContextRule[];
  languages: Language[];
  onClose: () => void;
  onSettingChange: (key: string, value: string) => void;
  onContentTypeColorChange: (name: string, color: string) => void;
  onThemeChange: (slug: string) => void;
  onCreateCollection: (name: string, color: string) => Promise<void>;
  onUpdateCollection: (id: number, name: string, color: string) => Promise<void>;
  onDeleteCollection: (id: number) => Promise<void>;
  onCreateContentType: (name: string, label: string, color: string) => Promise<void>;
  onDeleteContentType: (name: string) => Promise<void>;
  onCreateContentTypeRule: (contentType: string, pattern: string, minHits: number, priority: number) => Promise<void>;
  onDeleteContentTypeRule: (id: number) => Promise<void>;
  onCreateCategory: (name: string, color: string) => Promise<void>;
  onUpdateCategory: (id: number, name: string, color: string) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onCreateContextRule: (categoryId: number, sourceAppPattern: string | null, windowTitlePattern: string | null, priority: number) => Promise<void>;
  onDeleteContextRule: (id: number) => Promise<void>;
  onToggleContextRule: (id: number, enabled: boolean) => Promise<void>;
  onToggleContentTypeRule: (id: number, enabled: boolean) => Promise<void>;
  collectionRules: CollectionRule[];
  onCreateCollectionRule: (collectionId: number, contentType: string | null, sourceApp: string | null, windowTitle: string | null, contentPattern: string | null, priority: number) => Promise<void>;
  onDeleteCollectionRule: (id: number) => Promise<void>;
  onToggleCollectionRule: (id: number, enabled: boolean) => Promise<void>;
  subcollections: Subcollection[];
  onCreateSubcollection: (collectionId: number, name: string) => Promise<Subcollection>;
  onRenameSubcollection: (id: number, name: string) => Promise<void>;
  onDeleteSubcollection: (id: number) => Promise<void>;
  onCreateTheme: (name: string, colors: ThemeColors) => Promise<void>;
  onUpdateTheme: (slug: string, name: string, colors: ThemeColors) => Promise<void>;
  onDeleteTheme: (slug: string) => Promise<void>;
  onReclassify: (includeOverrides: boolean) => Promise<number>;
  onClearHistory: () => Promise<number>;
  onConfigImported: () => void;
}

type Tab = "appearance" | "content-types" | "categories" | "collections" | "behavior" | "about";

export function SettingsPanel({
  settings,
  contentTypes,
  contentTypeRules,
  themes,
  activeThemeSlug,
  collections,
  collectionCounts,
  categories,
  contextRules,
  languages,
  onClose,
  onSettingChange,
  onContentTypeColorChange,
  onThemeChange,
  onCreateCollection,
  onUpdateCollection,
  onDeleteCollection,
  onCreateContentType,
  onDeleteContentType,
  onCreateContentTypeRule,
  onDeleteContentTypeRule,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onCreateContextRule,
  onDeleteContextRule,
  onToggleContextRule,
  onToggleContentTypeRule,
  collectionRules,
  onCreateCollectionRule,
  onDeleteCollectionRule,
  onToggleCollectionRule,
  subcollections,
  onCreateSubcollection,
  onRenameSubcollection,
  onDeleteSubcollection,
  onCreateTheme,
  onUpdateTheme,
  onDeleteTheme,
  onReclassify,
  onClearHistory,
  onConfigImported,
}: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("appearance");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Theme editor state
  const [themeEditor, setThemeEditor] = useState<{
    mode: "create" | "edit";
    slug?: string;
    name: string;
    colors: ThemeColors;
  } | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const originalColorsRef = useRef<ThemeColors | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const themeEditorRef = useRef(themeEditor);
  const revertPreviewRef = useRef<() => void>(() => {});
  useEffect(() => { themeEditorRef.current = themeEditor; }, [themeEditor]);

  // Revert CSS vars when settings panel closes with an open editor (e.g. X button)
  useEffect(() => {
    return () => {
      if (themeEditorRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        revertPreviewRef.current();
      }
    };
  }, []);

  // Apply CSS variables directly for live preview
  function applyPreviewColors(colors: ThemeColors) {
    const root = document.documentElement.style;
    root.setProperty("--color-base",           colors.base);
    root.setProperty("--color-surface",        colors.surface);
    root.setProperty("--color-surface-raised", colors.surface_raised);
    root.setProperty("--color-surface-active", colors.surface_active);
    root.setProperty("--color-stroke",         colors.stroke);
    root.setProperty("--color-stroke-strong",  colors.stroke_strong);
    root.setProperty("--color-content",        colors.content);
    root.setProperty("--color-content-2",      colors.content_2);
    root.setProperty("--color-content-3",      colors.content_3);
    root.setProperty("--color-accent",         colors.accent);
    root.setProperty("--color-accent-text",    colors.accent_text);
  }

  function revertPreview() {
    const active = themes.find((t) => t.slug === activeThemeSlug) ?? themes[0];
    if (active) applyPreviewColors({
      base: active.base, surface: active.surface, surface_raised: active.surface_raised,
      surface_active: active.surface_active, stroke: active.stroke, stroke_strong: active.stroke_strong,
      content: active.content, content_2: active.content_2, content_3: active.content_3,
      accent: active.accent, accent_text: active.accent_text,
    });
  }
  revertPreviewRef.current = revertPreview;

  function openThemeEditor(state: { mode: "create" | "edit"; slug?: string; name: string; colors: ThemeColors }) {
    originalColorsRef.current = { ...state.colors };
    applyPreviewColors(state.colors);
    setThemeEditor(state);
  }

  function handleColorChange(key: keyof ThemeColors, value: string) {
    if (!themeEditor) return;
    const newColors = { ...themeEditor.colors, [key]: value };
    setThemeEditor({ ...themeEditor, colors: newColors });
    applyPreviewColors(newColors);
    // Auto-save debounced in edit mode
    if (themeEditor.mode === "edit" && themeEditor.slug) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(async () => {
        try {
          await onUpdateTheme(themeEditor.slug!, themeEditor.name, newColors);
        } catch (e) {
          console.error("[ThemeEditor] auto-save failed:", e);
        }
      }, 800);
    }
  }

  function handleCancelEditor() {
    clearTimeout(autoSaveTimerRef.current);
    revertPreview();
    setThemeEditor(null);
    originalColorsRef.current = null;
  }

  // Config export/import state
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importTotal, setImportTotal] = useState<number | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportDone(false);
    try {
      const path = await invoke<string>("export_config");
      if (path) { setExportDone(true); setTimeout(() => setExportDone(false), 3000); }
    } catch (e) { console.error("[Settings] export failed:", e); }
    finally { setExporting(false); }
  }

  async function handleImport() {
    setImporting(true);
    setImportTotal(null);
    try {
      const s = await invoke<{ settings: number; themes: number; categories: number; content_types: number; content_type_rules: number; context_rules: number; collections: number; subcollections: number; collection_rules: number }>("import_config");
      const total = s.settings + s.themes + s.categories + s.content_types + s.content_type_rules + s.context_rules + s.collections + s.subcollections + s.collection_rules;
      setImportTotal(total);
      onConfigImported();
      setTimeout(() => setImportTotal(null), 5000);
    } catch (e) {
      if (typeof e === "string" && e === "CANCELLED") { /* user cancelled */ }
      else { console.error("[Settings] import failed:", e); }
    }
    finally { setImporting(false); }
  }

  // Reclassify state
  const [reclassifyDialog, setReclassifyDialog] = useState(false);
  const [reclassifyIncludeOverrides, setReclassifyIncludeOverrides] = useState(false);
  const [reclassifyRunning, setReclassifyRunning] = useState(false);
  const [reclassifyResult, setReclassifyResult] = useState<number | null>(null);

  const [clearHistoryDialog, setClearHistoryDialog] = useState(false);
  const [clearHistoryRunning, setClearHistoryRunning] = useState(false);
  const [clearHistoryResult, setClearHistoryResult] = useState<number | null>(null);

  async function handleReclassify() {
    setReclassifyRunning(true);
    setReclassifyResult(null);
    try {
      const count = await onReclassify(reclassifyIncludeOverrides);
      setReclassifyResult(count);
    } catch (e) {
      console.error("[Reclassify] failed:", e);
    } finally {
      setReclassifyRunning(false);
      setReclassifyDialog(false);
      setReclassifyIncludeOverrides(false);
    }
  }

  async function handleClearHistory() {
    setClearHistoryRunning(true);
    setClearHistoryResult(null);
    try {
      const count = await onClearHistory();
      setClearHistoryResult(count);
    } catch (e) {
      console.error("[ClearHistory] failed:", e);
    } finally {
      setClearHistoryRunning(false);
      setClearHistoryDialog(false);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "appearance",    label: t("settings.tabs.appearance") },
    { id: "content-types", label: t("settings.tabs.content_types") },
    { id: "categories",    label: t("settings.tabs.categories") },
    { id: "collections",   label: t("settings.tabs.collections") },
    { id: "behavior",      label: t("settings.tabs.behavior") },
    { id: "about",         label: t("settings.tabs.about") },
  ];

  const debouncedSettingChange = useCallback((key: string, value: string) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSettingChange(key, value), 600);
  }, [onSettingChange]);

  function getSetting(key: string, fallback: string): string {
    return settings.find((s) => s.key === key)?.value ?? fallback;
  }

  const maxBytes = getSetting("content_analysis_max_bytes", "8192");
  const maxImageBytes = getSetting("max_image_size_bytes", "36700160");
  const pageSize = getSetting("page_size", "50");
  const maxEntries = getSetting("max_history_entries", "0");
  const retentionDays = getSetting("retention_days", "0");
  const dedupInterval = getSetting("dedup_interval_minutes", "5");
  const activeLang = getSetting("language", "en");

  return (
    <div className="flex flex-col h-full bg-base">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stroke shrink-0 bg-surface/50">
        <span className="text-sm font-semibold text-content">{t("settings.title")}</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-content-2 hover:text-content hover:bg-surface-raised transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-3 pt-2 pb-0 shrink-0 border-b border-stroke overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 -mb-px ${
              activeTab === tab.id
                ? "text-accent border-accent bg-accent/5"
                : "text-content-3 border-transparent hover:text-content-2 hover:bg-surface-raised"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

        {/* ── Appearance ─────────────────────────────────────────── */}
        {activeTab === "appearance" && (
          <>
            <Section title={t("settings.appearance.theme_title")} description={t("settings.appearance.theme_desc")}>
              {themeEditor ? (
                <div className="p-4 rounded-lg bg-surface border border-stroke space-y-4">
                  <div>
                    <label className="text-xs text-content-2 block mb-1">{t("settings.appearance.theme_name")}</label>
                    <input
                      type="text"
                      value={themeEditor.name}
                      onChange={(e) => setThemeEditor({ ...themeEditor, name: e.target.value })}
                      placeholder={t("settings.appearance.theme_name_placeholder")}
                      className="w-full bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {COLOR_SLOTS.map(({ key, labelKey }) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={themeEditor.colors[key]}
                          onChange={(e) => handleColorChange(key, e.target.value)}
                          className="w-8 h-8 rounded border border-stroke cursor-pointer shrink-0 bg-transparent"
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-content truncate">{t(labelKey)}</p>
                          <p className="text-[10px] text-content-3 font-mono">{themeEditor.colors[key]}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Preview */}
                  <div className="flex gap-1">
                    {(["base", "surface", "surface_raised", "surface_active", "stroke", "stroke_strong", "content", "content_2", "content_3", "accent", "accent_text"] as const).map((k) => (
                      <div key={k} className="flex-1 h-6 rounded-sm border border-white/10" style={{ backgroundColor: themeEditor.colors[k] }} title={k} />
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {themeEditor.mode === "create" ? (
                      <button
                        disabled={themeSaving || !themeEditor.name.trim()}
                        onClick={async () => {
                          setThemeSaving(true);
                          try {
                            await onCreateTheme(themeEditor.name.trim(), themeEditor.colors);
                            setThemeEditor(null);
                            originalColorsRef.current = null;
                          } catch (e) {
                            console.error("[ThemeEditor] save failed:", e);
                          } finally {
                            setThemeSaving(false);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-30"
                        style={{ backgroundColor: themeEditor.colors.accent }}
                      >
                        {t("settings.appearance.theme_save")}
                      </button>
                    ) : (
                      <span className="text-[10px] text-content-3 italic">{t("settings.appearance.theme_autosave")}</span>
                    )}
                    {themeEditor.mode === "edit" && originalColorsRef.current && (
                      <button
                        onClick={() => {
                          const orig = originalColorsRef.current!;
                          setThemeEditor({ ...themeEditor, colors: orig });
                          applyPreviewColors(orig);
                          clearTimeout(autoSaveTimerRef.current);
                          autoSaveTimerRef.current = setTimeout(async () => {
                            try { await onUpdateTheme(themeEditor.slug!, themeEditor.name, orig); }
                            catch (e) { console.error("[ThemeEditor] reset save failed:", e); }
                          }, 100);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg text-content-2 hover:text-content hover:bg-surface-raised transition-colors border border-stroke"
                      >
                        {t("settings.appearance.theme_reset")}
                      </button>
                    )}
                    <button
                      onClick={handleCancelEditor}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-content-2 hover:text-content hover:bg-surface-raised transition-colors border border-stroke"
                    >
                      {t("settings.appearance.theme_cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2">
                    {themes.map((theme) => (
                      <div
                        key={theme.slug}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          activeThemeSlug === theme.slug
                            ? "border-accent/60 bg-accent/10"
                            : "border-stroke hover:border-stroke-strong bg-surface"
                        }`}
                      >
                        <button
                          onClick={() => onThemeChange(theme.slug)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <div className="flex gap-1 shrink-0">
                            <div className="w-5 h-8 rounded-sm border border-white/10" style={{ backgroundColor: theme.base }} />
                            <div className="w-5 h-8 rounded-sm border border-white/10" style={{ backgroundColor: theme.surface }} />
                            <div className="w-5 h-8 rounded-sm border border-white/10" style={{ backgroundColor: theme.surface_raised }} />
                            <div className="w-5 h-8 rounded-sm border border-white/10" style={{ backgroundColor: theme.accent }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-content font-medium">{theme.name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                              <span className="text-[10px] text-content-2 font-mono">{theme.accent}</span>
                            </div>
                          </div>
                          {activeThemeSlug === theme.slug && (
                            <svg className="w-4 h-4 shrink-0" style={{ color: theme.accent }} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.5 3.5 6.5-7" />
                            </svg>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Duplicate — available on all themes */}
                          <button
                            onClick={() => openThemeEditor({
                              mode: "create",
                              name: `${theme.name} (copy)`,
                              colors: themeToColors(theme),
                            })}
                            className="p-1 rounded text-content-3 hover:text-content hover:bg-surface-raised transition-colors"
                            title={t("settings.appearance.duplicate_theme")}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          {/* Edit + Delete — only for custom themes */}
                          {!theme.is_builtin && (
                            <>
                              <button
                                onClick={() => openThemeEditor({ mode: "edit", slug: theme.slug, name: theme.name, colors: themeToColors(theme) })}
                                className="p-1 rounded text-content-3 hover:text-content hover:bg-surface-raised transition-colors"
                                title={t("settings.appearance.edit_theme")}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => onDeleteTheme(theme.slug)}
                                className="p-1 rounded text-content-3 hover:text-red-400 hover:bg-surface-raised transition-colors"
                                title={t("settings.appearance.delete_theme")}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => openThemeEditor({
                      mode: "create",
                      name: "",
                      colors: {
                        base: "#0a0a0a", surface: "#141414", surface_raised: "#1e1e1e", surface_active: "#282828",
                        stroke: "#2a2a2a", stroke_strong: "#404040", content: "#e5e5e5", content_2: "#a0a0a0",
                        content_3: "#666666", accent: "#3b82f6", accent_text: "#ffffff",
                      },
                    })}
                    className="mt-2 flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-content-2 hover:text-content border border-dashed border-stroke hover:border-stroke-strong transition-colors w-full justify-center"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    {t("settings.appearance.create_theme")}
                  </button>
                </>
              )}
            </Section>

            {languages.length > 0 && (
              <Section title={t("settings.appearance.language_title")} description={t("settings.appearance.language_desc")}>
                <div className="grid grid-cols-1 gap-2">
                  {languages.filter((l) => l.is_active).map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => onSettingChange("language", lang.code)}
                      className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors text-left ${
                        activeLang === lang.code
                          ? "border-accent/60 bg-accent/10"
                          : "border-stroke hover:border-stroke-strong bg-surface"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-content font-medium">{lang.native_name}</p>
                        <p className="text-xs text-content-2 mt-0.5">{lang.name}</p>
                      </div>
                      {activeLang === lang.code && (
                        <svg className="w-4 h-4 shrink-0 text-accent" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.5 3.5 6.5-7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ── Content Types ──────────────────────────────────────── */}
        {activeTab === "content-types" && (
          <Section
            title={t("settings.content_types.section_title")}
            description={t("settings.content_types.section_desc")}
          >
            <ContentTypesManager
              contentTypes={contentTypes}
              rules={contentTypeRules}
              onColorChange={onContentTypeColorChange}
              onCreateType={onCreateContentType}
              onDeleteType={onDeleteContentType}
              onCreateRule={onCreateContentTypeRule}
              onDeleteRule={onDeleteContentTypeRule}
              onToggleRule={onToggleContentTypeRule}
            />
          </Section>
        )}

        {/* ── Categories ─────────────────────────────────────────── */}
        {activeTab === "categories" && (
          <Section
            title={t("settings.categories.section_title")}
            description={t("settings.categories.section_desc")}
          >
            <CategoriesManager
              categories={categories}
              contextRules={contextRules}
              onCreateCategory={onCreateCategory}
              onUpdateCategory={onUpdateCategory}
              onDeleteCategory={onDeleteCategory}
              onCreateRule={onCreateContextRule}
              onDeleteRule={onDeleteContextRule}
              onToggleRule={onToggleContextRule}
            />
          </Section>
        )}

        {/* ── Collections ────────────────────────────────────────── */}
        {activeTab === "collections" && (
          <Section
            title={t("settings.collections_section.section_title")}
            description={t("settings.collections_section.section_desc")}
          >
            <CollectionsManager
              collections={collections}
              contentTypes={contentTypes}
              counts={collectionCounts}
              collectionRules={collectionRules}
              subcollections={subcollections}
              onCreate={onCreateCollection}
              onUpdate={onUpdateCollection}
              onDelete={onDeleteCollection}
              onCreateRule={onCreateCollectionRule}
              onDeleteRule={onDeleteCollectionRule}
              onToggleRule={onToggleCollectionRule}
              onCreateSubcollection={onCreateSubcollection}
              onRenameSubcollection={onRenameSubcollection}
              onDeleteSubcollection={onDeleteSubcollection}
            />
          </Section>
        )}

        {/* ── Behavior ───────────────────────────────────────────── */}
        {activeTab === "behavior" && (
          <Section title={t("settings.behavior.section_title")} description={t("settings.behavior.section_desc")}>
            <div className="p-4 rounded-lg bg-surface border border-stroke space-y-4">
              <SettingRow
                label={t("settings.behavior.page_size_label")}
                description={t("settings.behavior.page_size_desc")}
              >
                <input
                  type="number" min="10" max="200" step="10"
                  value={pageSize}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 10) debouncedSettingChange("page_size", v); }}
                  className="w-24 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>

              <div className="border-t border-stroke" />

              <SettingRow
                label={t("settings.behavior.max_history_label")}
                description={<Trans i18nKey="settings.behavior.max_history_desc" components={{ code: <Code /> }} />}
              >
                <input
                  type="number" min="0" step="100"
                  value={maxEntries}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) debouncedSettingChange("max_history_entries", v); }}
                  className="w-24 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>

              <div className="border-t border-stroke" />

              <SettingRow
                label={t("settings.behavior.retention_label")}
                description={<Trans i18nKey="settings.behavior.retention_desc" components={{ code: <Code /> }} />}
              >
                <input
                  type="number" min="0" step="1"
                  value={retentionDays}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) debouncedSettingChange("retention_days", v); }}
                  className="w-24 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>

              <div className="border-t border-stroke" />

              <SettingRow
                label={t("settings.behavior.dedup_label")}
                description={<Trans i18nKey="settings.behavior.dedup_desc" components={{ code: <Code /> }} />}
              >
                <input
                  type="number" min="0" step="1"
                  value={dedupInterval}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) debouncedSettingChange("dedup_interval_minutes", v); }}
                  className="w-24 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>

              <div className="border-t border-stroke" />

              <SettingRow
                label={t("settings.behavior.max_bytes_label")}
                description={<Trans i18nKey="settings.behavior.max_bytes_desc" components={{ code: <Code /> }} />}
              >
                <input
                  type="number" min="0" step="1024"
                  value={maxBytes}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) debouncedSettingChange("content_analysis_max_bytes", v); }}
                  className="w-24 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>

              <div className="border-t border-stroke" />

              <SettingRow
                label={t("settings.behavior.max_image_label")}
                description={<Trans i18nKey="settings.behavior.max_image_desc" components={{ code: <Code /> }} />}
              >
                <input
                  type="number" min="0" step="1048576"
                  value={maxImageBytes}
                  onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) debouncedSettingChange("max_image_size_bytes", v); }}
                  className="w-28 bg-surface-raised border border-stroke rounded-lg px-3 py-2 text-sm text-content font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shrink-0"
                />
              </SettingRow>
            </div>
            <ReclassifyBlock
              dialog={reclassifyDialog}
              running={reclassifyRunning}
              result={reclassifyResult}
              includeOverrides={reclassifyIncludeOverrides}
              onOpenDialog={() => { setReclassifyDialog(true); setReclassifyResult(null); }}
              onCloseDialog={() => { setReclassifyDialog(false); setReclassifyIncludeOverrides(false); }}
              onToggleOverrides={setReclassifyIncludeOverrides}
              onConfirm={handleReclassify}
            />

            {/* Clear history */}
            <div className="mt-4 p-4 rounded-lg bg-surface border border-stroke space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content">{t("settings.behavior.clear_history_label")}</p>
                  <p className="text-xs text-content-3 mt-0.5">{t("settings.behavior.clear_history_desc")}</p>
                </div>
                <button
                  onClick={() => { setClearHistoryDialog(true); setClearHistoryResult(null); }}
                  disabled={clearHistoryRunning}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke text-content-2 hover:text-content hover:border-accent transition-colors disabled:opacity-50 shrink-0"
                >
                  {t("settings.behavior.clear_history_button")}
                </button>
              </div>
              {clearHistoryResult !== null && (
                <p className="text-xs text-accent">{t("settings.behavior.clear_history_result", { count: clearHistoryResult })}</p>
              )}
              {clearHistoryDialog && (
                <div className="p-3 rounded-lg bg-surface-raised border border-stroke space-y-3">
                  <p className="text-sm text-content">{t("settings.behavior.clear_history_confirm")}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClearHistory}
                      disabled={clearHistoryRunning}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {clearHistoryRunning ? t("settings.behavior.clear_history_running") : t("common.delete")}
                    </button>
                    <button
                      onClick={() => setClearHistoryDialog(false)}
                      disabled={clearHistoryRunning}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke text-content-2 hover:text-content transition-colors disabled:opacity-50"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-stroke space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke text-content-2 hover:text-content hover:border-accent transition-colors disabled:opacity-50"
                >
                  {t("about.export_button")}
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke text-content-2 hover:text-content hover:border-accent transition-colors disabled:opacity-50"
                >
                  {t("about.import_button")}
                </button>
                {exportDone && <span className="text-xs text-accent">{t("about.export_success")}</span>}
                {importTotal !== null && <span className="text-xs text-accent">{t("about.import_result", { total: importTotal })}</span>}
              </div>
              <p className="text-[11px] text-content-3">{t("about.config_desc")}</p>
            </div>
          </Section>
        )}

        {/* ── About ──────────────────────────────────────────────────── */}
        {activeTab === "about" && <AboutTab />}
      </div>
    </div>
  );
}

// ── Static dependency list ───────────────────────────────────────────────────

const FRONTEND_DEPS: { name: string; version: string; licenseKey: string; url: string }[] = [
  { name: "React",          version: "19",   licenseKey: "mit",        url: "https://react.dev" },
  { name: "TypeScript",     version: "5.8",  licenseKey: "apache2",    url: "https://www.typescriptlang.org" },
  { name: "Tauri JS API",   version: "2",    licenseKey: "mit_apache", url: "https://tauri.app" },
  { name: "Tailwind CSS",   version: "4",    licenseKey: "mit",        url: "https://tailwindcss.com" },
  { name: "Vite",           version: "7",    licenseKey: "mit",        url: "https://vitejs.dev" },
  { name: "i18next",        version: "25",   licenseKey: "mit",        url: "https://www.i18next.com" },
  { name: "react-i18next",  version: "16",   licenseKey: "mit",        url: "https://react.i18next.com" },
  { name: "highlight.js",   version: "11",   licenseKey: "bsd3",       url: "https://highlightjs.org" },
];

const BACKEND_DEPS: { name: string; version: string; licenseKey: string; url: string }[] = [
  { name: "Rust",    version: "1.77+",  licenseKey: "mit_apache", url: "https://www.rust-lang.org" },
  { name: "Tauri",   version: "2",      licenseKey: "mit_apache", url: "https://tauri.app" },
  { name: "SQLite",  version: "3",      licenseKey: "public_domain", url: "https://sqlite.org" },
  { name: "sqlx",    version: "0.8",    licenseKey: "mit_apache", url: "https://github.com/launchbadge/sqlx" },
  { name: "arboard", version: "3",      licenseKey: "mit_apache", url: "https://github.com/1Password/arboard" },
  { name: "tokio",   version: "1",      licenseKey: "mit",        url: "https://tokio.rs" },
  { name: "regex",   version: "1",      licenseKey: "mit_apache", url: "https://github.com/rust-lang/regex" },
  { name: "serde",   version: "1",      licenseKey: "mit_apache", url: "https://serde.rs" },
];

function AboutTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion);
    invoke<string>("get_data_dir").then((dir) => {
      setDataDir(dir);
    });
  }, []);

  async function copyPath() {
    const dbPath = dataDir + "/clipboard.db";
    try {
      await invoke("copy_to_clipboard", { content: dbPath });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[AboutTab] copy path failed:", e);
    }
  }

  return (
    <div className="space-y-6">
      {/* App card */}
      <div className="p-4 rounded-lg bg-surface border border-stroke space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-content">clipboard-tool</p>
            <p className="text-xs text-content-2 mt-0.5">{t("about.description")}</p>
          </div>
          <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
            {version ? `v${version}` : "…"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <MetaRow label={t("about.license_label")} value="MIT" />
          <MetaRow label={t("about.author_label")} value="niconi21" />
          <MetaRow
            label={t("about.source_label")}
            value="GitHub"
            href="https://github.com/niconi21/clipboard-tool"
          />
        </div>
      </div>

      {/* Database info */}
      {dataDir && (
        <div className="p-4 rounded-lg bg-surface border border-stroke space-y-2">
          <p className="text-xs font-semibold text-content">{t("about.database_title")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] text-content-2 font-mono truncate" title={dataDir + "/clipboard.db"}>
              {dataDir}/clipboard.db
            </code>
            <button
              onClick={copyPath}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-content-2 hover:text-content hover:bg-surface-raised transition-colors border border-stroke"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                  </svg>
                  {t("detail.copied")}
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {t("about.copy_path")}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Frontend deps */}
      <DepSection title={t("about.frontend_title")} deps={FRONTEND_DEPS} />

      {/* Backend deps */}
      <DepSection title={t("about.backend_title")} deps={BACKEND_DEPS} />
    </div>
  );
}

function MetaRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-content-3 shrink-0">{label}:</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline truncate"
        >
          {value}
        </a>
      ) : (
        <span className="text-content-2 truncate">{value}</span>
      )}
    </div>
  );
}

function DepSection({
  title,
  deps,
}: {
  title: string;
  deps: { name: string; version: string; licenseKey: string; url: string }[];
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-xs font-semibold text-content-2 uppercase tracking-wider mb-2">{title}</p>
      <div className="rounded-lg border border-stroke overflow-hidden">
        {deps.map((dep, i) => (
          <div
            key={dep.name}
            className={`flex items-center gap-3 px-3 py-2 text-xs ${i < deps.length - 1 ? "border-b border-stroke" : ""}`}
          >
            <a
              href={dep.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 font-medium text-content hover:text-accent transition-colors"
            >
              {dep.name}
            </a>
            <span className="text-content-3 font-mono">v{dep.version}</span>
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-content-2 border border-stroke">
              {t(`about.${dep.licenseKey}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReclassifyBlock({
  dialog, running, result, includeOverrides,
  onOpenDialog, onCloseDialog, onToggleOverrides, onConfirm,
}: {
  dialog: boolean; running: boolean; result: number | null; includeOverrides: boolean;
  onOpenDialog: () => void; onCloseDialog: () => void;
  onToggleOverrides: (v: boolean) => void; onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 pt-4 border-t border-stroke space-y-2">
      {!dialog ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenDialog}
              disabled={running}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke hover:border-accent hover:text-accent transition-colors text-content-2 disabled:opacity-50"
            >
              {running ? t("settings.reclassify.running") : t("settings.reclassify.button")}
            </button>
            {result !== null && (
              <span className="text-xs text-accent">{t("settings.reclassify.result", { count: result })}</span>
            )}
          </div>
          <p className="text-[11px] text-content-3">{t("settings.reclassify.desc")}</p>
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-surface border border-stroke space-y-3">
          <p className="text-xs font-medium text-content">{t("settings.reclassify.confirm_title")}</p>
          <label className="flex items-center gap-2 text-xs text-content-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeOverrides}
              onChange={(e) => onToggleOverrides(e.target.checked)}
              className="rounded border-stroke accent-accent"
            />
            {t("settings.reclassify.include_overrides")}
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onConfirm}
              disabled={running}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {running ? t("settings.reclassify.running") : t("settings.reclassify.button")}
            </button>
            <button
              onClick={onCloseDialog}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stroke text-content-2 hover:text-content transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        {description && <InfoTooltip text={description} />}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<"right" | "left">("right");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos(rect.right + 256 > window.innerWidth ? "left" : "right");
  }, [visible]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="flex items-center justify-center text-content-3 hover:text-content-2 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
        </svg>
      </button>
      {visible && (
        <div
          className={`absolute z-50 w-64 p-3 text-xs text-content-2 bg-surface-raised border border-stroke rounded-lg shadow-lg leading-relaxed top-1/2 -translate-y-1/2 ${
            pos === "right" ? "left-full ml-2" : "right-full mr-2"
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm text-content">{label}</p>
        <p className="text-xs text-content-2 mt-1 leading-relaxed">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Code({ children }: { children?: React.ReactNode }) {
  return <code className="bg-surface-raised px-1 py-0.5 rounded text-content-2">{children}</code>;
}
