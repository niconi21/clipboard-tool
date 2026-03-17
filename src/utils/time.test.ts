import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timeAgo } from "./time";
import type { TFunction } from "i18next";

// Simple t() mock that returns a string we can assert on
const t = ((key: string, opts?: { count?: number }) =>
  opts?.count !== undefined ? `${key}:${opts.count}` : key) as unknown as TFunction;

describe("timeAgo", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns just_now for diff < 60s", () => {
    vi.setSystemTime(new Date("2024-06-15T12:00:30Z"));
    expect(timeAgo("2024-06-15 12:00:00", t)).toBe("time.just_now");
  });

  it("returns minutes_ago for diff < 1h", () => {
    vi.setSystemTime(new Date("2024-06-15T12:15:00Z"));
    expect(timeAgo("2024-06-15 12:00:00", t)).toBe("time.minutes_ago:15");
  });

  it("returns hours_ago for diff < 24h", () => {
    vi.setSystemTime(new Date("2024-06-15T15:00:00Z"));
    expect(timeAgo("2024-06-15 12:00:00", t)).toBe("time.hours_ago:3");
  });

  it("formats same-year date without year", () => {
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    // Entry from 2 days ago, same year
    const result = timeAgo("2024-06-13 14:30:00", t);
    // Should contain day, month abbreviation, time — but NOT the year
    expect(result).toContain("13");
    expect(result).toContain("14:30");
    expect(result).not.toContain("2024");
  });

  it("formats different-year date with year", () => {
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
    const result = timeAgo("2023-12-25 08:00:00", t);
    expect(result).toContain("2023");
    expect(result).toContain("25");
    expect(result).toContain("08:00");
  });

  it("formats minutes correctly with zero-padding", () => {
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    const result = timeAgo("2024-06-14 09:05:00", t); // same year, > 24h, time 09:05
    expect(result).toContain("09:05");
  });

  it("uses locale for month name", () => {
    // Use a January date: "jan" (en) vs "ene" (es) so the results differ
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    const resultEn = timeAgo("2024-01-13 10:00:00", t, "en");
    const resultEs = timeAgo("2024-01-13 10:00:00", t, "es");
    // Month names differ between locales for January
    expect(resultEn).not.toBe(resultEs);
  });
});
