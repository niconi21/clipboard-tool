import { useCallback, useRef, useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation, Trans } from "react-i18next";
import type { Category, Collection, CollectionRule, ContentRule, ContentTypeStyle, ContextRule, Language, Setting, Subcollection, Theme } from "../types";
import { CollectionsManager } from "./CollectionsManager";
import { ContentTypesManager } from "./ContentTypesManager";
import { CategoriesManager } from "./CategoriesManager";

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
}: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("appearance");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  const maxImageBytes = getSetting("max_image_size_bytes", "10485760");
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
              <div className="grid grid-cols-1 gap-2">
                {themes.map((theme) => (
                  <button
                    key={theme.slug}
                    onClick={() => onThemeChange(theme.slug)}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                      activeThemeSlug === theme.slug
                        ? "border-accent/60 bg-accent/10"
                        : "border-stroke hover:border-stroke-strong bg-surface"
                    }`}
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
                ))}
              </div>
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
  useEffect(() => { getVersion().then(setVersion); }, []);

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
