import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { DATA_DIR } from "@/lib/dataDir";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Repo src/cursor-local entry (dev) */
export function resolveCursorLocalEntry() {
  if (process.env.CURSOR_LOCAL_ENTRY) return process.env.CURSOR_LOCAL_ENTRY;
  // From src/lib/cursor-local → src/cursor-local/index.js
  const candidates = [
    path.join(__dirname, "..", "..", "cursor-local", "index.js"),
    path.join(process.cwd(), "src", "cursor-local", "index.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export function cursorLocalRoot() {
  return path.join(DATA_DIR, "cursor-local");
}

export function cursorLocalPidPath() {
  return path.join(cursorLocalRoot(), "pid.json");
}

export function cursorLocalConfigPath() {
  return path.join(cursorLocalRoot(), "config.json");
}

export function cursorLocalLogPath() {
  return path.join(cursorLocalRoot(), "logs", "cursor-local.log");
}

export { DATA_DIR };
