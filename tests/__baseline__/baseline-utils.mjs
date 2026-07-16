import { writeFileSync } from "node:fs";

export function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValue(value[key])]),
    );
  }
  return value;
}

export function cloneNormalized(value) {
  return normalizeValue(JSON.parse(JSON.stringify(value)));
}

export function writeSnapshot(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(cloneNormalized(value), null, 2)}\n`);
}

export function collectDiffs(baseline, current, path = "") {
  if (Object.is(baseline, current)) return [];

  const baselineIsObject = baseline && typeof baseline === "object";
  const currentIsObject = current && typeof current === "object";
  if (!baselineIsObject || !currentIsObject || Array.isArray(baseline) !== Array.isArray(current)) {
    return [`~ ${path || "value"}: ${JSON.stringify(baseline)} -> ${JSON.stringify(current)}`];
  }

  if (Array.isArray(baseline)) {
    if (baseline.length !== current.length) {
      return [`~ ${path}: array length ${baseline.length} -> ${current.length}`];
    }
    return baseline.flatMap((value, index) =>
      collectDiffs(value, current[index], `${path}[${index}]`),
    );
  }

  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
  return keys.flatMap((key) => {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in baseline)) return [`+ ${childPath}: ${JSON.stringify(current[key])}`];
    if (!(key in current)) return [`- ${childPath}: ${JSON.stringify(baseline[key])}`];
    return collectDiffs(baseline[key], current[key], childPath);
  });
}
