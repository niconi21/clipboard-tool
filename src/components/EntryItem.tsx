import { memo, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ClipboardEntry, Collection } from "../types";
import { timeAgo } from "../utils/time";

// Module-level cache for image thumbnails to avoid refetching on scroll
const imageCache = new Map<string, string>();

interface Props {
  entry: ClipboardEntry;
  collections: Collection[];
  isSelected: boolean;
  onSelect: (entry: ClipboardEntry) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  onCopy: (entry: ClipboardEntry) => void;
  colorFor: (name: string) => string;
  labelFor: (name: string) => string;
}

function ImageThumbnail({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(() => imageCache.get(path) ?? null);

  useEffect(() => {
    if (src) return; // already cached
    invoke<string>("get_image_base64", { path }).then((data) => {
      imageCache.set(path, data);
      setSrc(data);
    }).catch(() => {});
  }, [path, src]);

  if (!src) {
    return <div className="w-12 h-10 rounded bg-surface-raised animate-pulse" />;
  }
  return (
    <img
      src={src}
      alt=""
      className="h-10 max-w-30 rounded object-cover border border-stroke"
      draggable={false}
    />
  );
}

export const EntryItem = memo(function EntryItem({
  entry,
  collections,
  isSelected,
  onSelect,
  onDelete,
  onToggleFavorite,
  onCopy,
  colorFor,
  labelFor,
}: Props) {
  const color = colorFor(entry.content_type);
  const { t, i18n } = useTranslation();

  const collectionChips = entry.collection_ids
    ? entry.collection_ids.split(",").map(Number).flatMap((id) => {
        const col = collections.find((c) => c.id === id);
        return col ? [col] : [];
      })
    : [];

  return (
    <div
      className={`group relative flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
        isSelected ? "bg-surface-active" : "hover:bg-surface-raised"
      }`}
      onClick={() => onSelect(entry)}
    >
      {/* Type badge */}
      <span
        className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
        style={{ backgroundColor: color + "26", color }}
      >
        {labelFor(entry.content_type)}
      </span>

      {/* Content preview */}
      <div className="flex-1 min-w-0">
        {entry.content_type === "image" ? (
          <ImageThumbnail path={entry.content} />
        ) : (
          <>
            {entry.alias && (
              <p className="text-sm text-content font-medium leading-snug truncate">
                {entry.alias}
              </p>
            )}
            <p className={`text-sm leading-snug font-mono line-clamp-2 ${entry.alias ? "text-content-3" : "text-content"}`}>
              {entry.content.replaceAll("\n", " ↵ ")}
            </p>
          </>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          {entry.source_app && (
            <span className="text-[10px] text-content-2">{entry.source_app}</span>
          )}
          <span className="text-[10px] text-content-3">{timeAgo(entry.created_at, t, i18n.language)}</span>
        </div>
        {collectionChips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {collectionChips.map((col) => (
              <span
                key={col.id}
                className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: col.color + "26", color: col.color }}
              >
                {col.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions — overlay on hover or when selected */}
      <div
        className={`absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-surface-raised/90 backdrop-blur-sm border border-stroke px-0.5 py-0.5 shadow-sm transition-opacity ${
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(entry); }}
          className="p-1 rounded hover:bg-surface-raised text-content-2 hover:text-accent-text transition-colors"
          title={t("entry.copy")}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(entry.id); }}
          className={`p-1 rounded hover:bg-surface-raised transition-colors ${entry.is_favorite ? "text-warn" : "text-content-2"}`}
          title={entry.is_favorite ? t("entry.remove_favorite") : t("entry.add_favorite")}
        >
          <svg className="w-3.5 h-3.5" fill={entry.is_favorite ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          className="p-1 rounded hover:bg-surface-raised text-content-2 hover:text-danger transition-colors"
          title={t("entry.delete")}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
});
