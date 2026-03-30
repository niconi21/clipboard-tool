import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoriesManager } from "./CategoriesManager";
import type { Category, ContextRule } from "../types";

function makeCat(overrides: Partial<Category> = {}): Category {
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
  categories: [makeCat()],
  contextRules: [] as ContextRule[],
  onCreateCategory: vi.fn(),
  onUpdateCategory: vi.fn(),
  onDeleteCategory: vi.fn(),
  onCreateRule: vi.fn(),
  onDeleteRule: vi.fn(),
  onToggleRule: vi.fn(),
};

describe("CategoriesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Add button disabled state", () => {
    it("is disabled when name is empty", () => {
      render(<CategoriesManager {...defaultProps} />);
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is enabled when name is unique and non-empty", async () => {
      render(<CategoriesManager {...defaultProps} />);
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "New Category");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).not.toBeDisabled();
    });

    it("is disabled when name matches an existing category (case-insensitive)", async () => {
      render(<CategoriesManager {...defaultProps} categories={[makeCat({ name: "Work" })]} />);
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "work");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is disabled when name matches an existing category in different case", async () => {
      render(<CategoriesManager {...defaultProps} categories={[makeCat({ name: "Work" })]} />);
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "WORK");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });
  });

  describe("Duplicate name error message", () => {
    it("shows error message when duplicate name is entered", async () => {
      render(<CategoriesManager {...defaultProps} categories={[makeCat({ name: "Work" })]} />);
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "Work");
      expect(screen.getByText("validation.duplicate_name")).toBeInTheDocument();
    });

    it("does not show error message when name is unique", async () => {
      render(<CategoriesManager {...defaultProps} categories={[makeCat({ name: "Work" })]} />);
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "Personal");
      expect(screen.queryByText("validation.duplicate_name")).not.toBeInTheDocument();
    });

    it("does not show error message when name is empty", () => {
      render(<CategoriesManager {...defaultProps} />);
      expect(screen.queryByText("validation.duplicate_name")).not.toBeInTheDocument();
    });
  });

  describe("handleCreate", () => {
    it("calls onCreateCategory with trimmed name when Add is clicked", async () => {
      const onCreateCategory = vi.fn().mockResolvedValue(undefined);
      render(
        <CategoriesManager
          {...defaultProps}
          categories={[]}
          onCreateCategory={onCreateCategory}
        />
      );
      const input = screen.getByPlaceholderText("categories_mgr.name_placeholder");
      await userEvent.type(input, "My Category");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      await userEvent.click(addBtn);
      expect(onCreateCategory).toHaveBeenCalledWith("My Category", expect.any(String));
    });

    it("does not call onCreateCategory when name is empty", async () => {
      const onCreateCategory = vi.fn().mockResolvedValue(undefined);
      render(<CategoriesManager {...defaultProps} onCreateCategory={onCreateCategory} />);
      const addBtn = screen.getByRole("button", { name: "common.add" });
      await userEvent.click(addBtn);
      expect(onCreateCategory).not.toHaveBeenCalled();
    });
  });
});
