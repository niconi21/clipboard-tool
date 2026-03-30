import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useClipboard, EMPTY_FILTERS } from "./useClipboard";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClipboardEntry } from "../types";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

function makeEntry(id: number, overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  return {
    id,
    content: `content-${id}`,
    content_type: "text",
    category: "other",
    source_app: null,
    window_title: null,
    is_favorite: false,
    created_at: "2024-01-01T00:00:00",
    collection_ids: "",
    alias: null,
    ...overrides,
  };
}

describe("useClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(() => {});
  });

  describe("initial state", () => {
    it("starts with loading=true", () => {
      mockInvoke.mockResolvedValue([]);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      expect(result.current.loading).toBe(true);
    });

    it("does not invoke when enabled=false", () => {
      renderHook(() => useClipboard("", EMPTY_FILTERS, 50, false, null, null, false));
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("loading becomes false after data loads", async () => {
      mockInvoke.mockResolvedValue([]);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
    });
  });

  describe("entries", () => {
    it("populates entries from invoke response", async () => {
      const entries = [makeEntry(1), makeEntry(2)];
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries[0].id).toBe(1);
    });

    it("hasMore is true when page is full", async () => {
      const pageSize = 3;
      const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, pageSize, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);
    });

    it("hasMore is false when partial page returned", async () => {
      const pageSize = 10;
      const entries = [makeEntry(1), makeEntry(2)]; // less than pageSize
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, pageSize, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(false);
    });
  });

  describe("removeEntry", () => {
    it("removes entry from list after delete", async () => {
      const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
      mockInvoke.mockResolvedValueOnce(entries).mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.removeEntry(2);
      });

      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries.find((e) => e.id === 2)).toBeUndefined();
    });
  });

  describe("toggleFavorite", () => {
    it("updates is_favorite to true when toggle returns true", async () => {
      const entries = [makeEntry(1, { is_favorite: false })];
      mockInvoke.mockResolvedValueOnce(entries).mockResolvedValue(true);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.toggleFavorite(1);
      });

      expect(result.current.entries[0].is_favorite).toBe(true);
    });

    it("removes unfavorited entry in favorites-only view", async () => {
      const entries = [makeEntry(1, { is_favorite: true }), makeEntry(2, { is_favorite: true })];
      mockInvoke.mockResolvedValueOnce(entries).mockResolvedValue(false);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, true, null, null, true) // favoriteOnly=true
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.toggleFavorite(1);
      });

      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].id).toBe(2);
    });
  });

  describe("patch functions", () => {
    it("patchEntryAlias updates alias in place", async () => {
      const entries = [makeEntry(1)];
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.patchEntryAlias(1, "my alias"); });

      expect(result.current.entries[0].alias).toBe("my alias");
    });

    it("patchEntryCollections updates collection_ids", async () => {
      const entries = [makeEntry(1)];
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.patchEntryCollections(1, [3, 5]); });

      expect(result.current.entries[0].collection_ids).toBe("3,5");
    });

    it("patchEntryContentType updates content_type", async () => {
      const entries = [makeEntry(1, { content_type: "text" })];
      mockInvoke.mockResolvedValue(entries);
      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.patchEntryContentType(1, "url"); });

      expect(result.current.entries[0].content_type).toBe("url");
    });
  });

  describe("real-time listener", () => {
    it("registers clipboard-new-entry listener when enabled", async () => {
      mockInvoke.mockResolvedValue([]);
      renderHook(() => useClipboard("", EMPTY_FILTERS, 50, false, null, null, true));
      await waitFor(() => expect(mockListen).toHaveBeenCalledWith("clipboard-new-entry", expect.any(Function)));
    });

    it("does not register listener when disabled", () => {
      renderHook(() => useClipboard("", EMPTY_FILTERS, 50, false, null, null, false));
      expect(mockListen).not.toHaveBeenCalled();
    });

    it("prepends new entry from event when no filters active", async () => {
      let listenerCallback: ((event: { payload: ClipboardEntry }) => void) | null = null;
      mockListen.mockImplementation((_event, cb) => {
        listenerCallback = cb as typeof listenerCallback;
        return Promise.resolve(() => {});
      });
      mockInvoke.mockResolvedValue([makeEntry(1)]);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newEntry = makeEntry(99);
      act(() => {
        listenerCallback?.({ payload: newEntry });
      });

      expect(result.current.entries[0].id).toBe(99);
      expect(result.current.entries).toHaveLength(2);
    });
  });

  describe("loadMore", () => {
    it("appends entries from next page", async () => {
      const page1 = [makeEntry(1), makeEntry(2), makeEntry(3)];
      const page2 = [makeEntry(4), makeEntry(5)];
      mockInvoke.mockResolvedValueOnce(page1).mockResolvedValue(page2);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 3, false, null, null, true) // pageSize=3
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.entries).toHaveLength(5);
    });
  });

  describe("real-time listener with active filters (lines 100-101)", () => {
    it("calls load() when new entry arrives and search is active", async () => {
      let listenerCallback: ((event: { payload: ClipboardEntry }) => void) | null = null;
      mockListen.mockImplementation((_event, cb) => {
        listenerCallback = cb as typeof listenerCallback;
        return Promise.resolve(() => {});
      });

      const firstPage = [makeEntry(1)];
      const reloadedPage = [makeEntry(99), makeEntry(1)];
      mockInvoke
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(reloadedPage); // after reload triggered by new entry

      const { result } = renderHook(() =>
        useClipboard("hello", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newEntry = makeEntry(99);
      await act(async () => {
        listenerCallback?.({ payload: newEntry });
      });

      // With active search, load() is called — entries should be refreshed
      await waitFor(() => expect(result.current.entries).toHaveLength(2));
      expect(result.current.entries[0].id).toBe(99);
    });

    it("ignores new entries when favoriteOnly=true", async () => {
      let listenerCallback: ((event: { payload: ClipboardEntry }) => void) | null = null;
      mockListen.mockImplementation((_event, cb) => {
        listenerCallback = cb as typeof listenerCallback;
        return Promise.resolve(() => {});
      });
      mockInvoke.mockResolvedValue([makeEntry(1, { is_favorite: true })]);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, true, null, null, true) // favoriteOnly=true
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newEntry = makeEntry(99);
      act(() => {
        listenerCallback?.({ payload: newEntry });
      });

      // New entry should NOT be prepended in favorites-only mode
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].id).toBe(1);
    });

    it("ignores new entries when collectionId is not null", async () => {
      let listenerCallback: ((event: { payload: ClipboardEntry }) => void) | null = null;
      mockListen.mockImplementation((_event, cb) => {
        listenerCallback = cb as typeof listenerCallback;
        return Promise.resolve(() => {});
      });
      mockInvoke.mockResolvedValue([makeEntry(1)]);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, 5, null, true) // collectionId=5
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newEntry = makeEntry(99);
      act(() => {
        listenerCallback?.({ payload: newEntry });
      });

      // New entry should NOT be prepended in collection view
      expect(result.current.entries).toHaveLength(1);
    });
  });

  describe("removeEntryFromView (lines 151-155)", () => {
    it("removes entry from view without invoking delete", async () => {
      const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
      mockInvoke.mockResolvedValue(entries);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.removeEntryFromView(2);
      });

      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries.find((e) => e.id === 2)).toBeUndefined();
    });

    it("removeEntryFromView does not call invoke", async () => {
      const entries = [makeEntry(1)];
      mockInvoke.mockResolvedValue(entries);

      const { result } = renderHook(() =>
        useClipboard("", EMPTY_FILTERS, 50, false, null, null, true)
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const callsBefore = mockInvoke.mock.calls.length;

      act(() => {
        result.current.removeEntryFromView(1);
      });

      // No additional invoke calls
      expect(mockInvoke.mock.calls.length).toBe(callsBefore);
    });
  });
});
