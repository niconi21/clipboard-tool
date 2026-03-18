import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Collection, Subcollection } from "../types";

interface Props {
  entryId: number;
  collections: Collection[];
  subcollections: Subcollection[];
  onChanged?: (collectionIds: number[]) => void;
  onSubcollectionChanged?: (entryId: number) => void;
}

export function CollectionSelector({ entryId, collections, subcollections, onChanged, onSubcollectionChanged }: Props) {
  const { t } = useTranslation();
  // Map: collectionId → subcollectionId
  const [assignments, setAssignments] = useState<Map<number, number>>(new Map());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const load = useCallback(async () => {
    const pairs = await invoke<[number, number][]>("get_entry_subcollection_ids", { entryId });
    setAssignments(new Map(pairs.map(([cid, sid]) => [cid, sid])));
  }, [entryId]);

  useEffect(() => { load(); setOpen(false); }, [load]);

  const selectedIds = new Set(assignments.keys());

  async function toggle(collectionId: number) {
    const next = new Map(assignments);
    if (next.has(collectionId)) {
      next.delete(collectionId);
    } else {
      // Find default subcollection for this collection
      const defaultSub = subcollections.find(
        (s) => s.collection_id === collectionId && s.is_default,
      );
      next.set(collectionId, defaultSub?.id ?? 0);
    }
    setAssignments(next);
    const ids = [...next.keys()];
    await invoke("set_entry_collections", { entryId, collectionIds: ids });
    onChanged?.(ids);
  }

  async function changeSubcollection(collectionId: number, subcollectionId: number) {
    await invoke("move_entry_subcollection", { entryId, collectionId, subcollectionId });
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(collectionId, subcollectionId);
      return next;
    });
    onSubcollectionChanged?.(entryId);
  }

  if (collections.length === 0) return null;

  const assigned = collections.filter((c) => selectedIds.has(c.id));

  function subsFor(collectionId: number) {
    return subcollections
      .filter((s) => s.collection_id === collectionId)
      .sort((a, b) => (a.is_default ? -1 : b.is_default ? 1 : a.created_at.localeCompare(b.created_at)));
  }

  function subDisplayName(sub: Subcollection) {
    return sub.is_default ? t("subcollections.default_name") : sub.name;
  }

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
        <div className="absolute left-0 bottom-full mb-1 z-10 min-w-52 bg-surface border border-stroke rounded-lg shadow-dropdown overflow-hidden">
          <div className="py-1">
            {collections.map((col) => {
              const checked = selectedIds.has(col.id);
              const subs = subsFor(col.id);
              const currentSubId = assignments.get(col.id);
              return (
                <div key={col.id}>
                  <button
                    onClick={() => toggle(col.id)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-raised transition-colors"
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 ${checked ? "" : "border border-stroke-strong"}`}
                      style={checked ? { backgroundColor: col.color } : {}}
                    >
                      {checked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs text-content">{col.name}</span>
                  </button>
                  {/* Subcollection selector — show when checked and has multiple subcollections */}
                  {checked && subs.length > 1 && (
                    <div className="flex items-center gap-1 px-3 pb-1 pl-9">
                      <svg className="w-3 h-3 text-content-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <select
                        value={currentSubId ?? ""}
                        onChange={(e) => changeSubcollection(col.id, Number(e.target.value))}
                        className="flex-1 appearance-none bg-surface-raised border border-stroke rounded px-2 py-0.5 text-[11px] text-content-2 cursor-pointer hover:border-stroke-strong focus:outline-none focus:border-accent transition-colors"
                      >
                        {subs.map((sub) => (
                          <option key={sub.id} value={sub.id}>{subDisplayName(sub)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-stroke">
            <button
              onClick={() => setOpen(false)}
              className="w-full px-3 py-1.5 text-[11px] text-content-3 hover:text-content-2 hover:bg-surface-raised transition-colors text-center"
            >
              {t("collection_selector.done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
