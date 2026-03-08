import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../types";

function applyTheme(theme: Theme) {
  const root = document.documentElement.style;
  root.setProperty("--color-base",           theme.base);
  root.setProperty("--color-surface",        theme.surface);
  root.setProperty("--color-surface-raised", theme.surface_raised);
  root.setProperty("--color-surface-active", theme.surface_active);
  root.setProperty("--color-stroke",         theme.stroke);
  root.setProperty("--color-stroke-strong",  theme.stroke_strong);
  root.setProperty("--color-content",        theme.content);
  root.setProperty("--color-content-2",      theme.content_2);
  root.setProperty("--color-content-3",      theme.content_3);
  root.setProperty("--color-accent",         theme.accent);
  root.setProperty("--color-accent-text",    theme.accent_text);
}

// themes list comes from bootstrap — no internal fetch.
// activeSlug comes from settings — only applies CSS vars when it changes.
export function useTheme(themes: Theme[], activeSlug: string) {
  const [activeTheme, setActiveTheme] = useState<Theme | null>(null);
  const appliedSlug = useRef<string | null>(null);

  useEffect(() => {
    if (themes.length === 0) return;
    const theme = themes.find((t) => t.slug === activeSlug) ?? themes[0];
    if (theme && appliedSlug.current !== theme.slug) {
      appliedSlug.current = theme.slug;
      applyTheme(theme);
      setActiveTheme(theme);
    }
  }, [activeSlug, themes]);

  const setTheme = useCallback((slug: string) => {
    const theme = themes.find((t) => t.slug === slug);
    if (!theme) return;
    appliedSlug.current = slug;
    applyTheme(theme);
    setActiveTheme(theme);
    invoke("set_active_theme", { slug }).catch(console.error);
  }, [themes]);

  return { activeTheme, setTheme };
}
