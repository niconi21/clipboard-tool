import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
}

export function TypeaheadSelect({ value, onChange, options, placeholder }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label;
  const isActive = !!value;

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Filter options — "All" option always visible at top regardless of query
  const allOption: SelectOption = { value: "", label: placeholder };
  const filtered = options.filter(
    (o) => !query || o.label.toLowerCase().includes(query.toLowerCase())
  );

  function select(val: string) {
    onChange(val);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs transition-colors text-left ${
          isActive
            ? "bg-accent/15 border border-accent/40 text-accent-text"
            : "bg-surface-raised border border-stroke text-content-2 hover:border-stroke-strong hover:text-content"
        }`}
      >
        <span className="flex-1 truncate">
          {selectedLabel ?? placeholder}
        </span>
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-[60] w-full min-w-[160px] bg-surface border border-stroke rounded-lg shadow-dropdown overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-stroke">
            <svg className="w-3 h-3 text-neutral-500 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" d="M14 14l-3-3m0 0A5 5 0 1 0 4 4a5 5 0 0 0 7 7z" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={t("typeahead.search")}
              className="flex-1 bg-transparent text-xs text-content placeholder-content-3 outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-content-3 hover:text-content-2"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M1 1l10 10M11 1L1 11" />
                </svg>
              </button>
            )}
          </div>

          {/* Options list */}
          <ul className="max-h-48 overflow-y-auto py-1">
            {/* "All" option — always shown */}
            <OptionItem
              option={allOption}
              isSelected={!value}
              onSelect={() => select("")}
            />

            {filtered.length > 0 ? (
              filtered.map((opt) => (
                <OptionItem
                  key={opt.value}
                  option={opt}
                  isSelected={opt.value === value}
                  onSelect={() => select(opt.value)}
                />
              ))
            ) : (
              <li className="px-3 py-2 text-xs text-content-3 text-center">
                {t("typeahead.no_results")}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function OptionItem({
  option,
  isSelected,
  onSelect,
}: {
  option: SelectOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onSelect}
        className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors ${
          isSelected
            ? "bg-accent/15 text-accent-text"
            : "text-content hover:bg-surface-raised"
        }`}
      >
        <span className="flex-1">{option.label}</span>
        {isSelected && (
          <svg className="w-3 h-3 text-accent shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
          </svg>
        )}
      </button>
    </li>
  );
}
