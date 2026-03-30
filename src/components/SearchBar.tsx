import { useTranslation } from "react-i18next";
import { FilterPanel } from "./FilterPanel";
import type { ClipboardFilters } from "../hooks/useClipboard";
import type { ContentTypeStyle } from "../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  filters: ClipboardFilters;
  onFiltersChange: (f: ClipboardFilters) => void;
  contentTypes: ContentTypeStyle[];
}

export function SearchBar({ value, onChange, filters, onFiltersChange, contentTypes }: Props) {
  const { t } = useTranslation();
  return (
    <div data-tour="search-bar" className="flex items-center gap-2 px-3 py-2 border-b border-stroke">
      <svg
        className="w-4 h-4 text-content-2 shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>

      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("search.placeholder")}
        className="flex-1 bg-transparent text-sm text-content placeholder-content-3 outline-none min-w-0"
      />

      {value && (
        <button
          onClick={() => onChange("")}
          className="text-content-2 hover:text-content transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <FilterPanel
        filters={filters}
        onChange={onFiltersChange}
        contentTypes={contentTypes}
      />
    </div>
  );
}
