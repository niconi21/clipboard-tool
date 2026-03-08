/** Returns null if valid, or an error message string if invalid. */
export function validateRegexPattern(pattern: string): string | null {
  if (!pattern) return null;
  if (pattern.length > 1000) return "Pattern too long (max 1000 characters)";
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
