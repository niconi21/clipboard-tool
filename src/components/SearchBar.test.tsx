import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "./SearchBar";
import { EMPTY_FILTERS } from "../hooks/useClipboard";
import type { ContentTypeStyle } from "../types";

const noopFilters = EMPTY_FILTERS;
const contentTypes: ContentTypeStyle[] = [
  { name: "url", label: "URL", color: "#3b82f6", is_builtin: true },
];

describe("SearchBar", () => {
  it("renders search input", () => {
    render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("displays current search value", () => {
    render(
      <SearchBar
        value="hello world"
        onChange={vi.fn()}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );
    expect(screen.getByDisplayValue("hello world")).toBeInTheDocument();
  });

  it("calls onChange when user types", async () => {
    const onChange = vi.fn();
    render(
      <SearchBar
        value=""
        onChange={onChange}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );

    await userEvent.type(screen.getByRole("textbox"), "test");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows clear button when value is non-empty", () => {
    const { container } = render(
      <SearchBar
        value="something"
        onChange={vi.fn()}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );
    // Clear button is an svg button (no text), check via button count > 1
    const buttons = container.querySelectorAll("button");
    // There should be at least a clear button plus the filter button
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not show clear button when value is empty", () => {
    const { container } = render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );
    // Only the filter panel trigger button should be present
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1);
  });

  it("calls onChange with empty string when clear button is clicked", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchBar
        value="something"
        onChange={onChange}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );

    // The clear button is the first button (before the filter button)
    const clearButton = container.querySelectorAll("button")[0];
    await userEvent.click(clearButton);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows filter trigger button", () => {
    render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        filters={noopFilters}
        onFiltersChange={vi.fn()}
        contentTypes={contentTypes}
      />
    );
    expect(screen.getByText("filters.button")).toBeInTheDocument();
  });
});
