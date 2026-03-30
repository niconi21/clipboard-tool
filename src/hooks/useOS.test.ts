import { describe, it, expect, vi, afterEach } from "vitest";

describe("useOS / currentOS", () => {
  // We must re-import the module with a fresh navigator after mocking,
  // so we use vi.doMock + dynamic import inside each test.
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  function mockUA(ua: string) {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: ua },
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    // Restore original navigator
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    }
    vi.resetModules();
  });

  it("detects macOS from userAgent", async () => {
    mockUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { currentOS } = await import("./useOS");
    expect(currentOS).toBe("macos");
  });

  it("detects Windows from userAgent", async () => {
    mockUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    const { currentOS } = await import("./useOS");
    expect(currentOS).toBe("windows");
  });

  it("falls back to linux for unknown userAgent", async () => {
    mockUA("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
    const { currentOS } = await import("./useOS");
    expect(currentOS).toBe("linux");
  });

  it("falls back to linux for empty userAgent", async () => {
    mockUA("");
    const { currentOS } = await import("./useOS");
    expect(currentOS).toBe("linux");
  });

  it("OS type has expected string values", async () => {
    mockUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { currentOS } = await import("./useOS");
    expect(["macos", "windows", "linux"]).toContain(currentOS);
  });
});
