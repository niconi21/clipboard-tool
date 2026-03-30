import { describe, it, expect } from "vitest";
import { validateRegexPattern } from "./regex";

describe("validateRegexPattern", () => {
  it("returns null for empty string", () => {
    expect(validateRegexPattern("")).toBeNull();
  });

  it("returns null for valid simple pattern", () => {
    expect(validateRegexPattern("hello")).toBeNull();
  });

  it("returns null for valid regex with special chars", () => {
    expect(validateRegexPattern("^https?://\\S+")).toBeNull();
  });

  it("returns null for valid complex pattern", () => {
    expect(validateRegexPattern("[a-z0-9]+@[a-z]+\\.[a-z]{2,}")).toBeNull();
  });

  it("returns null for pattern exactly at 1000 characters", () => {
    const pattern = "a".repeat(1000);
    expect(validateRegexPattern(pattern)).toBeNull();
  });

  it("returns error message for pattern longer than 1000 characters", () => {
    const pattern = "a".repeat(1001);
    expect(validateRegexPattern(pattern)).toBe("Pattern too long (max 1000 characters)");
  });

  it("returns error string for invalid regex (unclosed group)", () => {
    const result = validateRegexPattern("(unclosed");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns error string for invalid regex (invalid quantifier)", () => {
    const result = validateRegexPattern("[invalid");
    expect(typeof result).toBe("string");
    expect(result).not.toBeNull();
  });

  it("returns null for anchored patterns", () => {
    expect(validateRegexPattern("^start")).toBeNull();
    expect(validateRegexPattern("end$")).toBeNull();
    expect(validateRegexPattern("^full$")).toBeNull();
  });

  it("returns null for lookahead/lookbehind", () => {
    expect(validateRegexPattern("(?=.+)")).toBeNull();
  });

  it("returns error for inline flags not supported by JS ((?i) is Rust syntax)", () => {
    // JavaScript RegExp does not support (?i) inline flags — this should return an error
    const result = validateRegexPattern("(?i)hello");
    // The function either returns null (valid) or a string error message
    // JS does not support (?i) so it returns an error string
    expect(typeof result).toBe("string");
  });
});
