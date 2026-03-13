import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ClipboardEntry, Collection, Subcollection } from "../types";
import { ContentRenderer } from "./ContentRenderer";
import { CollectionSelector } from "./CollectionSelector";
import { timeAgo } from "../utils/time";

interface Props {
  entry: ClipboardEntry;
  collections: Collection[];
  subcollections: Subcollection[];
  colorFor: (name: string) => string;
  labelFor: (name: string) => string;
  onClose: () => void;
  onCollectionChanged?: (entryId: number, collectionIds: number[]) => void;
  onAliasChanged?: (entryId: number, alias: string | null) => void;
}

async function copyEntry(entry: ClipboardEntry) {
  try {
    if (entry.content_type === "image") {
      await invoke("copy_image_to_clipboard", { path: entry.content });
    } else {
      await invoke("copy_to_clipboard", { content: entry.content });
    }
  } catch (e) {
    console.error("[DetailPanel] copy failed:", e);
  }
}

export function DetailPanel({ entry, collections, subcollections, colorFor, labelFor, onClose, onCollectionChanged, onAliasChanged }: Props) {
  const { t } = useTranslation();
  const color = colorFor(entry.content_type);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionTooltip, setSelectionTooltip] = useState<{
    text: string;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasValue, setAliasValue] = useState(entry.alias ?? "");
  const aliasInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectionTooltip(null);
    setEditingAlias(false);
    setAliasValue(entry.alias ?? "");
  }, [entry.id, entry.alias]);

  useEffect(() => {
    if (editingAlias) aliasInputRef.current?.focus();
  }, [editingAlias]);

  async function saveAlias() {
    const trimmed = aliasValue.trim() || null;
    setEditingAlias(false);
    if (trimmed === (entry.alias ?? null)) return; // no change
    try {
      await invoke("update_entry_alias", { id: entry.id, alias: trimmed });
      onAliasChanged?.(entry.id, trimmed);
    } catch (e) {
      console.error("[DetailPanel] alias save failed:", e);
    }
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (entry.content_type === "image") return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !selection || selection.rangeCount === 0) {
      setSelectionTooltip(null);
      return;
    }
    const containerRect = contentRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const x = Math.max(60, Math.min(e.clientX - containerRect.left + 12, containerRect.width - 60));
    const y = e.clientY - containerRect.top + 16;
    setSelectionTooltip({ text, x, y, below: true });
  }

  function handleMouseDown() {
    setSelectionTooltip(null);
  }

  async function copySelection() {
    if (!selectionTooltip) return;
    try {
      // write_clipboard_raw does NOT set AppCopiedContent, so the watcher
      // picks it up and saves it as a new entry
      await invoke("copy_to_clipboard", { content: selectionTooltip.text });
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1200);
    } catch (e) {
      console.error("[DetailPanel] copy selection failed:", e);
    }
    window.getSelection()?.removeAllRanges();
    setSelectionTooltip(null);
  }

  return (
    <div className="flex flex-col w-full h-full border-l border-stroke bg-base overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-stroke shrink-0 gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide shrink-0"
          style={{ backgroundColor: color + "26", color }}
        >
          {labelFor(entry.content_type)}
        </span>

        {/* Alias field */}
        {editingAlias ? (
          <input
            ref={aliasInputRef}
            value={aliasValue}
            onChange={(e) => setAliasValue(e.target.value)}
            onBlur={saveAlias}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveAlias();
              if (e.key === "Escape") { setEditingAlias(false); setAliasValue(entry.alias ?? ""); }
            }}
            placeholder={t("detail.alias_placeholder")}
            className="flex-1 min-w-0 bg-surface-raised border border-accent/40 rounded px-2 py-0.5 text-xs text-content outline-none focus:border-accent"
          />
        ) : (
          <button
            onClick={() => setEditingAlias(true)}
            className="flex-1 min-w-0 text-left truncate"
            title={t("detail.alias_edit")}
          >
            {entry.alias ? (
              <span className="text-xs font-medium text-content truncate">{entry.alias}</span>
            ) : (
              <span className="text-[11px] text-content-3 hover:text-content-2 transition-colors">{t("detail.alias_add")}</span>
            )}
          </button>
        )}

        {entry.alias && !editingAlias && (
          <button
            onClick={async () => {
              await invoke("update_entry_alias", { id: entry.id, alias: null });
              onAliasChanged?.(entry.id, null);
              setAliasValue("");
            }}
            className="shrink-0 p-0.5 rounded text-content-3 hover:text-danger transition-colors"
            title={t("detail.alias_clear")}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => copyEntry(entry)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-content-2 hover:text-content hover:bg-surface-raised transition-colors"
            title={t("detail.copy_title")}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t("detail.copy")}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-content-2 hover:text-content hover:bg-surface-raised transition-colors"
            title={t("detail.close")}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Full content */}
      <div
        ref={contentRef}
        className="relative flex-1 overflow-y-auto p-3"
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
      >
        <ContentRenderer content={entry.content} contentType={entry.content_type} />

        {/* Floating copy tooltip on text selection */}
        {selectionTooltip && (
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={copySelection}
            style={{
              position: "absolute",
              left: selectionTooltip.x,
              top: selectionTooltip.y,
              transform: selectionTooltip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-surface-active border border-stroke-strong text-[11px] text-content shadow-lg hover:bg-surface-raised transition-colors z-50 whitespace-nowrap"
          >
            {copyFeedback ? (
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
                {t("detail.copy_selection")}
              </>
            )}
          </button>
        )}
      </div>

      {/* Metadata */}
      <div className="shrink-0 border-t border-stroke px-3 py-2 space-y-1.5">
        {collections.length > 0 && (
          <div className="pb-1.5">
            <span className="text-[10px] text-content-3 uppercase tracking-wide block mb-1.5">
              {t("detail.collections")}
            </span>
            <CollectionSelector
              entryId={entry.id}
              collections={collections}
              subcollections={subcollections}
              onChanged={(ids) => onCollectionChanged?.(entry.id, ids)}
            />
          </div>
        )}
        <MetaRow label={t("detail.when")} value={timeAgo(entry.created_at, t)} />
        {entry.source_app && <MetaRow label={t("detail.app")} value={entry.source_app} />}
        {entry.window_title && (
          <MetaRow label={t("detail.window")} value={entry.window_title} truncate />
        )}
        {entry.category !== "other" && (
          <MetaRow label={t("detail.category")} value={entry.category} />
        )}
        {entry.is_favorite && <MetaRow label={t("detail.status")} value={t("detail.favorite")} />}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  truncate,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-content-3 uppercase tracking-wide w-14 shrink-0 pt-0.5">
        {label}
      </span>
      <span
        className={`text-[11px] text-content-2 leading-snug ${truncate ? "truncate" : "break-words"}`}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}
