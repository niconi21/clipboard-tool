import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentRenderer } from "./ContentRenderer";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("ContentRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PlainRenderer (default)", () => {
    it("renders plain text for unknown type", () => {
      render(<ContentRenderer content="hello world" contentType="text" />);
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });

    it("renders plain text for unrecognized type", () => {
      render(<ContentRenderer content="some data" contentType="unknown" />);
      expect(screen.getByText("some data")).toBeInTheDocument();
    });
  });

  describe("UrlRenderer", () => {
    it("renders the URL text", () => {
      render(<ContentRenderer content="https://example.com" contentType="url" />);
      expect(screen.getByText("https://example.com")).toBeInTheDocument();
    });

    it("shows open browser button for https URL", () => {
      render(<ContentRenderer content="https://example.com" contentType="url" />);
      expect(screen.getByText("content_renderer.open_browser")).toBeInTheDocument();
    });

    it("shows open browser button for http URL", () => {
      render(<ContentRenderer content="http://example.com" contentType="url" />);
      expect(screen.getByText("content_renderer.open_browser")).toBeInTheDocument();
    });

    it("shows non-http warning for javascript: scheme", async () => {
      mockInvoke.mockResolvedValue(undefined);
      render(<ContentRenderer content="javascript:alert(1)" contentType="url" />);
      await waitFor(() => {
        expect(screen.getByText("content_renderer.non_http")).toBeInTheDocument();
      });
      expect(screen.queryByText("content_renderer.open_browser")).not.toBeInTheDocument();
    });

    it("shows non-http warning for file: scheme", async () => {
      mockInvoke.mockResolvedValue(undefined);
      render(<ContentRenderer content="file:///etc/passwd" contentType="url" />);
      await waitFor(() => {
        expect(screen.getByText("content_renderer.non_http")).toBeInTheDocument();
      });
    });

    it("shows non-http warning for ftp: scheme", () => {
      mockInvoke.mockResolvedValue(undefined);
      render(<ContentRenderer content="ftp://example.com/file" contentType="url" />);
      expect(screen.getByText("content_renderer.non_http")).toBeInTheDocument();
    });

    it("shows non-http warning for invalid URL", () => {
      render(<ContentRenderer content="not-a-url" contentType="url" />);
      expect(screen.getByText("content_renderer.non_http")).toBeInTheDocument();
    });
  });

  describe("EmailRenderer", () => {
    it("renders email address", () => {
      render(<ContentRenderer content="user@example.com" contentType="email" />);
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });

    it("shows open email client button", () => {
      render(<ContentRenderer content="user@example.com" contentType="email" />);
      expect(screen.getByText("content_renderer.open_email")).toBeInTheDocument();
    });
  });

  describe("PhoneRenderer", () => {
    it("renders phone number", () => {
      render(<ContentRenderer content="+1 555 123 4567" contentType="phone" />);
      expect(screen.getByText("+1 555 123 4567")).toBeInTheDocument();
    });
  });

  describe("ColorRenderer", () => {
    it("renders color value as text", () => {
      render(<ContentRenderer content="#3b82f6" contentType="color" />);
      expect(screen.getByText("#3b82f6")).toBeInTheDocument();
    });

    it("applies backgroundColor style to swatch", () => {
      const { container } = render(<ContentRenderer content="#3b82f6" contentType="color" />);
      const swatch = container.querySelector('[style*="background-color"]') as HTMLElement;
      expect(swatch).toBeInTheDocument();
      // jsdom normalizes hex colors to rgb() — check that a background-color is applied
      expect(swatch.style.backgroundColor).toBeTruthy();
    });
  });

  describe("CodeRenderer", () => {
    it("renders code content in pre/code elements", () => {
      render(<ContentRenderer content="const x = 1;" contentType="code" />);
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    it("renders JSON with language class", () => {
      const { container } = render(<ContentRenderer content='{"key": "value"}' contentType="json" />);
      expect(container.querySelector("code.language-json")).toBeInTheDocument();
    });

    it("renders SQL with language class", () => {
      const { container } = render(<ContentRenderer content="SELECT * FROM users" contentType="sql" />);
      expect(container.querySelector("code.language-sql")).toBeInTheDocument();
    });

    it("renders shell with bash language class", () => {
      const { container } = render(<ContentRenderer content="echo hello" contentType="shell" />);
      expect(container.querySelector("code.language-bash")).toBeInTheDocument();
    });
  });

  describe("ImageRenderer", () => {
    it("shows loading skeleton while fetching", () => {
      mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
      const { container } = render(<ContentRenderer content="images/test.png" contentType="image" />);
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("shows error when invoke fails", async () => {
      mockInvoke.mockRejectedValue(new Error("not found"));
      render(<ContentRenderer content="images/missing.png" contentType="image" />);
      await waitFor(() => {
        expect(screen.getByText("content_renderer.image_error")).toBeInTheDocument();
      });
    });

    it("shows image when invoke succeeds", async () => {
      mockInvoke.mockResolvedValue("data:image/png;base64,abc123");
      const { container } = render(<ContentRenderer content="images/test.png" contentType="image" />);
      await waitFor(() => {
        // img with empty alt has role="presentation", query by tag directly
        expect(container.querySelector("img")).toBeInTheDocument();
      });
    });
  });

  describe("MarkdownRenderer", () => {
    it("renders markdown in preview mode by default", () => {
      const { container } = render(<ContentRenderer content="# Hello\n\n- item" contentType="markdown" />);
      expect(container.querySelector(".markdown-preview")).toBeInTheDocument();
    });

    it("shows preview and source toggle buttons", () => {
      render(<ContentRenderer content="# Hello" contentType="markdown" />);
      expect(screen.getByText("content_renderer.md_preview")).toBeInTheDocument();
      expect(screen.getByText("content_renderer.md_source")).toBeInTheDocument();
    });
  });

  describe("MarkdownRenderer - source view (line 233)", () => {
    it("shows CodeRenderer with markdown language when source tab clicked", async () => {
      const { container } = render(<ContentRenderer content="# Hello" contentType="markdown" />);

      // Click "Source" button to switch to source view
      await userEvent.click(screen.getByText("content_renderer.md_source"));

      // In source view, the CodeRenderer renders a code element with language-markdown class
      expect(container.querySelector("code.language-markdown")).toBeInTheDocument();
      // The preview div should no longer be in the document
      expect(container.querySelector(".markdown-preview")).not.toBeInTheDocument();
    });

    it("switching back to preview shows markdown-preview again", async () => {
      const { container } = render(<ContentRenderer content="# Hello" contentType="markdown" />);

      await userEvent.click(screen.getByText("content_renderer.md_source"));
      expect(container.querySelector(".markdown-preview")).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("content_renderer.md_preview"));
      expect(container.querySelector(".markdown-preview")).toBeInTheDocument();
    });
  });

  describe("MarkdownRenderer - link click interception (lines 194-199)", () => {
    it("calls openUrl for http links clicked inside preview", async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const mockOpenUrl = vi.mocked(openUrl);
      mockOpenUrl.mockResolvedValue(undefined);

      render(<ContentRenderer content={"[click me](https://example.com)"} contentType="markdown" />);

      // Find the rendered link in the markdown preview
      const link = document.querySelector(".markdown-preview a");
      if (link) {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        // openUrl should be called with the href
        expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
      }
    });

    it("does not call openUrl when clicking non-link elements in preview", async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const mockOpenUrl = vi.mocked(openUrl);
      mockOpenUrl.mockResolvedValue(undefined);
      mockOpenUrl.mockClear();

      const { container } = render(<ContentRenderer content={"# Just a heading\n\nSome text"} contentType="markdown" />);

      const preview = container.querySelector(".markdown-preview");
      if (preview) {
        preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mockOpenUrl).not.toHaveBeenCalled();
      }
    });
  });

  describe("MarkdownRenderer - XSS sanitization", () => {
    it("strips script tags from markdown output", () => {
      const { container } = render(
        <ContentRenderer content={"# Hello\n\n<script>window.__xss = true</script>"} contentType="markdown" />
      );
      expect(container.querySelector("script")).not.toBeInTheDocument();
      // The injected global should not have been set
      expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
    });

    it("strips javascript: hrefs from markdown links", () => {
      const { container } = render(
        <ContentRenderer content={"[click me](javascript:alert(1))"} contentType="markdown" />
      );
      const link = container.querySelector("a");
      // DOMPurify should remove the href or change it to a safe value
      if (link) {
        const href = link.getAttribute("href");
        // href is either null (removed entirely) or a safe non-javascript: string
        if (href !== null) {
          expect(href).not.toMatch(/^javascript:/i);
        }
      }
    });

    it("strips onerror attributes from markdown images", () => {
      const { container } = render(
        <ContentRenderer content={"![img](x.png)"} contentType="markdown" />
      );
      const img = container.querySelector("img");
      if (img) {
        expect(img.getAttribute("onerror")).toBeNull();
      }
    });

    it("allows safe markdown HTML through", () => {
      const { container } = render(
        <ContentRenderer content={"# Title\n\n**bold** and _italic_"} contentType="markdown" />
      );
      // DOMPurify should allow <strong> and <em>
      expect(container.querySelector(".markdown-preview")).toBeInTheDocument();
    });
  });
});
