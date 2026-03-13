import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ClipboardEntry, Collection } from "../types";
import { EntryItem } from "./EntryItem";

interface Props {
  entries: ClipboardEntry[];
  collections: Collection[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  search: string;
  selectedId: number | null;
  onSelect: (entry: ClipboardEntry) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  onCopy: (entry: ClipboardEntry) => void;
  colorFor: (name: string) => string;
  labelFor: (name: string) => string;
}

export function EntryList({
  entries,
  collections,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  search,
  selectedId,
  onSelect,
  onDelete,
  onToggleFavorite,
  onCopy,
  colorFor,
  labelFor,
}: Props) {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasMore && !loadingMore) onLoadMore(); },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-content-3">{t("list.loading")}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="text-sm text-content-2">
          {search ? t("list.no_results") : t("list.empty")}
        </p>
        {!search && (
          <p className="text-xs text-content-3">{t("list.empty_hint")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/60">
      {entries.map((entry) => (
        <EntryItem
          key={entry.id}
          entry={entry}
          collections={collections}
          isSelected={entry.id === selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onCopy={onCopy}
          colorFor={colorFor}
          labelFor={labelFor}
        />
      ))}

      {/* Sentinel — triggers loadMore when visible */}
      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex justify-center py-3">
          <p className="text-xs text-content-3">{t("list.loading_more")}</p>
        </div>
      )}
    </div>
  );
}
