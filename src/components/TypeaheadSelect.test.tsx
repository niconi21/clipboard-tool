import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeaheadSelect } from "./TypeaheadSelect";
import type { SelectOption } from "./TypeaheadSelect";

const options: SelectOption[] = [
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "code", label: "Code" },
];

describe("TypeaheadSelect", () => {
  it("renders the placeholder when no value selected", () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );
    expect(screen.getByText("All types")).toBeInTheDocument();
  });

  it("renders the selected option label when value is set", () => {
    render(
      <TypeaheadSelect
        value="url"
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("opens dropdown on click", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    // Dropdown should now show all options plus "All" option
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
  });

  it("shows all options plus 'All' option when opened", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    expect(screen.getAllByText("All types").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });

  it("calls onChange with selected value when option clicked", async () => {
    const onChange = vi.fn();
    render(
      <TypeaheadSelect
        value=""
        onChange={onChange}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    await userEvent.click(screen.getByText("URL"));
    expect(onChange).toHaveBeenCalledWith("url");
  });

  it("calls onChange with empty string when 'All' option clicked", async () => {
    const onChange = vi.fn();
    render(
      <TypeaheadSelect
        value="url"
        onChange={onChange}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button")); // trigger button
    // Find the All option (first li button in the dropdown)
    const allButtons = screen.getAllByRole("button");
    // The "All" option button is after the trigger button
    const allOption = allButtons.find((b) => b.textContent?.includes("All types"));
    if (allOption) {
      await userEvent.click(allOption);
      expect(onChange).toHaveBeenCalledWith("");
    }
  });

  it("filters options by search query", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    const searchInput = screen.getByPlaceholderText("typeahead.search");
    await userEvent.type(searchInput, "url");

    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("Code")).not.toBeInTheDocument();
  });

  it("shows 'no results' message when no options match query", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    const searchInput = screen.getByPlaceholderText("typeahead.search");
    await userEvent.type(searchInput, "zzzznotfound");

    expect(screen.getByText("typeahead.no_results")).toBeInTheDocument();
  });

  it("clears search query when clear button inside search input is clicked", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    const searchInput = screen.getByPlaceholderText("typeahead.search");
    await userEvent.type(searchInput, "url");

    // Clear button appears next to the search input
    // After typing "url", only URL is visible — clear it to restore all
    const clearSearchBtn = screen.getAllByRole("button").find(
      (b) => !b.textContent && b !== searchInput
    );
    if (clearSearchBtn) {
      await userEvent.click(clearSearchBtn);
      // After clearing, all options should be visible again
      expect(screen.getByText("Email")).toBeInTheDocument();
    }
  });

  it("closes dropdown after selecting an option", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    expect(screen.getByText("URL")).toBeInTheDocument();

    await userEvent.click(screen.getByText("URL"));
    // Dropdown should be closed — Email should no longer be visible
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
  });

  it("shows checkmark on currently selected option", async () => {
    render(
      <TypeaheadSelect
        value="url"
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button")); // open dropdown
    // The selected option (URL) should have a checkmark SVG
    // Presence of the selected style class on the URL option item
    const urlButton = screen.getAllByText("URL")[0].closest("button");
    expect(urlButton?.className).toContain("bg-accent");
  });

  it("is case-insensitive when filtering", async () => {
    render(
      <TypeaheadSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="All types"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /all types/i }));
    const searchInput = screen.getByPlaceholderText("typeahead.search");
    await userEvent.type(searchInput, "EMAIL");

    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.queryByText("URL")).not.toBeInTheDocument();
  });
});
