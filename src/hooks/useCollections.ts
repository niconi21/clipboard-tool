import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Collection } from "../types";

interface InitialData {
  collections: Collection[];
  counts: Record<number, number>;
}

// initial comes from bootstrap. If provided, no fetch on mount.
export function useCollections(initial?: InitialData) {
  const [collections, setCollections] = useState<Collection[]>(initial?.collections ?? []);
  const [counts, setCounts] = useState<Record<number, number>>(initial?.counts ?? {});

  // Sync when bootstrap data arrives (transitions from undefined → object)
  useEffect(() => {
    if (initial && initial.collections.length > 0) {
      setCollections(initial.collections);
      setCounts(initial.counts);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Only fetch independently if not seeded from bootstrap
  useEffect(() => {
    if (initial) return;
    Promise.all([
      invoke<Collection[]>("get_collections"),
      invoke<[number, number][]>("get_collection_counts"),
    ]).then(([cols, rawCounts]) => {
      setCollections(cols);
      setCounts(Object.fromEntries(rawCounts.map(([id, n]) => [id, n])));
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(async (name: string, color: string) => {
    const col = await invoke<Collection>("create_collection", { name, color });
    setCollections((prev) => [...prev, col]);
    return col;
  }, []);

  const update = useCallback(async (id: number, name: string, color: string) => {
    await invoke("update_collection", { id, name, color });
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, name, color } : c)));
  }, []);

  const remove = useCallback(async (id: number) => {
    await invoke("delete_collection", { id });
    setCollections((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }, []);

  const refreshCounts = useCallback(async () => {
    const rawCounts = await invoke<[number, number][]>("get_collection_counts");
    setCounts(Object.fromEntries(rawCounts.map(([id, n]) => [id, n])));
  }, []);

  const userCollections = collections.filter((c) => !c.is_builtin);

  return { collections, userCollections, counts, create, update, remove, refreshCounts };
}
