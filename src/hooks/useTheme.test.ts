import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../types";

const mockInvoke = vi.mocked(invoke);

function makeTheme(slug: string, overrides: Partial<Theme> = {}): Theme {
  return {
    slug,
    name: slug,
    base: "#000000",
    surface: "#111111",
    surface_raised: "#222222",
    surface_active: "#333333",
    stroke: "#444444",
    stroke_strong: "#555555",
    content: "#ffffff",
    content_2: "#eeeeee",
    content_3: "#dddddd",
    accent: "#3b82f6",
    accent_text: "#ffffff",
    is_builtin: true,
    ...overrides,
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset CSS vars between tests
    document.documentElement.removeAttribute("style");
  });

  it("applies theme CSS variables on mount", () => {
    const theme = makeTheme("midnight", { base: "#0a0a0f", accent: "#3b82f6" });
    renderHook(() => useTheme([theme], "midnight"));
    expect(document.documentElement.style.getPropertyValue("--color-base")).toBe("#0a0a0f");
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#3b82f6");
  });

  it("returns the active theme", () => {
    const theme = makeTheme("midnight");
    const { result } = renderHook(() => useTheme([theme], "midnight"));
    expect(result.current.activeTheme?.slug).toBe("midnight");
  });

  it("falls back to first theme when slug not found", () => {
    const theme = makeTheme("default");
    const { result } = renderHook(() => useTheme([theme], "nonexistent"));
    expect(result.current.activeTheme?.slug).toBe("default");
  });

  it("returns null activeTheme when themes array is empty", () => {
    const { result } = renderHook(() => useTheme([], "midnight"));
    expect(result.current.activeTheme).toBeNull();
  });

  it("does not apply theme when themes is empty", () => {
    renderHook(() => useTheme([], "midnight"));
    expect(document.documentElement.style.getPropertyValue("--color-base")).toBe("");
  });

  it("setTheme changes the active theme", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const theme1 = makeTheme("light", { base: "#ffffff" });
    const theme2 = makeTheme("dark", { base: "#000000" });
    const themes = [theme1, theme2];
    // Use initialProps so the themes array reference is stable across renders
    const { result } = renderHook(
      ({ themes, slug }) => useTheme(themes, slug),
      { initialProps: { themes, slug: "light" } }
    );

    // Wait for the initial theme to be applied
    await waitFor(() => expect(result.current.activeTheme?.slug).toBe("light"));

    act(() => {
      result.current.setTheme("dark");
    });

    await waitFor(() => expect(result.current.activeTheme?.slug).toBe("dark"));
    expect(document.documentElement.style.getPropertyValue("--color-base")).toBe("#000000");
  });

  it("setTheme calls invoke with set_active_theme", () => {
    mockInvoke.mockResolvedValue(undefined);
    const theme1 = makeTheme("light");
    const theme2 = makeTheme("dark");
    const { result } = renderHook(() => useTheme([theme1, theme2], "light"));

    act(() => {
      result.current.setTheme("dark");
    });

    expect(mockInvoke).toHaveBeenCalledWith("set_active_theme", { slug: "dark" });
  });

  it("setTheme does nothing for unknown slug", () => {
    mockInvoke.mockResolvedValue(undefined);
    const theme = makeTheme("light");
    const { result } = renderHook(() => useTheme([theme], "light"));

    act(() => {
      result.current.setTheme("nonexistent");
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.activeTheme?.slug).toBe("light");
  });

  it("does not re-apply theme on re-render with same slug", () => {
    const theme = makeTheme("midnight");
    const setPropertySpy = vi.spyOn(document.documentElement.style, "setProperty");
    const { rerender } = renderHook(
      ({ slug }) => useTheme([theme], slug),
      { initialProps: { slug: "midnight" } }
    );
    const callsAfterFirstRender = setPropertySpy.mock.calls.length;

    rerender({ slug: "midnight" });

    // Should not have set any additional properties (appliedSlug ref prevents double-apply)
    expect(setPropertySpy.mock.calls.length).toBe(callsAfterFirstRender);
  });
});
