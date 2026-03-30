import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useContentTypes } from "./useContentTypes";
import { invoke } from "@tauri-apps/api/core";
import type { ContentTypeStyle } from "../types";

const mockInvoke = vi.mocked(invoke);

function makeContentType(name: string, label: string, color: string): ContentTypeStyle {
  return { name, label, color, is_builtin: false };
}

describe("useContentTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("with no initial data (standalone fetch)", () => {
    it("fetches content types on mount when no initial data", async () => {
      const types = [makeContentType("url", "URL", "#3b82f6")];
      mockInvoke.mockResolvedValue(types);

      const { result } = renderHook(() => useContentTypes());
      await waitFor(() => expect(result.current.contentTypes).toHaveLength(1));

      expect(mockInvoke).toHaveBeenCalledWith("get_content_types");
      expect(result.current.contentTypes[0].name).toBe("url");
    });

    it("starts with empty array before fetch completes", () => {
      mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
      const { result } = renderHook(() => useContentTypes());
      expect(result.current.contentTypes).toHaveLength(0);
    });
  });

  describe("with initial data from bootstrap", () => {
    it("uses initial data immediately without fetching", () => {
      const initial = [makeContentType("email", "Email", "#ec4899")];
      const { result } = renderHook(() => useContentTypes(initial));

      expect(result.current.contentTypes).toHaveLength(1);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("does not fetch when initial data is provided", () => {
      const initial = [makeContentType("text", "Text", "#6b7280")];
      renderHook(() => useContentTypes(initial));

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("does not use initial data when initial array is empty", async () => {
      const types = [makeContentType("code", "Code", "#8b5cf6")];
      mockInvoke.mockResolvedValue(types);

      const { result } = renderHook(() => useContentTypes([]));
      await waitFor(() => expect(result.current.contentTypes).toHaveLength(1));

      expect(mockInvoke).toHaveBeenCalledWith("get_content_types");
    });
  });

  describe("colorFor", () => {
    it("returns the color for a known content type", () => {
      const initial = [makeContentType("url", "URL", "#3b82f6")];
      const { result } = renderHook(() => useContentTypes(initial));
      expect(result.current.colorFor("url")).toBe("#3b82f6");
    });

    it("returns fallback color for unknown type", () => {
      const initial = [makeContentType("url", "URL", "#3b82f6")];
      const { result } = renderHook(() => useContentTypes(initial));
      expect(result.current.colorFor("unknown_type")).toBe("#6b7280");
    });
  });

  describe("labelFor", () => {
    it("returns the label for a known content type", () => {
      const initial = [makeContentType("email", "Email", "#ec4899")];
      const { result } = renderHook(() => useContentTypes(initial));
      expect(result.current.labelFor("email")).toBe("Email");
    });

    it("returns the type name as fallback for unknown type", () => {
      const initial = [makeContentType("url", "URL", "#3b82f6")];
      const { result } = renderHook(() => useContentTypes(initial));
      expect(result.current.labelFor("nonexistent")).toBe("nonexistent");
    });
  });

  describe("refresh", () => {
    it("re-fetches content types when called", async () => {
      const initial = [makeContentType("text", "Text", "#6b7280")];
      const updated = [makeContentType("text", "Text", "#6b7280"), makeContentType("url", "URL", "#3b82f6")];
      mockInvoke.mockResolvedValue(updated);

      const { result } = renderHook(() => useContentTypes(initial));
      expect(result.current.contentTypes).toHaveLength(1);

      await act(async () => {
        result.current.refresh();
      });

      await waitFor(() => expect(result.current.contentTypes).toHaveLength(2));
      expect(mockInvoke).toHaveBeenCalledWith("get_content_types");
    });
  });
});
