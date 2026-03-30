import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionsManager } from "./CollectionsManager";
import type { Collection, ContentTypeStyle, CollectionRule, Subcollection } from "../types";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: "Existing",
    color: "#3b82f6",
    is_builtin: false,
    created_at: "2024-01-01",
    ...overrides,
  };
}

const defaultProps = {
  collections: [makeCollection()],
  contentTypes: [] as ContentTypeStyle[],
  counts: {} as Record<number, number>,
  collectionRules: [] as CollectionRule[],
  subcollections: [] as Subcollection[],
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onCreateRule: vi.fn(),
  onDeleteRule: vi.fn(),
  onToggleRule: vi.fn(),
  onCreateSubcollection: vi.fn(),
  onRenameSubcollection: vi.fn(),
  onDeleteSubcollection: vi.fn(),
};

describe("CollectionsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Add button disabled state", () => {
    it("is disabled when name is empty", () => {
      render(<CollectionsManager {...defaultProps} />);
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is enabled when name is unique and non-empty", async () => {
      render(<CollectionsManager {...defaultProps} />);
      const input = screen.getByPlaceholderText("collections_mgr.name_placeholder");
      await userEvent.type(input, "New Collection");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).not.toBeDisabled();
    });

    it("is disabled when name matches an existing collection (case-insensitive)", async () => {
      render(
        <CollectionsManager
          {...defaultProps}
          collections={[makeCollection({ name: "Favorites" })]}
        />
      );
      const input = screen.getByPlaceholderText("collections_mgr.name_placeholder");
      await userEvent.type(input, "favorites");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });
  });

  describe("Duplicate name error message", () => {
    it("shows error message when duplicate name is entered", async () => {
      render(
        <CollectionsManager
          {...defaultProps}
          collections={[makeCollection({ name: "Work" })]}
        />
      );
      const input = screen.getByPlaceholderText("collections_mgr.name_placeholder");
      await userEvent.type(input, "Work");
      expect(screen.getByText("validation.duplicate_name")).toBeInTheDocument();
    });

    it("does not show error message for unique name", async () => {
      render(<CollectionsManager {...defaultProps} />);
      const input = screen.getByPlaceholderText("collections_mgr.name_placeholder");
      await userEvent.type(input, "Personal");
      expect(screen.queryByText("validation.duplicate_name")).not.toBeInTheDocument();
    });

    it("does not show error message when name is empty", () => {
      render(<CollectionsManager {...defaultProps} />);
      expect(screen.queryByText("validation.duplicate_name")).not.toBeInTheDocument();
    });
  });

  describe("handleCreate", () => {
    it("calls onCreate with name and color when Add is clicked", async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(
        <CollectionsManager
          {...defaultProps}
          collections={[]}
          onCreate={onCreate}
        />
      );
      const input = screen.getByPlaceholderText("collections_mgr.name_placeholder");
      await userEvent.type(input, "My Collection");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      await userEvent.click(addBtn);
      expect(onCreate).toHaveBeenCalledWith("My Collection", expect.any(String));
    });
  });
});
