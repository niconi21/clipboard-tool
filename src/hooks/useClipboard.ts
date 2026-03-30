import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClipboardEntry } from "../types";

export interface ClipboardFilters {
  contentType: string;
  sourceApp: string;
  category: string;
  windowTitle: string;
}

export const EMPTY_FILTERS: ClipboardFilters = {
  contentType: "",
  sourceApp: "",
  category: "",
  windowTitle: "",
};

export function useClipboard(search: string, filters: ClipboardFilters, pageSize = 50, favoriteOnly = false, collectionId: number | null = null, subcollectionId: number | null = null, enabled = true) {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  const hasActiveFilter =
    !!filters.contentType || !!filters.sourceApp || !!filters.category || !!filters.windowTitle;

  const fetchPage = useCallback(async (offset: number): Promise<ClipboardEntry[]> => {
    return invoke<ClipboardEntry[]>("get_entries", {
      search: search.trim() || null,
      sourceApp: filters.sourceApp || null,
      category: filters.category || null,
      contentType: filters.contentType || null,
      windowTitle: filters.windowTitle || null,
      favoriteOnly: favoriteOnly || null,
      collectionId: collectionId ?? null,
      subcollectionId: subcollectionId ?? null,
      limit: pageSize,
      offset,
    });
  }, [search, filters.contentType, filters.sourceApp, filters.category, filters.windowTitle, favoriteOnly, collectionId, subcollectionId, pageSize]);

  // Reset and load first page whenever search/filters change
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPage(0);
      offsetRef.current = result.length;
      setEntries(result);
      setHasMore(result.length === pageSize);
    } catch (e) {
      console.error("[useClipboard] get_entries failed:", e);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  // Append next page
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchPage(offsetRef.current);
      offsetRef.current += result.length;
      setEntries((prev) => [...prev, ...result]);
      setHasMore(result.length === pageSize);
    } catch (e) {
      console.error("[useClipboard] loadMore failed:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, hasMore]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    const t = setTimeout(load, search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, search, enabled]);

  // Real-time new entry listener
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<ClipboardEntry>("clipboard-new-entry", (event) => {
      if (cancelled) return;
      // Favorites/collection tab: new entries won't match, ignore them
      if (favoriteOnly || collectionId !== null) return;
      if (!search.trim() && !hasActiveFilter) {
        setEntries((prev) => {
          const updated = [event.payload, ...prev];
          offsetRef.current = updated.length;
          return updated;
        });
      } else {
        load();
      }
    })
      .then((fn) => { if (cancelled) fn(); else unlistenFn = fn; })
      .catch((e) => console.error("[useClipboard] listen failed:", e));

    return () => { cancelled = true; unlistenFn?.(); };
  }, [search, hasActiveFilter, favoriteOnly, collectionId, load, enabled]);

  const removeEntry = useCallback(async (id: number, collectionId?: number | null, subcollectionId?: number | null) => {
    await invoke("delete_entry", {
      id,
      collectionId: collectionId ?? null,
      subcollectionId: subcollectionId ?? null,
    });
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      offsetRef.current = updated.length;
      return updated;
    });
  }, []);

  const toggleFavorite = useCallback(async (id: number) => {
    const nowFavorite = await invoke<boolean>("toggle_favorite", { id });
    setEntries((prev) => {
      const updated = prev.map((e) => (e.id === id ? { ...e, is_favorite: nowFavorite } : e));
      // In favorites-only view, remove entries that were just unfavorited
      if (favoriteOnly) return updated.filter((e) => e.is_favorite);
      return updated;
    });
  }, [favoriteOnly]);

  const patchEntryCollections = useCallback((id: number, collectionIds: number[]) => {
    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, collection_ids: collectionIds.join(",") } : e)
    );
  }, []);

  const patchEntryAlias = useCallback((id: number, alias: string | null) => {
    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, alias } : e)
    );
  }, []);

  const patchEntryContentType = useCallback((id: number, contentType: string) => {
    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, content_type: contentType } : e)
    );
  }, []);

  const removeEntryFromView = useCallback((id: number) => {
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      offsetRef.current = updated.length;
      return updated;
    });
  }, []);

  return { entries, loading, loadingMore, hasMore, loadMore, reloadEntries: load, removeEntry, toggleFavorite, patchEntryCollections, patchEntryAlias, patchEntryContentType, removeEntryFromView };
}
