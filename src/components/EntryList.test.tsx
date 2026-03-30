import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryList } from "./EntryList";
import type { ClipboardEntry, Collection } from "../types";

// jsdom doesn't implement IntersectionObserver — provide a no-op stub
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
vi.stubGlobal(
  "IntersectionObserver",
  vi.fn(() => ({ observe: mockObserve, disconnect: mockDisconnect }))
);

function makeEntry(overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  return {
    id: 1,
    content: "Hello world",
    content_type: "text",
    category: "other",
    source_app: null,
    window_title: null,
    is_favorite: false,
    created_at: "2024-01-01 12:00:00",
    collection_ids: "",
    alias: null,
    ...overrides,
  };
}

const collections: Collection[] = [];

const defaultProps = {
  entries: [makeEntry()],
  collections,
  loading: false,
  loadingMore: false,
  hasMore: false,
  onLoadMore: vi.fn(),
  search: "",
  selectedId: null,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onToggleFavorite: vi.fn(),
  onCopy: vi.fn(),
  colorFor: () => "#6b7280",
  labelFor: () => "Text",
};

describe("EntryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("shows loading text when loading=true", () => {
      render(<EntryList {...defaultProps} loading={true} entries={[]} />);
      expect(screen.getByText("list.loading")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when entries is empty and no search", () => {
      render(<EntryList {...defaultProps} entries={[]} />);
      expect(screen.getByText("list.empty")).toBeInTheDocument();
    });

    it("shows no_results message when entries is empty and there is a search", () => {
      render(<EntryList {...defaultProps} entries={[]} search="something" />);
      expect(screen.getByText("list.no_results")).toBeInTheDocument();
    });
  });

  describe("scroll-to-top button", () => {
    it("button is not visible initially (opacity-0 class)", () => {
      render(<EntryList {...defaultProps} />);
      const btn = screen.getByRole("button", { name: "Scroll to top" });
      expect(btn.className).toContain("opacity-0");
      expect(btn.className).toContain("pointer-events-none");
    });

    it("button becomes visible after scrollTop exceeds 200", async () => {
      render(<EntryList {...defaultProps} />);
      const btn = screen.getByRole("button", { name: "Scroll to top" });

      // The scroll container is the parent div of the button
      // We need to find the scrollable div and fire a scroll event with scrollTop > 200
      const scrollContainer = btn.parentElement?.querySelector(
        ".overflow-y-auto"
      ) as HTMLElement | null;

      expect(scrollContainer).toBeTruthy();

      // Simulate scroll by setting scrollTop and firing scroll event
      await act(async () => {
        Object.defineProperty(scrollContainer, "scrollTop", {
          writable: true,
          configurable: true,
          value: 201,
        });
        scrollContainer!.dispatchEvent(new Event("scroll"));
      });

      expect(btn.className).toContain("opacity-100");
      expect(btn.className).not.toContain("pointer-events-none");
    });

    it("clicking the button calls scrollTo on the scroll container", async () => {
      render(<EntryList {...defaultProps} />);
      const btn = screen.getByRole("button", { name: "Scroll to top" });

      const scrollContainer = btn.parentElement?.querySelector(
        ".overflow-y-auto"
      ) as HTMLElement | null;

      expect(scrollContainer).toBeTruthy();

      // Make button visible first
      await act(async () => {
        Object.defineProperty(scrollContainer, "scrollTop", {
          writable: true,
          configurable: true,
          value: 201,
        });
        scrollContainer!.dispatchEvent(new Event("scroll"));
      });

      const scrollToMock = vi.fn();
      scrollContainer!.scrollTo = scrollToMock;

      await userEvent.click(btn);

      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });
  });

  describe("entry rendering", () => {
    it("renders entries in the list", () => {
      render(
        <EntryList
          {...defaultProps}
          entries={[makeEntry({ id: 1, content: "Entry one" })]}
        />
      );
      expect(screen.getByText("Entry one")).toBeInTheDocument();
    });

    it("shows loading_more text when loadingMore=true", () => {
      render(<EntryList {...defaultProps} loadingMore={true} />);
      expect(screen.getByText("list.loading_more")).toBeInTheDocument();
    });
  });
});
