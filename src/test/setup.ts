import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock all Tauri APIs globally — they are not available in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock react-i18next — return the key as translation string
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock highlight.js (dynamic import in CodeRenderer)
vi.mock("highlight.js", () => ({
  default: {
    highlightElement: vi.fn(),
    highlightAuto: vi.fn(() => ({ value: "", language: "text" })),
  },
}));
