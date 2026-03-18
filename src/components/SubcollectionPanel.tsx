import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { Subcollection } from "../types";

interface Props {
  collectionId: number;
  subcollections: Subcollection[];
  activeSubcollection: number | null;
  refreshKey?: number;
  onSelect: (id: number | null) => void;
  onCreate: (collectionId: number, name: string) => Promise<Subcollection>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onDropEntry?: (entryId: number, subcollectionId: number) => void;
  isDragging?: boolean;
  currentSubcollectionId?: number | null;
}

export function SubcollectionPanel({
  collectionId,
  subcollections,
  activeSubcollection,
  refreshKey,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropEntry,
  isDragging,
  currentSubcollectionId,
}: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Fetch subcollection counts when collectionId or refreshKey changes
  useEffect(() => {
    refreshCounts();
  }, [collectionId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshCounts() {
    invoke<[number, number][]>("get_subcollection_counts", { collectionId })
      .then((raw) => setCounts(Object.fromEntries(raw.map(([id, n]) => [id, n]))))
      .catch(console.error);
  }

  // Auto-navigate to "All" if the active subcollection is the default one and its count drops to 0
  useEffect(() => {
    if (activeSubcollection === null) return;
    const activeSub = subcollections.find((s) => s.id === activeSubcollection);
    if (activeSub?.is_default && (counts[activeSubcollection] ?? 0) === 0) {
      onSelect(null);
    }
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sort: default first, then by created_at; hide default when empty
  const sorted = [...subcollections]
    .filter((s) => !s.is_default || (counts[s.id] ?? 0) > 0)
    .sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return a.created_at.localeCompare(b.created_at);
    });

  const totalCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await onCreate(collectionId, name);
    setNewName("");
    refreshCounts();
  }

  async function handleRename() {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) return;
    await onRename(editingId, name);
    setEditingId(null);
  }

  async function handleDelete(id: number) {
    await onDelete(id);
    if (activeSubcollection === id) onSelect(null);
    refreshCounts();
  }

  function displayName(sub: Subcollection) {
    return sub.is_default ? t("subcollections.default_name") : sub.name;
  }

  return (
    <div className="w-40 shrink-0 border-r border-stroke bg-base/50 flex flex-col overflow-hidden">
      <div className="px-2 pt-2 pb-1">
        <p className="text-[10px] text-content-3 uppercase tracking-wide font-medium truncate">
          {t("subcollections.title")}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-1 space-y-0.5">
        {/* "All" button */}
        <button
          onClick={() => onSelect(null)}
          className={`flex items-center justify-between gap-1 w-full px-2 py-1.5 rounded text-xs transition-colors text-left ${
            activeSubcollection === null
              ? "bg-accent/15 text-accent-text font-medium"
              : "text-content-2 hover:text-content hover:bg-surface-raised"
          }`}
        >
          <span className="truncate">{t("subcollections.all")}</span>
          <span className="text-[10px] opacity-60 shrink-0">{totalCount}</span>
        </button>

        {sorted.map((sub) => (
          <div key={sub.id} className="group relative">
            {editingId === sub.id ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={handleRename}
                  className="flex-1 bg-surface-raised border border-stroke rounded px-1.5 py-1 text-xs text-content focus:outline-none focus:border-accent min-w-0"
                />
              </div>
            ) : (
              <button
                onClick={() => onSelect(sub.id)}
                onDragOver={onDropEntry && sub.id !== currentSubcollectionId ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverId(sub.id); } : undefined}
                onDragLeave={onDropEntry ? () => setDragOverId(null) : undefined}
                onDrop={onDropEntry && sub.id !== currentSubcollectionId ? (e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
                  if (!isNaN(id)) onDropEntry(id, sub.id);
                } : undefined}
                className={`flex items-center justify-between gap-1 w-full px-2 py-1.5 rounded text-xs transition-all text-left ${
                  dragOverId === sub.id
                    ? "bg-accent/30 text-accent-text outline outline-1 outline-accent/60"
                    : isDragging && onDropEntry && sub.id !== currentSubcollectionId
                    ? "outline outline-1 outline-dashed outline-accent/40 text-content-2"
                    : activeSubcollection === sub.id
                    ? "bg-accent/15 text-accent-text font-medium"
                    : "text-content-2 hover:text-content hover:bg-surface-raised"
                }`}
              >
                <span className="truncate">{displayName(sub)}</span>
                <span className="text-[10px] opacity-60 shrink-0">{counts[sub.id] ?? 0}</span>
              </button>
            )}

            {/* Hover actions for non-default */}
            {!sub.is_default && editingId !== sub.id && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-surface rounded shadow-sm border border-stroke">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(sub.id);
                    setEditName(sub.name);
                  }}
                  className="p-0.5 text-content-3 hover:text-content-2 transition-colors"
                  title={t("common.edit")}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(sub.id);
                  }}
                  className="p-0.5 text-content-3 hover:text-danger transition-colors"
                  title={t("common.delete")}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Inline create — always last in the list */}
        <div className="flex items-center gap-1 px-1 py-0.5">
          <input
            placeholder={t("subcollections.create_placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            className="flex-1 bg-transparent border-none px-2 py-1.5 text-xs text-content placeholder:text-content-3 focus:outline-none min-w-0"
          />
          {newName.trim() && (
            <button
              onClick={handleCreate}
              className="p-0.5 rounded text-accent hover:bg-accent/20 transition-colors shrink-0"
              title={t("common.add")}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
