// Minimal pricing.js — provides matchPattern used by capabilities.js.
// Full pricing data lives in open-sse/config/ and the upstream pricing.js;
// only the pattern-matching utility is needed by this package.

/**
 * Glob-style pattern match against a model id.
 * Supports * wildcards; case-insensitive; anchored (full-string match).
 */
export function matchPattern(pattern, model) {
  const regex = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
    "i",
  );
  return regex.test(model);
}
