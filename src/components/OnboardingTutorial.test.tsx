import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingTutorial } from "./OnboardingTutorial";

// jsdom doesn't implement ResizeObserver — provide a no-op stub
vi.stubGlobal(
  "ResizeObserver",
  vi.fn(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }))
);

const defaultProps = {
  onComplete: vi.fn(),
  onSkip: vi.fn(),
  onOpenSettings: vi.fn(),
  onCloseSettings: vi.fn(),
  onSetSettingsTab: vi.fn(),
};

// STEPS array has 12 steps (0–11). Step 0 = welcome, step 11 = last.
const TOTAL_STEPS = 12;

describe("OnboardingTutorial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("welcome step (step 0)", () => {
    it("renders with Skip and Start buttons", () => {
      render(<OnboardingTutorial {...defaultProps} />);
      expect(screen.getByRole("button", { name: "onboarding.skip" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "onboarding.start" })).toBeInTheDocument();
    });

    it("renders the title and description from i18n keys", () => {
      render(<OnboardingTutorial {...defaultProps} />);
      expect(screen.getByText("onboarding.s0_title")).toBeInTheDocument();
      expect(screen.getByText("onboarding.s0_desc")).toBeInTheDocument();
    });

    it("calls onSkip when Skip button is clicked", async () => {
      const onSkip = vi.fn();
      render(<OnboardingTutorial {...defaultProps} onSkip={onSkip} />);
      await userEvent.click(screen.getByRole("button", { name: "onboarding.skip" }));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("advances to step 1 when Start button is clicked", async () => {
      render(<OnboardingTutorial {...defaultProps} />);
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      // After step 0 we are on step 1 — the welcome overlay should be gone
      expect(screen.queryByRole("button", { name: "onboarding.start" })).not.toBeInTheDocument();
      // Step indicator "1/11" should be visible
      expect(screen.getByText(`1/${TOTAL_STEPS - 1}`)).toBeInTheDocument();
    });
  });

  describe("non-welcome steps", () => {
    async function advanceTo(step: number) {
      render(<OnboardingTutorial {...defaultProps} />);
      // Click Start to leave welcome
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      // Click Next (step - 1) more times
      for (let i = 1; i < step; i++) {
        const nextBtn = screen.getByRole("button", { name: "onboarding.next" });
        await userEvent.click(nextBtn);
      }
    }

    it("shows Next button on non-last steps", async () => {
      await advanceTo(1);
      expect(screen.getByRole("button", { name: "onboarding.next" })).toBeInTheDocument();
    });

    it("clicking Next advances to the next step", async () => {
      await advanceTo(1);
      expect(screen.getByText(`1/${TOTAL_STEPS - 1}`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "onboarding.next" }));
      expect(screen.getByText(`2/${TOTAL_STEPS - 1}`)).toBeInTheDocument();
    });

    it("shows onboarding.finish on last step", async () => {
      // Advance through all steps to the last one (step 11)
      await advanceTo(TOTAL_STEPS - 1);
      expect(screen.getByRole("button", { name: "onboarding.finish" })).toBeInTheDocument();
    });

    it("calls onComplete when finish button is clicked on last step", async () => {
      const onComplete = vi.fn();
      render(<OnboardingTutorial {...defaultProps} onComplete={onComplete} />);
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      for (let i = 1; i < TOTAL_STEPS - 1; i++) {
        await userEvent.click(screen.getByRole("button", { name: "onboarding.next" }));
      }
      await userEvent.click(screen.getByRole("button", { name: "onboarding.finish" }));
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("calls onSkip when Skip button is clicked on a non-last step", async () => {
      const onSkip = vi.fn();
      render(<OnboardingTutorial {...defaultProps} onSkip={onSkip} />);
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      await userEvent.click(screen.getByRole("button", { name: "onboarding.skip" }));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });

  describe("settings open/close callbacks", () => {
    it("calls onOpenSettings when advancing to a step that requires settings open", async () => {
      const onOpenSettings = vi.fn();
      render(<OnboardingTutorial {...defaultProps} onOpenSettings={onOpenSettings} />);

      // Steps 0–4 have no openSettings flag; step 5 does (openSettings: true)
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      onOpenSettings.mockClear();

      for (let i = 1; i < 5; i++) {
        await userEvent.click(screen.getByRole("button", { name: "onboarding.next" }));
      }
      // Now at step 5 which has openSettings: true
      expect(onOpenSettings).toHaveBeenCalled();
    });

    it("calls onCloseSettings when advancing to a step that has no openSettings flag", async () => {
      const onCloseSettings = vi.fn();
      render(<OnboardingTutorial {...defaultProps} onCloseSettings={onCloseSettings} />);

      // Step 0 (welcome) fires the effect — we clear after that
      await act(async () => {});
      onCloseSettings.mockClear();

      // Click Start → step 1 (no openSettings) → onCloseSettings should fire
      await userEvent.click(screen.getByRole("button", { name: "onboarding.start" }));
      expect(onCloseSettings).toHaveBeenCalled();
    });
  });
});
