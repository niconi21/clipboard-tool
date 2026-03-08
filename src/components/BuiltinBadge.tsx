import { useTranslation } from "react-i18next";

interface Props {
  size?: "sm" | "md";
}

export function BuiltinBadge({ size = "md" }: Props) {
  const { t } = useTranslation();
  const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <span title={t("builtin.tooltip")} className="p-1 shrink-0">
      <svg className={`${iconClass} text-content-3`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    </span>
  );
}
