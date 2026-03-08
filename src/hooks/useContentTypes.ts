import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ContentTypeStyle } from "../types";

const FALLBACK_COLOR = "#6b7280";

// initial comes from bootstrap. If provided, no fetch on mount.
export function useContentTypes(initial?: ContentTypeStyle[]) {
  const [contentTypes, setContentTypes] = useState<ContentTypeStyle[]>(initial ?? []);

  // Sync when bootstrap data arrives (transitions from undefined → array)
  useEffect(() => {
    if (initial && initial.length > 0) setContentTypes(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const refresh = useCallback(() => {
    invoke<ContentTypeStyle[]>("get_content_types")
      .then(setContentTypes)
      .catch((e) => console.error("[useContentTypes]", e));
  }, []);

  // Only fetch independently if not seeded from bootstrap
  useEffect(() => {
    if (!initial || initial.length === 0) refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colorFor = useCallback(
    (name: string): string => contentTypes.find((ct) => ct.name === name)?.color ?? FALLBACK_COLOR,
    [contentTypes],
  );

  const labelFor = useCallback(
    (name: string): string => contentTypes.find((ct) => ct.name === name)?.label ?? name,
    [contentTypes],
  );

  return { contentTypes, colorFor, labelFor, refresh };
}
