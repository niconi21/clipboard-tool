import type { TFunction } from "i18next";

export function timeAgo(dateStr: string, t: TFunction): string {
  const diff = Math.floor((Date.now() - new Date(dateStr + "Z").getTime()) / 1000);
  if (diff < 60)    return t("time.just_now");
  if (diff < 3600)  return t("time.minutes_ago", { count: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.hours_ago",   { count: Math.floor(diff / 3600) });
  return t("time.days_ago", { count: Math.floor(diff / 86400) });
}
