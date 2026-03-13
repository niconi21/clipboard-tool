import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Collection, Subcollection } from "../types";

interface InitialData {
  collections: Collection[];
  counts: Record<number, number>;
  subcollections: Subcollection[];
}

// initial comes from bootstrap. If provided, no fetch on mount.
export function useCollections(initial?: InitialData) {
  const [collections, setCollections] = useState<Collection[]>(initial?.collections ?? []);
  const [counts, setCounts] = useState<Record<number, number>>(initial?.counts ?? {});
  const [subcollections, setSubcollections] = useState<Subcollection[]>(initial?.subcollections ?? []);

  // Sync when bootstrap data arrives (transitions from undefined → object)
  useEffect(() => {
    if (initial && initial.collections.length > 0) {
      setCollections(initial.collections);
      setCounts(initial.counts);
      setSubcollections(initial.subcollections);
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
    // Fetch subcollections for the new collection (it gets a default one)
    const subs = await invoke<Subcollection[]>("get_subcollections", { collectionId: col.id });
    setSubcollections((prev) => [...prev, ...subs]);
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
    setSubcollections((prev) => prev.filter((s) => s.collection_id !== id));
  }, []);

  const refreshCounts = useCallback(async () => {
    const rawCounts = await invoke<[number, number][]>("get_collection_counts");
    setCounts(Object.fromEntries(rawCounts.map(([id, n]) => [id, n])));
  }, []);

  const subcollectionsFor = useCallback((collectionId: number) => {
    return subcollections.filter((s) => s.collection_id === collectionId);
  }, [subcollections]);

  const createSubcollection = useCallback(async (collectionId: number, name: string) => {
    const sub = await invoke<Subcollection>("create_subcollection", { collectionId, name });
    setSubcollections((prev) => [...prev, sub]);
    return sub;
  }, []);

  const renameSubcollection = useCallback(async (id: number, name: string) => {
    await invoke("rename_subcollection", { id, name });
    setSubcollections((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const removeSubcollection = useCallback(async (id: number) => {
    await invoke("delete_subcollection", { id });
    setSubcollections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const userCollections = collections.filter((c) => !c.is_builtin);

  return {
    collections, userCollections, counts, subcollections,
    create, update, remove, refreshCounts,
    subcollectionsFor, createSubcollection, renameSubcollection, removeSubcollection,
  };
}
