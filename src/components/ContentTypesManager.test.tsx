import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentTypesManager } from "./ContentTypesManager";
import type { ContentTypeStyle, ContentRule } from "../types";

function makeType(overrides: Partial<ContentTypeStyle> = {}): ContentTypeStyle {
  return {
    name: "text",
    label: "Text",
    color: "#6b7280",
    is_builtin: true,
    ...overrides,
  };
}

const defaultProps = {
  contentTypes: [makeType()],
  rules: [] as ContentRule[],
  onColorChange: vi.fn(),
  onCreateType: vi.fn(),
  onDeleteType: vi.fn(),
  onCreateRule: vi.fn(),
  onDeleteRule: vi.fn(),
  onToggleRule: vi.fn(),
};

describe("ContentTypesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Add button disabled state", () => {
    it("is disabled when both name and label are empty", () => {
      render(<ContentTypesManager {...defaultProps} />);
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is disabled when name is filled but label is empty", async () => {
      render(<ContentTypesManager {...defaultProps} />);
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      await userEvent.type(nameInput, "mytype");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is disabled when label is filled but name is empty", async () => {
      render(<ContentTypesManager {...defaultProps} />);
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(labelInput, "My Type");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is enabled when both name and label are filled with unique values", async () => {
      render(<ContentTypesManager {...defaultProps} />);
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(nameInput, "mytype");
      await userEvent.type(labelInput, "My Type");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).not.toBeDisabled();
    });

    it("is disabled when name matches an existing content type (case-insensitive)", async () => {
      render(
        <ContentTypesManager
          {...defaultProps}
          contentTypes={[makeType({ name: "url", label: "URL" })]}
        />
      );
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(nameInput, "URL");
      await userEvent.type(labelInput, "My Link");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });

    it("is disabled when label matches an existing content type label (case-insensitive)", async () => {
      render(
        <ContentTypesManager
          {...defaultProps}
          contentTypes={[makeType({ name: "url", label: "URL" })]}
        />
      );
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(nameInput, "myurl");
      await userEvent.type(labelInput, "url");
      const addBtn = screen.getByRole("button", { name: "common.add" });
      expect(addBtn).toBeDisabled();
    });
  });

  describe("Duplicate name error", () => {
    it("shows error for duplicate name", async () => {
      render(
        <ContentTypesManager
          {...defaultProps}
          contentTypes={[makeType({ name: "code", label: "Code" })]}
        />
      );
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      await userEvent.type(nameInput, "code");
      expect(screen.getByText("validation.duplicate_id")).toBeInTheDocument();
    });

    it("shows error for duplicate label", async () => {
      render(
        <ContentTypesManager
          {...defaultProps}
          contentTypes={[makeType({ name: "code", label: "Code" })]}
        />
      );
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(labelInput, "Code");
      expect(screen.getByText("validation.duplicate_name")).toBeInTheDocument();
    });
  });

  describe("handleCreateType", () => {
    it("calls onCreateType with name, label, and color when Add is clicked", async () => {
      const onCreateType = vi.fn().mockResolvedValue(undefined);
      render(
        <ContentTypesManager
          {...defaultProps}
          contentTypes={[]}
          onCreateType={onCreateType}
        />
      );
      const nameInput = screen.getByPlaceholderText("content_types_mgr.name_placeholder");
      const labelInput = screen.getByPlaceholderText("content_types_mgr.label_placeholder");
      await userEvent.type(nameInput, "mytype");
      await userEvent.type(labelInput, "My Type");
      await userEvent.click(screen.getByRole("button", { name: "common.add" }));
      expect(onCreateType).toHaveBeenCalledWith("mytype", "My Type", expect.any(String));
    });
  });
});
