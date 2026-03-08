import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { TypeaheadSelect } from "./TypeaheadSelect";
import { EMPTY_FILTERS, type ClipboardFilters } from "../hooks/useClipboard";
import type { ContentTypeStyle } from "../types";

interface Props {
  filters: ClipboardFilters;
  onChange: (filters: ClipboardFilters) => void;
  contentTypes: ContentTypeStyle[];
}

export function FilterPanel({ filters, onChange, contentTypes }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [windowTitles, setWindowTitles] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount = [filters.contentType, filters.sourceApp, filters.category, filters.windowTitle]
    .filter(Boolean).length;

  // F-9: refresh filter options when panel opens
  useEffect(() => {
    if (!open) return;
    invoke<string[]>("get_apps").then(setApps).catch(() => {});
    invoke<string[]>("get_categories").then(setCategories).catch(() => {});
    invoke<string[]>("get_window_titles").then(setWindowTitles).catch(() => {});
  }, [open]);

  // Close panel on outside click (but not on clicks inside TypeaheadSelect dropdowns)
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function set(key: keyof ClipboardFilters, value: string) {
    onChange({ ...filters, [key]: value });
  }

  function clearAll() {
    onChange(EMPTY_FILTERS);
  }

  const typeOptions = contentTypes.map((ct) => ({ value: ct.name, label: ct.label }));
  const appOptions = apps.map((a) => ({ value: a, label: a }));
  const catOptions = categories.map((c) => ({ value: c, label: c }));
  const windowOptions = windowTitles.map((t) => ({ value: t, label: t }));

  return (
    <div className="relative shrink-0" ref={panelRef}>
      {/* Trigger */}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
          activeCount > 0
            ? "bg-accent/15 text-accent-text hover:bg-accent/25 border border-accent/30"
            : "bg-surface-raised text-content-2 hover:bg-surface-active hover:text-content border border-stroke"
        }`}
      >
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2 4h12M4 8h8M6 12h4" />
        </svg>
        <span>{t("filters.button")}</span>
        {activeCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-semibold flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-surface border border-stroke rounded-lg shadow-dropdown p-3 space-y-2.5">
          <p className="text-[10px] text-content-3 uppercase tracking-wider mb-1">
            {t("filters.heading")}
          </p>

          <div className="space-y-2">
            <FilterRow label={t("filters.type")}>
              <TypeaheadSelect
                value={filters.contentType}
                onChange={(v) => set("contentType", v)}
                options={typeOptions}
                placeholder={t("filters.all_types")}
              />
            </FilterRow>

            <FilterRow label={t("filters.app")}>
              <TypeaheadSelect
                value={filters.sourceApp}
                onChange={(v) => set("sourceApp", v)}
                options={appOptions}
                placeholder={t("filters.all_apps")}
              />
            </FilterRow>

            <FilterRow label={t("filters.category")}>
              <TypeaheadSelect
                value={filters.category}
                onChange={(v) => set("category", v)}
                options={catOptions}
                placeholder={t("filters.all_categories")}
              />
            </FilterRow>

            <FilterRow label={t("filters.window")}>
              <TypeaheadSelect
                value={filters.windowTitle}
                onChange={(v) => set("windowTitle", v)}
                options={windowOptions}
                placeholder={t("filters.all_windows")}
              />
            </FilterRow>
          </div>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="w-full mt-1 pt-2 text-[11px] text-content-2 hover:text-danger border-t border-stroke transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" d="M1 1l10 10M11 1L1 11" />
              </svg>
              {t("filters.clear_all")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-content-3 uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}
