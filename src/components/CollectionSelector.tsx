import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Collection } from "../types";

interface Props {
  entryId: number;
  collections: Collection[];
  onChanged?: (collectionIds: number[]) => void;
}

export function CollectionSelector({ entryId, collections, onChanged }: Props) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // F-8: close on outside click
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

  const load = useCallback(async () => {
    const ids = await invoke<number[]>("get_entry_collection_ids", { entryId });
    setSelectedIds(new Set(ids));
  }, [entryId]);

  useEffect(() => { load(); setOpen(false); }, [load]);

  async function toggle(collectionId: number) {
    const next = new Set(selectedIds);
    if (next.has(collectionId)) next.delete(collectionId);
    else next.add(collectionId);
    setSelectedIds(next);
    const ids = [...next];
    await invoke("set_entry_collections", { entryId, collectionIds: ids });
    onChanged?.(ids);
  }

  if (collections.length === 0) return null;

  const assigned = collections.filter((c) => selectedIds.has(c.id));

  return (
    <div className="relative" ref={containerRef}>
      {/* Chips + toggle button */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {assigned.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: c.color + "26", color: c.color }}
          >
            {c.name}
          </span>
        ))}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-content-3 border border-stroke hover:border-stroke-strong hover:text-content-2 transition-colors"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {assigned.length === 0 ? t("collection_selector.add") : t("collection_selector.edit")}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-10 min-w-45 bg-surface border border-stroke rounded-lg shadow-dropdown overflow-hidden">
          {collections.map((col) => {
            const checked = selectedIds.has(col.id);
            return (
              <button
                key={col.id}
                onClick={() => toggle(col.id)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-surface-raised transition-colors"
              >
                <div
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "border-transparent" : "border-stroke-strong"}`}
                  style={checked ? { backgroundColor: col.color } : {}}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                <span className="text-sm text-content">{col.name}</span>
              </button>
            );
          })}
          <div className="border-t border-stroke">
            <button
              onClick={() => setOpen(false)}
              className="w-full px-3 py-1.5 text-xs text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors text-center"
            >
              {t("collection_selector.done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
