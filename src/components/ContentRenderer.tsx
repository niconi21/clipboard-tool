import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
// Minimal dark theme inline — no external CSS import needed
const CODE_STYLES: Record<string, string> = {
  "hljs-keyword":   "color:#c792ea",
  "hljs-string":    "color:#c3e88d",
  "hljs-number":    "color:#f78c6c",
  "hljs-comment":   "color:#546e7a;font-style:italic",
  "hljs-function":  "color:#82aaff",
  "hljs-title":     "color:#82aaff",
  "hljs-built_in":  "color:#ffcb6b",
  "hljs-literal":   "color:#89ddff",
  "hljs-type":      "color:#ffcb6b",
  "hljs-attr":      "color:#f07178",
  "hljs-variable":  "color:#eeffff",
  "hljs-tag":       "color:#f07178",
  "hljs-name":      "color:#f07178",
  "hljs-selector-tag": "color:#f07178",
  "hljs-selector-class": "color:#82aaff",
  // Markdown-specific
  "hljs-section":   "color:#82aaff;font-weight:bold",
  "hljs-bullet":    "color:#f07178",
  "hljs-code":      "color:#c3e88d",
  "hljs-emphasis":  "font-style:italic",
  "hljs-strong":    "font-weight:bold",
  "hljs-link":      "color:#3b82f6",
};

interface Props {
  content: string;
  contentType: string;
}

export function ContentRenderer({ content, contentType }: Props) {
  switch (contentType) {
    case "url":      return <UrlRenderer content={content} />;
    case "email":    return <EmailRenderer content={content} />;
    case "phone":    return <PhoneRenderer content={content} />;
    case "color":    return <ColorRenderer content={content} />;
    case "code":     return <CodeRenderer content={content} />;
    case "json":     return <CodeRenderer content={content} language="json" />;
    case "sql":      return <CodeRenderer content={content} language="sql" />;
    case "shell":    return <CodeRenderer content={content} language="bash" />;
    case "markdown": return <CodeRenderer content={content} language="markdown" />;
    default:         return <PlainRenderer content={content} />;
  }
}

// ── URL ───────────────────────────────────────────────────────────────────────

/** Only allow http/https URLs through openUrl to prevent file://, javascript:, etc. */
function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function UrlRenderer({ content }: { content: string }) {
  const { t } = useTranslation();
  const url = content.trim();
  const allowed = isAllowedUrl(url);

  useEffect(() => {
    if (!allowed) {
      const scheme = (() => { try { return new URL(url).protocol; } catch { return "invalid"; } })();
      invoke("log_security_event", { event: "url_blocked", details: { scheme } }).catch(() => {});
    }
  }, [url, allowed]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-content font-mono break-all leading-relaxed select-text">
        {url}
      </p>
      {allowed ? (
        <button
          onClick={() => openUrl(url).catch(console.error)}
          className="flex items-center gap-2 self-start px-3 py-1.5 rounded bg-accent/15 border border-accent/30 text-accent-text text-xs hover:bg-accent/25 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          {t("content_renderer.open_browser")}
        </button>
      ) : (
        <span className="text-[11px] text-content-3">{t("content_renderer.non_http")}</span>
      )}
    </div>
  );
}

// ── Email ─────────────────────────────────────────────────────────────────────

function EmailRenderer({ content }: { content: string }) {
  const { t } = useTranslation();
  const email = content.trim();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-content font-mono break-all select-text">{email}</p>
      <button
        onClick={() => openUrl(`mailto:${email}`).catch(console.error)}
        className="flex items-center gap-2 self-start px-3 py-1.5 rounded bg-green-500/15 border border-green-500/30 text-green-300 text-xs hover:bg-green-500/25 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        {t("content_renderer.open_email")}
      </button>
    </div>
  );
}

// ── Phone ─────────────────────────────────────────────────────────────────────

function PhoneRenderer({ content }: { content: string }) {
  const phone = content.trim();
  return (
    <div className="flex items-center gap-3">
      <svg className="w-5 h-5 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
      <span className="text-lg text-content font-mono tracking-wide select-text">{phone}</span>
    </div>
  );
}

// ── Color ─────────────────────────────────────────────────────────────────────

function ColorRenderer({ content }: { content: string }) {
  const value = content.trim();
  return (
    <div className="flex flex-col gap-4 items-start">
      <div
        className="w-full h-24 rounded-lg border border-stroke shadow-inner"
        style={{ backgroundColor: value }}
      />
      <span className="text-sm text-content font-mono select-text">{value}</span>
    </div>
  );
}

// ── Code ──────────────────────────────────────────────────────────────────────

function CodeRenderer({ content, language }: { content: string; language?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    el.removeAttribute("data-highlighted");
    import("highlight.js").then(({ default: hljs }) => {
      hljs.highlightElement(el);
      // Apply inline color styles from our map
      el.querySelectorAll<HTMLElement>("[class]").forEach((node) => {
        for (const cls of Array.from(node.classList)) {
          if (CODE_STYLES[cls]) {
            node.style.cssText = CODE_STYLES[cls];
            break;
          }
        }
      });
    });
  }, [content, language]);

  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all select-text">
      <code ref={ref} className={language ? `language-${language}` : undefined}>{content}</code>
    </pre>
  );
}

// ── Plain text ────────────────────────────────────────────────────────────────

function PlainRenderer({ content }: { content: string }) {
  return (
    <pre className="text-xs text-content font-mono whitespace-pre-wrap break-all leading-relaxed select-text">
      {content}
    </pre>
  );
}
