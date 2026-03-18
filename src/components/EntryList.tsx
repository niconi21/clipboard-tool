import { useEffect, useRef, useState } from "react";
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
  onDragStart?: (entryId: number) => void;
  onDragEnd?: () => void;
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
  onDragStart,
  onDragEnd,
}: Props) {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-neutral-800/60">
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
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
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

      {/* Floating scroll-to-top button — outside scroll container so it stays visible */}
      <button
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Scroll to top"
        className={`absolute bottom-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-surface-raised border border-stroke shadow-md text-content-2 hover:text-content hover:bg-surface-active transition-all duration-200 ${
          showScrollTop ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
