import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCollections } from "./useCollections";
import { invoke } from "@tauri-apps/api/core";
import type { Collection, Subcollection } from "../types";

const mockInvoke = vi.mocked(invoke);

function makeCollection(id: number, name: string, isBuiltin = false): Collection {
  return { id, name, color: "#3b82f6", is_builtin: isBuiltin, created_at: "2024-01-01" };
}

function makeSubcollection(id: number, collectionId: number, name: string): Subcollection {
  return { id, collection_id: collectionId, name, is_default: false, created_at: "2024-01-01" };
}

const initialData = {
  collections: [makeCollection(1, "Favorites", true), makeCollection(2, "Work")],
  counts: { 1: 5, 2: 3 },
  subcollections: [makeSubcollection(10, 2, "Projects")],
};

describe("useCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("with initial data from bootstrap", () => {
    it("starts with initial collections", () => {
      const { result } = renderHook(() => useCollections(initialData));
      expect(result.current.collections).toHaveLength(2);
      expect(result.current.collections[0].name).toBe("Favorites");
    });

    it("does not fetch when initial data provided", () => {
      renderHook(() => useCollections(initialData));
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("exposes counts from initial data", () => {
      const { result } = renderHook(() => useCollections(initialData));
      expect(result.current.counts[1]).toBe(5);
      expect(result.current.counts[2]).toBe(3);
    });

    it("exposes subcollections from initial data", () => {
      const { result } = renderHook(() => useCollections(initialData));
      expect(result.current.subcollections).toHaveLength(1);
    });
  });

  describe("without initial data (standalone fetch)", () => {
    it("fetches collections when no initial data", async () => {
      const cols = [makeCollection(1, "Favorites", true)];
      mockInvoke
        .mockResolvedValueOnce(cols)       // get_collections
        .mockResolvedValueOnce([[1, 5]]);  // get_collection_counts

      const { result } = renderHook(() => useCollections());
      await waitFor(() => expect(result.current.collections).toHaveLength(1));

      expect(mockInvoke).toHaveBeenCalledWith("get_collections");
      expect(mockInvoke).toHaveBeenCalledWith("get_collection_counts");
    });

    it("converts raw counts to record", async () => {
      const cols = [makeCollection(1, "Favorites", true)];
      mockInvoke
        .mockResolvedValueOnce(cols)
        .mockResolvedValueOnce([[1, 7], [2, 3]]);

      const { result } = renderHook(() => useCollections());
      await waitFor(() => expect(result.current.counts[1]).toBe(7));
      expect(result.current.counts[2]).toBe(3);
    });
  });

  describe("userCollections", () => {
    it("excludes builtin collections", () => {
      const { result } = renderHook(() => useCollections(initialData));
      // Favorites is builtin, Work is not
      expect(result.current.userCollections).toHaveLength(1);
      expect(result.current.userCollections[0].name).toBe("Work");
    });
  });

  describe("create", () => {
    it("appends new collection to list", async () => {
      const newCol = makeCollection(3, "Personal");
      const newSub = makeSubcollection(20, 3, "Default");
      mockInvoke
        .mockResolvedValueOnce(newCol)     // create_collection
        .mockResolvedValueOnce([newSub]);  // get_subcollections

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.create("Personal", "#ff0000");
      });

      expect(result.current.collections).toHaveLength(3);
      expect(result.current.collections[2].name).toBe("Personal");
    });

    it("adds subcollections returned for the new collection", async () => {
      const newCol = makeCollection(3, "Personal");
      const newSub = makeSubcollection(20, 3, "Default");
      mockInvoke
        .mockResolvedValueOnce(newCol)
        .mockResolvedValueOnce([newSub]);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.create("Personal", "#ff0000");
      });

      expect(result.current.subcollections).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates collection name and color in place", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.update(2, "Updated Work", "#ff0000");
      });

      const updated = result.current.collections.find((c) => c.id === 2);
      expect(updated?.name).toBe("Updated Work");
      expect(updated?.color).toBe("#ff0000");
    });
  });

  describe("remove", () => {
    it("removes collection from list", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.remove(2);
      });

      expect(result.current.collections.find((c) => c.id === 2)).toBeUndefined();
      expect(result.current.collections).toHaveLength(1);
    });

    it("removes count entry for deleted collection", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.remove(2);
      });

      expect(result.current.counts[2]).toBeUndefined();
    });

    it("removes subcollections belonging to deleted collection", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.remove(2);
      });

      expect(result.current.subcollections.filter((s) => s.collection_id === 2)).toHaveLength(0);
    });
  });

  describe("refreshCounts", () => {
    it("updates counts from server", async () => {
      mockInvoke.mockResolvedValue([[1, 99], [2, 42]]);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.refreshCounts();
      });

      expect(result.current.counts[1]).toBe(99);
      expect(result.current.counts[2]).toBe(42);
    });
  });

  describe("subcollectionsFor", () => {
    it("returns subcollections belonging to a specific collection", () => {
      const { result } = renderHook(() => useCollections(initialData));
      const subs = result.current.subcollectionsFor(2);
      expect(subs).toHaveLength(1);
      expect(subs[0].name).toBe("Projects");
    });

    it("returns empty array for collection with no subcollections", () => {
      const { result } = renderHook(() => useCollections(initialData));
      const subs = result.current.subcollectionsFor(999);
      expect(subs).toHaveLength(0);
    });
  });

  describe("createSubcollection", () => {
    it("appends new subcollection to list", async () => {
      const newSub = makeSubcollection(30, 1, "Archived");
      mockInvoke.mockResolvedValue(newSub);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.createSubcollection(1, "Archived");
      });

      expect(result.current.subcollections).toHaveLength(2);
      expect(result.current.subcollections[1].name).toBe("Archived");
    });
  });

  describe("renameSubcollection", () => {
    it("updates subcollection name in place", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.renameSubcollection(10, "Renamed");
      });

      const sub = result.current.subcollections.find((s) => s.id === 10);
      expect(sub?.name).toBe("Renamed");
    });
  });

  describe("removeSubcollection", () => {
    it("removes subcollection from list", async () => {
      mockInvoke.mockResolvedValue(undefined);

      const { result } = renderHook(() => useCollections(initialData));

      await act(async () => {
        await result.current.removeSubcollection(10);
      });

      expect(result.current.subcollections.find((s) => s.id === 10)).toBeUndefined();
      expect(result.current.subcollections).toHaveLength(0);
    });
  });
});
