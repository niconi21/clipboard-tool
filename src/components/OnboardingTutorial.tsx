import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Step {
  target: string | null; // data-tour attribute value, null = welcome (centered modal)
  titleKey: string;
  descKey: string;
}

const STEPS: Step[] = [
  { target: null,           titleKey: "onboarding.s0_title", descKey: "onboarding.s0_desc" },
  { target: "entry-list",   titleKey: "onboarding.s1_title", descKey: "onboarding.s1_desc" },
  { target: "search-bar",   titleKey: "onboarding.s2_title", descKey: "onboarding.s2_desc" },
  { target: "tabs",         titleKey: "onboarding.s3_title", descKey: "onboarding.s3_desc" },
  { target: "settings-btn", titleKey: "onboarding.s4_title", descKey: "onboarding.s4_desc" },
];

const PAD = 8;

interface Rect { top: number; left: number; width: number; height: number; }

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingTutorial({ onComplete, onSkip }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isWelcome = current.target === null;

  // Find target element and track its rect
  useEffect(() => {
    if (!current.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    if (!el) { setRect(null); return; }
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, [step, current.target]);

  function advance() {
    if (isLast) onComplete();
    else setStep((s) => s + 1);
  }

  // Compute tooltip position relative to spotlight rect
  function tooltipStyle(): React.CSSProperties {
    if (!rect || !tooltipRef.current) return { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
    const TOOLTIP_H = 120;
    const TOOLTIP_W = 280;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const spaceBelow = viewH - (rect.top + rect.height + PAD);
    const spaceAbove = rect.top - PAD;

    let top: number;
    if (spaceBelow >= TOOLTIP_H + 16) {
      top = rect.top + rect.height + PAD + 8;
    } else if (spaceAbove >= TOOLTIP_H + 16) {
      top = rect.top - PAD - TOOLTIP_H - 8;
    } else {
      top = rect.top + rect.height / 2 - TOOLTIP_H / 2;
    }

    let left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    left = Math.max(12, Math.min(viewW - TOOLTIP_W - 12, left));

    return { position: "fixed", top, left, width: TOOLTIP_W, zIndex: 52 };
  }

  if (isWelcome) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-surface border border-stroke rounded-xl shadow-xl p-6 w-72 space-y-4">
          <div className="text-center space-y-1">
            <div className="text-2xl mb-2">📋</div>
            <p className="text-base font-semibold text-content">{t(current.titleKey)}</p>
            <p className="text-xs text-content-2 leading-relaxed">{t(current.descKey)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSkip}
              className="flex-1 px-3 py-2 text-xs text-content-3 hover:text-content border border-stroke rounded-lg transition-colors"
            >
              {t("onboarding.skip")}
            </button>
            <button
              onClick={advance}
              className="flex-1 px-3 py-2 text-xs font-medium bg-accent text-accent-text rounded-lg hover:opacity-90 transition-opacity"
            >
              {t("onboarding.start")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Dim overlay — click to advance */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "transparent" }}
        onClick={advance}
      />

      {/* Spotlight cutout */}
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            zIndex: 51,
            pointerEvents: "none",
            transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
          }}
        />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} style={tooltipStyle()} className="z-[52]">
        <div className="bg-surface border border-stroke rounded-xl shadow-xl p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-content">{t(current.titleKey)}</p>
              <span className="text-[10px] text-content-3">{step}/{STEPS.length - 1}</span>
            </div>
            <p className="text-xs text-content-2 leading-relaxed">{t(current.descKey)}</p>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={(e) => { e.stopPropagation(); onSkip(); }}
              className="text-[11px] text-content-3 hover:text-content transition-colors"
            >
              {t("onboarding.skip")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); advance(); }}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-text rounded-lg hover:opacity-90 transition-opacity"
            >
              {isLast ? t("onboarding.finish") : t("onboarding.next")}
            </button>
          </div>
        </div>
        {/* Arrow indicator pointing at spotlight */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-surface border-l border-t border-stroke rotate-45"
          style={{ top: -6 }}
        />
      </div>
    </>
  );
}
