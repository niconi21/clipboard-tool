import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubcollectionPanel } from "./SubcollectionPanel";
import { invoke } from "@tauri-apps/api/core";
import type { Subcollection } from "../types";

const mockInvoke = vi.mocked(invoke);

function makeSub(overrides: Partial<Subcollection> = {}): Subcollection {
  return {
    id: 1,
    collection_id: 10,
    name: "Sub 1",
    is_default: false,
    created_at: "2024-01-01",
    ...overrides,
  };
}

const defaultProps = {
  collectionId: 10,
  subcollections: [],
  activeSubcollection: null,
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

describe("SubcollectionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default counts returns empty (all zeros)
    mockInvoke.mockResolvedValue([]);
  });

  describe("default subcollection visibility", () => {
    it("hides the default subcollection when its count is 0", async () => {
      const defaultSub = makeSub({ id: 5, name: "Inbox", is_default: true });
      mockInvoke.mockResolvedValue([[5, 0]]);

      await act(async () => {
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[defaultSub]}
          />
        );
      });

      // The default subcollection with count 0 should not appear
      expect(screen.queryByText("subcollections.default_name")).not.toBeInTheDocument();
    });

    it("shows the default subcollection when its count is greater than 0", async () => {
      const defaultSub = makeSub({ id: 5, name: "Inbox", is_default: true });
      mockInvoke.mockResolvedValue([[5, 3]]);

      await act(async () => {
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[defaultSub]}
          />
        );
      });

      // The default subcollection should be visible using its translated name
      expect(screen.getByText("subcollections.default_name")).toBeInTheDocument();
    });

    it("shows non-default subcollections regardless of count", async () => {
      const regularSub = makeSub({ id: 7, name: "Archive", is_default: false });
      // count = 0 for the non-default subcollection
      mockInvoke.mockResolvedValue([[7, 0]]);

      await act(async () => {
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[regularSub]}
          />
        );
      });

      expect(screen.getByText("Archive")).toBeInTheDocument();
    });
  });

  describe("auto-navigate when default subcollection count drops to 0", () => {
    it("calls onSelect(null) when active default subcollection count drops to 0 via refreshKey change", async () => {
      const onSelect = vi.fn();
      const defaultSub = makeSub({ id: 5, name: "Inbox", is_default: true });

      // Initial render: count > 0
      mockInvoke.mockResolvedValue([[5, 2]]);

      const { rerender } = await act(async () =>
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[defaultSub]}
            activeSubcollection={5}
            onSelect={onSelect}
            refreshKey={0}
          />
        )
      );

      // Now simulate refreshKey change which triggers new count fetch returning 0
      mockInvoke.mockResolvedValue([[5, 0]]);

      await act(async () => {
        rerender(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[defaultSub]}
            activeSubcollection={5}
            onSelect={onSelect}
            refreshKey={1}
          />
        );
      });

      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it("does not call onSelect(null) when active non-default subcollection count drops to 0", async () => {
      const onSelect = vi.fn();
      const regularSub = makeSub({ id: 7, name: "Archive", is_default: false });

      mockInvoke.mockResolvedValue([[7, 2]]);

      const { rerender } = await act(async () =>
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[regularSub]}
            activeSubcollection={7}
            onSelect={onSelect}
            refreshKey={0}
          />
        )
      );

      mockInvoke.mockResolvedValue([[7, 0]]);

      await act(async () => {
        rerender(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[regularSub]}
            activeSubcollection={7}
            onSelect={onSelect}
            refreshKey={1}
          />
        );
      });

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("All button", () => {
    it("renders the All button", async () => {
      await act(async () => {
        render(<SubcollectionPanel {...defaultProps} />);
      });

      expect(screen.getByText("subcollections.all")).toBeInTheDocument();
    });

    it("calls onSelect(null) when All button is clicked", async () => {
      const onSelect = vi.fn();
      await act(async () => {
        render(
          <SubcollectionPanel
            {...defaultProps}
            activeSubcollection={5}
            onSelect={onSelect}
          />
        );
      });

      await userEvent.click(screen.getByText("subcollections.all"));
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe("subcollection selection", () => {
    it("calls onSelect with the subcollection id when clicked", async () => {
      const onSelect = vi.fn();
      const sub = makeSub({ id: 7, name: "Work", is_default: false });
      mockInvoke.mockResolvedValue([[7, 5]]);

      await act(async () => {
        render(
          <SubcollectionPanel
            {...defaultProps}
            subcollections={[sub]}
            onSelect={onSelect}
          />
        );
      });

      await userEvent.click(screen.getByText("Work"));
      expect(onSelect).toHaveBeenCalledWith(7);
    });
  });
});
