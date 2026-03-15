import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";

import "./App.css";
import { SearchBar } from "./components/SearchBar";
import { EntryList } from "./components/EntryList";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SubcollectionPanel } from "./components/SubcollectionPanel";
import { WindowControls } from "./components/WindowControls";
import { useClipboard, EMPTY_FILTERS } from "./hooks/useClipboard";
import type { ClipboardFilters } from "./hooks/useClipboard";
import { useContentTypes } from "./hooks/useContentTypes";
import { useTheme } from "./hooks/useTheme";
import { useCollections } from "./hooks/useCollections";
import { currentOS } from "./hooks/useOS";
import type { BootstrapData, Category, ClipboardEntry, CollectionRule, ContentRule, ContextRule, Setting, Theme } from "./types";
import type { ThemeColors } from "./components/SettingsPanel";

const PANEL_MIN = 180;
const PANEL_DEFAULT = 320;

function App() {
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { getVersion().then(setAppVersion); }, []);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ClipboardFilters>(EMPTY_FILTERS);
  const [selectedEntry, setSelectedEntry] = useState<ClipboardEntry | null>(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "favorites" | number>("all");
  const [activeSubcollection, setActiveSubcollection] = useState<number | null>(null);
  const [counts, setCounts] = useState<{ all: number; favorites: number }>({ all: 0, favorites: 0 });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverCollectionId, setDragOverCollectionId] = useState<number | null>(null);
  const { t } = useTranslation();

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const ready = boot !== null;

  // ── Settings state — managed in App ─────────────────────────────────────────
  const [localSettings, setLocalSettings] = useState<Setting[]>([]);
  const settingsLoadedRef = useRef(false);

  // Derive stable values from bootstrap data
  const allSettings = boot?.settings ?? [];
  const [themes, setThemes] = useState<Theme[]>([]);
  const languages   = boot?.languages ?? [];

  function getSetting(key: string, fallback: string): string {
    return allSettings.find((s) => s.key === key)?.value ?? fallback;
  }
  const activeThemeSlug =
    localSettings.find((s) => s.key === "active_theme")?.value ??
    getSetting("active_theme", "midnight");
  const pageSize        = parseInt(getSetting("page_size", "50"), 10) || 50;

  // Memoize initial data objects so hook effects only fire once per bootstrap
  const initialContentTypes = useMemo(() => boot?.content_types, [boot]);
  const initialCollections  = useMemo(
    () => boot ? {
      collections: boot.collections,
      counts: Object.fromEntries(boot.collection_counts.map(([id, n]) => [id, n])),
      subcollections: boot.subcollections,
    } : undefined,
    [boot],
  );

  const runBootstrap = useCallback(() => {
    invoke<BootstrapData>("bootstrap")
      .then((data) => {
        const lang = data.settings.find((s) => s.key === "language")?.value;
        if (lang) i18n.changeLanguage(lang);

        const [all, favorites] = data.entry_counts;
        setCounts({ all, favorites });

        const w = parseInt(data.settings.find((s) => s.key === "detail_panel_width")?.value ?? "", 10);
        if (!isNaN(w)) { setPanelWidth(w); panelWidthRef.current = w; }

        setThemes(data.themes);
        setLocalSettings(data.settings);
        settingsLoadedRef.current = false; // force reload of settings-panel data
        setBoot(data);
      })
      .catch(console.error);
  }, []);

  useEffect(() => { runBootstrap(); }, [runBootstrap]);

  // ── Hooks — only fetch if not seeded from bootstrap ─────────────────────────
  const { contentTypes, colorFor, labelFor, refresh: refreshContentTypes } = useContentTypes(initialContentTypes);
  const { activeTheme, setTheme } = useTheme(themes, activeThemeSlug);
  const {
    collections, userCollections, counts: collectionCounts, subcollections,
    create: createCollection, update: updateCollection, remove: removeCollection, refreshCounts: refreshCollectionCounts,
    subcollectionsFor, createSubcollection, renameSubcollection, removeSubcollection,
  } = useCollections(initialCollections);
  // Derive the active collection id (for favorites, use the builtin collection)
  const favoritesId = collections.find((c) => c.is_builtin)?.id ?? null;
  const activeCollectionId = activeTab === "favorites" ? favoritesId : (typeof activeTab === "number" ? activeTab : null);
  const [subCountKey, setSubCountKey] = useState(0);
  const bumpSubCounts = useCallback(() => setSubCountKey((k) => k + 1), []);

  const { entries, loading, loadingMore, hasMore, loadMore, removeEntry, toggleFavorite, patchEntryCollections, patchEntryAlias, patchEntryContentType } = useClipboard(
    search, filters, pageSize,
    activeTab === "favorites",
    activeCollectionId,
    activeSubcollection,
    ready, // don't fetch until bootstrap resolved
  );

  // ── Panel resize ─────────────────────────────────────────────────────────────
  const containerRef    = useRef<HTMLDivElement>(null);
  const panelWidthRef   = useRef(PANEL_DEFAULT);
  const saveTimeout     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const savePanelWidth = useCallback((width: number) => {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      invoke("update_setting", { key: "detail_panel_width", value: String(width) }).catch(console.error);
    }, 500);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === 0) return;
      const ratio = entry.contentRect.width < 700 ? 0.5 : 0.75;
      const maxWidth = Math.floor(entry.contentRect.width * ratio);
      if (panelWidthRef.current > maxWidth) {
        const clamped = Math.max(PANEL_MIN, maxWidth);
        setPanelWidth(clamped);
        panelWidthRef.current = clamped;
        savePanelWidth(clamped);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [savePanelWidth]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidthRef.current;

      function onMouseMove(ev: MouseEvent) {
        const container = containerRef.current;
        if (!container) return;
        const ratio = container.offsetWidth < 700 ? 0.5 : 0.75;
        const maxWidth = Math.floor(container.offsetWidth * ratio);
        const delta = startX - ev.clientX;
        const newWidth = Math.max(PANEL_MIN, Math.min(maxWidth, startWidth + delta));
        setPanelWidth(newWidth);
        panelWidthRef.current = newWidth;
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        savePanelWidth(panelWidthRef.current);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [savePanelWidth]
  );

  // ── Entry counts ─────────────────────────────────────────────────────────────
  const loadCounts = useCallback(() => {
    invoke<[number, number]>("get_entry_counts")
      .then(([all, favorites]) => setCounts({ all, favorites }))
      .catch(console.error);
  }, []);

  // Refresh counts on new clipboard entry
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen("clipboard-new-entry", () => { if (!cancelled) { loadCounts(); refreshCollectionCounts(); bumpSubCounts(); } })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch(console.error);
    return () => { cancelled = true; unlisten?.(); };
  }, [loadCounts, refreshCollectionCounts, bumpSubCounts]);

  // ── Settings panel — lazy load, cached after first open ──────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [contextRules, setContextRules] = useState<ContextRule[]>([]);
  const [contentTypeRules, setContentTypeRules] = useState<ContentRule[]>([]);
  const [collectionRules, setCollectionRules] = useState<CollectionRule[]>([]);

  useEffect(() => {
    if (!settingsOpen || settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    invoke<Category[]>("get_all_categories").then(setCategories).catch(console.error);
    invoke<ContextRule[]>("get_all_context_rules").then(setContextRules).catch(console.error);
    invoke<ContentRule[]>("get_all_content_type_rules").then(setContentTypeRules).catch(console.error);
    invoke<CollectionRule[]>("get_all_collection_rules").then(setCollectionRules).catch(console.error);
    // Merge bootstrap settings with any live updates
    setLocalSettings(allSettings);
  }, [settingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleTabChange(tab: "all" | "favorites" | number) {
    setActiveTab(tab);
    setActiveSubcollection(null);
    setSelectedEntry(null);
  }

  function handleSelect(entry: ClipboardEntry) {
    setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry));
  }

  function handleDelete(id: number) {
    if (selectedEntry?.id === id) setSelectedEntry(null);
    // Context-aware: subcollection → unlink from sub, collection → unlink from col, all/favorites → permanent delete
    const colId = (typeof activeTab === "number") ? activeTab : (activeTab === "favorites" ? favoritesId : null);
    const subId = activeSubcollection;
    removeEntry(id, colId, subId)
      .then(() => { loadCounts(); refreshCollectionCounts(); bumpSubCounts(); })
      .catch((e: unknown) => {
        let msg: string;
        if (typeof e === "string" && e.startsWith("ENTRY_IN_COLLECTION:")) {
          const names = e.slice("ENTRY_IN_COLLECTION:".length);
          msg = t("app.delete_error_in_collection", { names });
        } else if (typeof e === "string" && e.startsWith("ENTRY_IN_SUBCOLLECTION:")) {
          const name = e.slice("ENTRY_IN_SUBCOLLECTION:".length);
          msg = t("app.delete_error_in_subcollection", { name });
        } else {
          msg = typeof e === "string" ? e : t("app.delete_error_fallback");
        }
        setDeleteError(msg);
        setTimeout(() => setDeleteError(null), 5000);
      });
  }

  function handleToggleFavorite(id: number) {
    toggleFavorite(id);
    loadCounts();
    refreshCollectionCounts();
    bumpSubCounts();
  }

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    if (entry.content_type === "image") {
      invoke("copy_image_to_clipboard", { path: entry.content }).catch(console.error);
    } else {
      invoke("copy_to_clipboard", { content: entry.content }).catch(console.error);
    }
  }, []);

  async function handleDropOnCollection(entryId: number, collectionId: number) {
    const entry = entries.find((e) => e.id === entryId);
    const currentIds = entry
      ? entry.collection_ids.split(",").map(Number).filter(Boolean)
      : [];
    if (currentIds.includes(collectionId)) return;
    const newIds = [...currentIds, collectionId];
    await invoke("set_entry_collections", { entryId, collectionIds: newIds }).catch(console.error);
    patchEntryCollections(entryId, newIds);
    refreshCollectionCounts();
    bumpSubCounts();
  }

  async function handleDropOnSubcollection(entryId: number, subcollectionId: number) {
    if (activeCollectionId === null) return;
    await invoke("move_entry_subcollection", {
      entryId,
      collectionId: activeCollectionId,
      subcollectionId,
    }).catch(console.error);
    bumpSubCounts();
  }

  function handleSettingChange(key: string, value: string) {
    invoke("update_setting", { key, value }).catch(console.error);
    // Update local settings cache used by SettingsPanel
    setLocalSettings((prev) =>
      prev.some((s) => s.key === key)
        ? prev.map((s) => (s.key === key ? { ...s, value } : s))
        : [...prev, { key, value, updated_at: "" }]
    );
    if (key === "language") i18n.changeLanguage(value);
  }

  async function handleToggleContextRule(id: number, enabled: boolean) {
    await invoke("set_context_rule_enabled", { id, enabled }).catch(console.error);
    setContextRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r));
  }

  async function handleToggleContentTypeRule(id: number, enabled: boolean) {
    await invoke("set_content_type_rule_enabled", { id, enabled }).catch(console.error);
    setContentTypeRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r));
  }

  function handleContentTypeColorChange(name: string, color: string) {
    invoke("update_content_type_color", { name, color })
      .then(refreshContentTypes)
      .catch(console.error);
  }

  async function handleCreateContentType(name: string, label: string, color: string) {
    await invoke("create_content_type", { name, label, color });
    await refreshContentTypes();
    setContentTypeRules(await invoke("get_all_content_type_rules"));
  }

  async function handleDeleteContentType(name: string) {
    await invoke("delete_content_type", { name });
    await refreshContentTypes();
    setContentTypeRules(await invoke("get_all_content_type_rules"));
  }

  async function handleCreateContentTypeRule(contentType: string, pattern: string, minHits: number, priority: number) {
    await invoke("create_content_type_rule", { contentType, pattern, minHits, priority });
    setContentTypeRules(await invoke("get_all_content_type_rules"));
  }

  async function handleDeleteContentTypeRule(id: number) {
    await invoke("delete_content_type_rule", { id });
    setContentTypeRules(await invoke("get_all_content_type_rules"));
  }

  async function handleCreateCategory(name: string, color: string) {
    await invoke("create_category", { name, color });
    setCategories(await invoke("get_all_categories"));
  }

  async function handleUpdateCategory(id: number, name: string, color: string) {
    await invoke("update_category", { id, name, color });
    setCategories(await invoke("get_all_categories"));
  }

  async function handleDeleteCategory(id: number) {
    await invoke("delete_category", { id });
    setCategories(await invoke("get_all_categories"));
    setContextRules(await invoke("get_all_context_rules"));
  }

  async function handleCreateContextRule(categoryId: number, sourceAppPattern: string | null, windowTitlePattern: string | null, priority: number) {
    await invoke("create_context_rule", { categoryId, sourceAppPattern, windowTitlePattern, priority });
    setContextRules(await invoke("get_all_context_rules"));
  }

  async function handleDeleteContextRule(id: number) {
    await invoke("delete_context_rule", { id });
    setContextRules(await invoke("get_all_context_rules"));
  }

  async function handleCreateCollectionRule(collectionId: number, contentType: string | null, sourceApp: string | null, windowTitle: string | null, contentPattern: string | null, priority: number) {
    await invoke("create_collection_rule", { collectionId, contentType, sourceApp, windowTitle, contentPattern, priority });
    setCollectionRules(await invoke("get_all_collection_rules"));
  }

  async function handleDeleteCollectionRule(id: number) {
    await invoke("delete_collection_rule", { id });
    setCollectionRules(await invoke("get_all_collection_rules"));
  }

  async function handleToggleCollectionRule(id: number, enabled: boolean) {
    await invoke("toggle_collection_rule", { id, enabled });
    setCollectionRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r));
  }

  // ── Config import ──────────────────────────────────────────────────────────
  const handleConfigImported = useCallback(() => {
    runBootstrap();
  }, [runBootstrap]);

  // ── Reclassify ─────────────────────────────────────────────────────────────
  async function handleReclassify(includeOverrides: boolean): Promise<number> {
    const count = await invoke<number>("reclassify_entries", { includeOverrides });
    loadCounts();
    refreshCollectionCounts();
    return count;
  }

  // ── Theme CRUD ──────────────────────────────────────────────────────────────
  function colorsToCamel(c: ThemeColors) {
    return {
      base: c.base, surface: c.surface, surfaceRaised: c.surface_raised,
      surfaceActive: c.surface_active, stroke: c.stroke, strokeStrong: c.stroke_strong,
      content: c.content, content2: c.content_2, content3: c.content_3,
      accent: c.accent, accentText: c.accent_text,
    };
  }

  async function handleCreateTheme(name: string, colors: ThemeColors) {
    const slug = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const theme = await invoke<Theme>("create_theme", { slug, name, ...colorsToCamel(colors) });
    setThemes((prev) => [...prev, theme]);
  }

  async function handleUpdateTheme(slug: string, name: string, colors: ThemeColors) {
    await invoke("update_theme", { slug, name, ...colorsToCamel(colors) });
    setThemes((prev) => prev.map((t) =>
      t.slug === slug ? { ...t, name, ...colors } : t
    ));
  }

  async function handleDeleteTheme(slug: string) {
    await invoke("delete_theme", { slug });
    setThemes((prev) => prev.filter((t) => t.slug !== slug));
    // If the deleted theme was active, switch to first available
    if (activeThemeSlug === slug && themes.length > 1) {
      const fallback = themes.find((t) => t.slug !== slug);
      if (fallback) {
        setTheme(fallback.slug);
        handleSettingChange("active_theme", fallback.slug);
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-screen text-white select-none overflow-hidden rounded-xl border border-stroke"
      style={{ backgroundColor: activeTheme?.base ?? "#0a0a0a" }}
    >
      {/* Drag region / header */}
      <div
        className="flex items-center gap-2 shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) {
            getCurrentWindow().startDragging().catch(console.error);
          }
        }}
        onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(console.error)}
      >
        {currentOS === "macos" && (
          <div className="pl-3 pt-3 pb-2 pointer-events-auto shrink-0">
            <WindowControls />
          </div>
        )}

        <div className="flex items-center gap-2 flex-1 px-3 pt-3 pb-2 pointer-events-none min-w-0">
          {currentOS !== "macos" && (
            <svg className="w-3 h-3 text-content-3 shrink-0" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="2" cy="3" r="1" /><circle cx="6" cy="3" r="1" /><circle cx="10" cy="3" r="1" />
              <circle cx="2" cy="7" r="1" /><circle cx="6" cy="7" r="1" /><circle cx="10" cy="7" r="1" />
            </svg>
          )}
          <span className="text-xs font-medium text-content-2 tracking-wide">CLIPBOARD</span>
          {import.meta.env.DEV && (
            <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              development environment
            </span>
          )}
          <span className="text-xs text-content-3 ml-auto">
            {t(entries.length === 1 ? "collections_mgr.entries_count_one" : "collections_mgr.entries_count_other", { count: entries.length })}
          </span>
          <button
            className="pointer-events-auto p-1 rounded text-content-3 hover:text-content hover:bg-surface-raised transition-colors"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setSettingsOpen((v) => !v)}
            title={t("settings.title")}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {currentOS !== "macos" && (
          <div className="pointer-events-auto shrink-0">
            <WindowControls />
          </div>
        )}
      </div>

      {settingsOpen ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <SettingsPanel
            settings={localSettings}
            contentTypes={contentTypes}
            contentTypeRules={contentTypeRules}
            themes={themes}
            activeThemeSlug={activeThemeSlug}
            collections={collections}
            collectionCounts={collectionCounts}
            categories={categories}
            contextRules={contextRules}
            languages={languages}
            onClose={() => setSettingsOpen(false)}
            onSettingChange={handleSettingChange}
            onContentTypeColorChange={handleContentTypeColorChange}
            onThemeChange={(slug) => {
              setTheme(slug);
              setLocalSettings((prev) =>
                prev.some((s) => s.key === "active_theme")
                  ? prev.map((s) => s.key === "active_theme" ? { ...s, value: slug } : s)
                  : [...prev, { key: "active_theme", value: slug, updated_at: "" }]
              );
            }}
            onCreateCollection={async (name, color) => { await createCollection(name, color); }}
            onUpdateCollection={async (id, name, color) => { await updateCollection(id, name, color); }}
            onDeleteCollection={async (id) => { await removeCollection(id); if (activeTab === id) handleTabChange("all"); refreshCollectionCounts(); }}
            onCreateContentType={handleCreateContentType}
            onDeleteContentType={handleDeleteContentType}
            onCreateContentTypeRule={handleCreateContentTypeRule}
            onDeleteContentTypeRule={handleDeleteContentTypeRule}
            onCreateCategory={handleCreateCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            onCreateContextRule={handleCreateContextRule}
            onDeleteContextRule={handleDeleteContextRule}
            onToggleContextRule={handleToggleContextRule}
            onToggleContentTypeRule={handleToggleContentTypeRule}
            collectionRules={collectionRules}
            onCreateCollectionRule={handleCreateCollectionRule}
            onDeleteCollectionRule={handleDeleteCollectionRule}
            onToggleCollectionRule={handleToggleCollectionRule}
            subcollections={subcollections}
            onCreateSubcollection={createSubcollection}
            onRenameSubcollection={renameSubcollection}
            onDeleteSubcollection={removeSubcollection}
            onCreateTheme={handleCreateTheme}
            onUpdateTheme={handleUpdateTheme}
            onDeleteTheme={handleDeleteTheme}
            onReclassify={handleReclassify}
            onConfigImported={handleConfigImported}
          />
        </div>
      ) : (
      <>
      {deleteError && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-xs text-danger flex items-center justify-between gap-2">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="shrink-0 hover:opacity-70 transition-opacity">✕</button>
        </div>
      )}
      <SearchBar
        value={search}
        onChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        contentTypes={contentTypes}
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1 shrink-0 border-b border-stroke overflow-x-auto">
        <TabButton active={activeTab === "all"} onClick={() => handleTabChange("all")}>
          {t("tabs.all")}
          <span className="text-[10px] opacity-60">{counts.all}</span>
        </TabButton>
        <TabButton
          active={activeTab === "favorites"}
          onClick={() => handleTabChange("favorites")}
          dropReady={isDragging && !!favoritesId}
          dragOver={isDragging && dragOverCollectionId === favoritesId}
          onDragOver={favoritesId ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverCollectionId(favoritesId); } : undefined}
          onDragLeave={favoritesId ? () => setDragOverCollectionId(null) : undefined}
          onDrop={favoritesId ? (e) => {
            e.preventDefault();
            setDragOverCollectionId(null);
            const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
            if (!isNaN(id)) handleDropOnCollection(id, favoritesId);
          } : undefined}
        >
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          {t("tabs.favorites")}
          <span className="text-[10px] opacity-60">{counts.favorites}</span>
        </TabButton>
        {userCollections.map((col) => (
          <TabButton
            key={col.id}
            active={activeTab === col.id}
            onClick={() => handleTabChange(col.id)}
            color={col.color}
            dropReady={isDragging}
            dragOver={isDragging && dragOverCollectionId === col.id}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverCollectionId(col.id); }}
            onDragLeave={() => setDragOverCollectionId(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCollectionId(null);
              const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
              if (!isNaN(id)) handleDropOnCollection(id, col.id);
            }}
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
            {col.name}
            <span className="text-[10px] opacity-60">{collectionCounts[col.id] ?? 0}</span>
          </TabButton>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden" ref={containerRef}>
        {activeCollectionId !== null && (
          <SubcollectionPanel
            collectionId={activeCollectionId}
            subcollections={subcollectionsFor(activeCollectionId)}
            activeSubcollection={activeSubcollection}
            refreshKey={subCountKey}
            onSelect={setActiveSubcollection}
            onCreate={createSubcollection}
            onRename={renameSubcollection}
            onDelete={removeSubcollection}
            onDropEntry={handleDropOnSubcollection}
          />
        )}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <EntryList
            entries={entries}
            collections={collections}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            search={search}
            selectedId={selectedEntry?.id ?? null}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onToggleFavorite={handleToggleFavorite}
            onCopy={handleCopy}
            colorFor={colorFor}
            labelFor={labelFor}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={() => { setIsDragging(false); setDragOverCollectionId(null); }}
          />
        </div>

        {selectedEntry && (
          <>
            <div
              className="w-1 shrink-0 cursor-col-resize bg-stroke hover:bg-accent/40 active:bg-accent/60 transition-colors"
              onMouseDown={handleResizeStart}
            />
            <div style={{ width: panelWidth }} className="shrink-0 overflow-hidden">
              <DetailPanel
                entry={selectedEntry}
                collections={collections}
                subcollections={subcollections}
                contentTypes={contentTypes}
                colorFor={colorFor}
                onClose={() => setSelectedEntry(null)}
                onCollectionChanged={(entryId, collectionIds) => {
              refreshCollectionCounts();
              bumpSubCounts();
              loadCounts();
              patchEntryCollections(entryId, collectionIds);
            }}
                onAliasChanged={(entryId, alias) => patchEntryAlias(entryId, alias)}
                onContentTypeChanged={(entryId, contentType) => {
              patchEntryContentType(entryId, contentType);
              setSelectedEntry((prev) => prev && prev.id === entryId ? { ...prev, content_type: contentType } : prev);
            }}
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-stroke shrink-0">
        <span className="text-[11px] text-content-3">{t("app.footer_hint")}</span>
        <span className="text-[11px] text-content-3">clipboard-tool {appVersion ? `v${appVersion}` : "…"}</span>
      </div>
      </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  color,
  children,
  dropReady,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
  dropReady?: boolean;
  dragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  // Priority: dragOver > active > dropReady > default
  let style: React.CSSProperties | undefined;
  if (dragOver && color) {
    style = { backgroundColor: color + "40", color, outline: `1px solid ${color}` };
  } else if (dragOver && !color) {
    style = undefined; // handled via className
  } else if (active && color) {
    style = { backgroundColor: color + "26", color };
  } else if (dropReady && color) {
    style = { outline: `1px dashed ${color}80`, color };
  }

  return (
    <button
      onClick={onClick}
      style={style}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
        dragOver && !color
          ? "bg-accent/30 outline outline-1 outline-accent/60 text-accent"
          : dragOver && color
          ? ""
          : dropReady && !color
          ? "outline outline-1 outline-dashed outline-accent/40 text-content-2"
          : active && !color
          ? "bg-accent/15 text-accent"
          : !active
          ? "text-content-3 hover:text-content-2 hover:bg-surface-raised"
          : ""
      }`}
    >
      {children}
    </button>
  );
}

export default App;
