import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryItem } from "./EntryItem";
import { invoke } from "@tauri-apps/api/core";
import type { ClipboardEntry, Collection } from "../types";

const mockInvoke = vi.mocked(invoke);

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

const collections: Collection[] = [
  { id: 10, name: "Work", color: "#3b82f6", is_builtin: false, created_at: "2024-01-01" },
  { id: 20, name: "Favorites", color: "#f59e0b", is_builtin: true, created_at: "2024-01-01" },
];

const colorFor = (name: string) => (name === "text" ? "#6b7280" : "#3b82f6");
const labelFor = (name: string) => (name === "text" ? "Text" : "URL");

const defaultProps = {
  collections,
  isSelected: false,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onToggleFavorite: vi.fn(),
  onCopy: vi.fn(),
  colorFor,
  labelFor,
};

describe("EntryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(null);
  });

  describe("content rendering", () => {
    it("renders content text", () => {
      render(<EntryItem entry={makeEntry()} {...defaultProps} />);
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("renders content type badge", () => {
      render(<EntryItem entry={makeEntry()} {...defaultProps} />);
      expect(screen.getByText("Text")).toBeInTheDocument();
    });

    it("renders alias when provided", () => {
      render(<EntryItem entry={makeEntry({ alias: "My label" })} {...defaultProps} />);
      expect(screen.getByText("My label")).toBeInTheDocument();
    });

    it("renders source_app when provided", () => {
      render(<EntryItem entry={makeEntry({ source_app: "VS Code" })} {...defaultProps} />);
      expect(screen.getByText("VS Code")).toBeInTheDocument();
    });

    it("does not render source_app section when null", () => {
      render(<EntryItem entry={makeEntry({ source_app: null })} {...defaultProps} />);
      expect(screen.queryByText("VS Code")).not.toBeInTheDocument();
    });

    it("replaces newlines with visual indicator in content preview", () => {
      render(<EntryItem entry={makeEntry({ content: "line1\nline2" })} {...defaultProps} />);
      // Newlines are replaced with " ↵ " in the preview
      expect(screen.getByText(/line1.*↵.*line2/)).toBeInTheDocument();
    });
  });

  describe("collection chips", () => {
    it("renders collection chips when entry belongs to collections", () => {
      render(
        <EntryItem
          entry={makeEntry({ collection_ids: "10,20" })}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Work")).toBeInTheDocument();
      expect(screen.getByText("Favorites")).toBeInTheDocument();
    });

    it("does not render chips when collection_ids is empty", () => {
      render(
        <EntryItem
          entry={makeEntry({ collection_ids: "" })}
          {...defaultProps}
        />
      );
      expect(screen.queryByText("Work")).not.toBeInTheDocument();
    });

    it("ignores invalid collection ids (not found in list)", () => {
      render(
        <EntryItem
          entry={makeEntry({ collection_ids: "999" })}
          {...defaultProps}
        />
      );
      // 999 doesn't exist in collections list — no chip rendered
      expect(screen.queryByText("Work")).not.toBeInTheDocument();
    });
  });

  describe("selection state", () => {
    it("applies selected style when isSelected=true", () => {
      const { container } = render(<EntryItem entry={makeEntry()} {...defaultProps} isSelected={true} />);
      const root = container.firstChild as HTMLElement;
      expect(root.className).toContain("bg-surface-active");
    });

    it("does not apply selected style when isSelected=false", () => {
      const { container } = render(<EntryItem entry={makeEntry()} {...defaultProps} isSelected={false} />);
      const root = container.firstChild as HTMLElement;
      expect(root.className).not.toContain("bg-surface-active");
    });
  });

  describe("interactions", () => {
    it("calls onSelect when item is clicked", async () => {
      const onSelect = vi.fn();
      const entry = makeEntry();
      render(<EntryItem entry={entry} {...defaultProps} onSelect={onSelect} />);

      await userEvent.click(screen.getByText("Hello world"));
      expect(onSelect).toHaveBeenCalledWith(entry);
    });

    it("calls onCopy when copy button is clicked", async () => {
      const onCopy = vi.fn();
      const entry = makeEntry();
      render(<EntryItem entry={entry} {...defaultProps} onCopy={onCopy} />);

      const copyBtn = screen.getByTitle("entry.copy");
      await userEvent.click(copyBtn);
      expect(onCopy).toHaveBeenCalledWith(entry);
    });

    it("calls onToggleFavorite when favorite button is clicked", async () => {
      const onToggleFavorite = vi.fn();
      render(
        <EntryItem
          entry={makeEntry()}
          {...defaultProps}
          onToggleFavorite={onToggleFavorite}
        />
      );

      const favBtn = screen.getByTitle("entry.add_favorite");
      await userEvent.click(favBtn);
      expect(onToggleFavorite).toHaveBeenCalledWith(1);
    });

    it("calls onDelete when delete button is clicked", async () => {
      const onDelete = vi.fn();
      render(<EntryItem entry={makeEntry()} {...defaultProps} onDelete={onDelete} />);

      const deleteBtn = screen.getByTitle("entry.delete");
      await userEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalledWith(1);
    });

    it("does not call onSelect when copy button is clicked (stopPropagation)", async () => {
      const onSelect = vi.fn();
      render(<EntryItem entry={makeEntry()} {...defaultProps} onSelect={onSelect} />);

      const copyBtn = screen.getByTitle("entry.copy");
      await userEvent.click(copyBtn);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("does not call onSelect when delete button is clicked (stopPropagation)", async () => {
      const onSelect = vi.fn();
      render(<EntryItem entry={makeEntry()} {...defaultProps} onSelect={onSelect} />);

      const deleteBtn = screen.getByTitle("entry.delete");
      await userEvent.click(deleteBtn);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("favorite state", () => {
    it("shows 'remove_favorite' title when entry is favorite", () => {
      render(<EntryItem entry={makeEntry({ is_favorite: true })} {...defaultProps} />);
      expect(screen.getByTitle("entry.remove_favorite")).toBeInTheDocument();
    });

    it("shows 'add_favorite' title when entry is not favorite", () => {
      render(<EntryItem entry={makeEntry({ is_favorite: false })} {...defaultProps} />);
      expect(screen.getByTitle("entry.add_favorite")).toBeInTheDocument();
    });
  });

  describe("drag handle", () => {
    it("renders drag handle when onDragStart is provided", () => {
      const { container } = render(
        <EntryItem
          entry={makeEntry()}
          {...defaultProps}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
        />
      );
      // The drag handle contains 6 circles
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBe(6);
    });

    it("does not render drag handle when onDragStart is not provided", () => {
      const { container } = render(<EntryItem entry={makeEntry()} {...defaultProps} />);
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBe(0);
    });
  });
});
