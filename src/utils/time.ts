import type { TFunction } from "i18next";

export function timeAgo(dateStr: string, t: TFunction, locale: string = "en"): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  // < 24 hours: relative time
  if (diff < 60)    return t("time.just_now");
  if (diff < 3600)  return t("time.minutes_ago", { count: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.hours_ago",   { count: Math.floor(diff / 3600) });

  // ≥ 24 hours: formatted date + time
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.getDate();
  const month = date.toLocaleString(locale, { month: "short" }).toLowerCase();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  if (sameYear) {
    return `${day} ${month} ${hours}:${minutes}`;
  }
  return `${day} ${month} ${date.getFullYear()} ${hours}:${minutes}`;
}
