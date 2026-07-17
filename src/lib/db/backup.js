import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";
import { latestVersion } from "./migrations/index.js";

const KEEP_BACKUPS = 3; // was 5 — upstream b25e10160
const SQLITE_HEADER = Buffer.from("SQLite format 3\0");
const LIGHTWEIGHT_EXCLUDED_TABLES = ["requestDetails"];
export const NATIVE_SNAPSHOT_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const SQLJS_SNAPSHOT_UPLOAD_LIMIT_BYTES = 128 * 1024 * 1024;

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(BACKUPS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function escapeSqlPath(filePath) {
  return String(filePath).replace(/'/g, "''");
}

function getUserTables(adapter, database = "main") {
  return adapter
    .all(
      `SELECT name, sql FROM ${database}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .filter((table) => table.name && table.sql);
}

function copyDatabase(adapter, dest, { excludeTables = [] } = {}) {
  try {
    fs.rmSync(dest, { force: true });
  } catch {
    // Best effort cleanup for a previously interrupted export.
  }

  adapter.exec(`ATTACH DATABASE '${escapeSqlPath(dest)}' AS backup_target`);
  try {
    const excluded = new Set(excludeTables);
    const tables = getUserTables(adapter).filter(
      (table) => !excluded.has(table.name),
    );

    adapter.transaction(() => {
      for (const table of tables) {
        const createSql = table.sql.replace(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i,
          (match) => match.replace(/(\S+)$/, "backup_target.$1"),
        );
        adapter.exec(createSql);
        adapter.exec(
          `INSERT INTO backup_target.${quoteIdentifier(table.name)} SELECT * FROM main.${quoteIdentifier(table.name)}`,
        );
      }
    });
  } finally {
    try {
      adapter.exec("DETACH DATABASE backup_target");
    } catch {
      // The source connection remains usable even if SQLite already detached it.
    }
  }
  return dest;
}

// Lightweight DB backup via SQLite ATTACH — excludes non-critical, large details.
// Used by migration safety backups.
export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  return copyDatabase(adapter, path.join(destDir, destName), {
    excludeTables: LIGHTWEIGHT_EXCLUDED_TABLES,
  });
}

/**
 * Create a complete SQLite snapshot for dashboard analytics export.
 * The result is binary and includes requestDetails plus every current user table.
 */
export function createFullDbSnapshot(adapter) {
  ensureDirs();
  const dir = fs.mkdtempSync(path.join(BACKUPS_DIR, "dashboard-export-"));
  const fileName = `9router-backup-${randomUUID()}.sqlite`;
  const filePath = path.join(dir, fileName);
  try {
    if (adapter.driver === "sql.js") {
      fs.writeFileSync(filePath, Buffer.from(adapter.raw.export()));
    } else {
      copyDatabase(adapter, filePath);
    }
    return { dir, fileName, filePath };
  } catch (error) {
    removeSnapshot({ dir });
    throw error;
  }
}

export function removeSnapshot(snapshot) {
  if (!snapshot?.dir) return;
  try {
    fs.rmSync(snapshot.dir, { recursive: true, force: true });
  } catch {
    // A failed cleanup must not fail the request that already delivered a backup.
  }
}

function assertSqliteHeader(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytes = fs.readSync(fd, header, 0, header.length, 0);
    if (bytes !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
      throw new Error("Selected file is not a SQLite database");
    }
  } finally {
    fs.closeSync(fd);
  }
}

function getTableColumns(adapter, database, tableName) {
  return adapter
    .all(`PRAGMA ${database}.table_info(${quoteIdentifier(tableName)})`)
    .map((column) => column.name)
    .filter(Boolean);
}

function rawAll(database, sql) {
  const result = database.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  );
}

function rawTableColumns(database, tableName) {
  return rawAll(database, `PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .map((column) => column.name)
    .filter(Boolean);
}

function restoreSqlJsSnapshot(adapter, filePath) {
  const source = new adapter.raw.constructor(fs.readFileSync(filePath));
  try {
    const snapshotTables = new Set(
      rawAll(
        source,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).map((table) => table.name),
    );
    const liveTables = getUserTables(adapter).map((table) => table.name);
    const requiredTables = ["_meta", "settings", "providerConnections"];
    if (!requiredTables.every((table) => snapshotTables.has(table))) {
      throw new Error("SQLite snapshot is not a 9Router database");
    }

    const versionRow = rawAll(
      source,
      "SELECT value FROM _meta WHERE key = 'schemaVersion'",
    )[0];
    const sourceVersion = Number.parseInt(versionRow?.value, 10);
    if (!Number.isFinite(sourceVersion) || sourceVersion !== latestVersion()) {
      throw new Error(
        `SQLite snapshot schema version is incompatible (expected ${latestVersion()})`,
      );
    }

    const copyPlan = liveTables.map((tableName) => {
      if (!snapshotTables.has(tableName)) {
        throw new Error(`SQLite snapshot is missing required table: ${tableName}`);
      }
      const columns = getTableColumns(adapter, "main", tableName);
      const sourceColumns = new Set(rawTableColumns(source, tableName));
      if (!columns.every((column) => sourceColumns.has(column))) {
        throw new Error(`SQLite snapshot table is incompatible: ${tableName}`);
      }
      return { tableName, columns };
    });

    adapter.transaction(() => {
      for (const { tableName } of [...copyPlan].reverse()) {
        adapter.exec(`DELETE FROM main.${quoteIdentifier(tableName)}`);
      }
      for (const { tableName, columns } of copyPlan) {
        const columnList = columns.map(quoteIdentifier).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        let cursor = 0;
        while (true) {
          const rows = rawAll(
            source,
            `SELECT rowid AS __snapshot_cursor, ${columnList} FROM ${quoteIdentifier(tableName)} WHERE rowid > ${cursor} ORDER BY rowid ASC LIMIT 100`,
          );
          if (rows.length === 0) break;
          for (const row of rows) {
            adapter.run(
              `INSERT INTO main.${quoteIdentifier(tableName)} (${columnList}) VALUES(${placeholders})`,
              columns.map((column) => row[column]),
            );
          }
          cursor = rows[rows.length - 1].__snapshot_cursor;
        }
      }
    });
  } finally {
    source.close();
  }
}

/**
 * Validate a 9Router SQLite snapshot and copy its compatible rows into the
 * live database. The live file is never replaced while its SQLite connection
 * is open, which is required on Windows.
 */
export function restoreFullDbSnapshot(adapter, filePath) {
  assertSqliteHeader(filePath);
  if (adapter.driver === "sql.js") {
    restoreSqlJsSnapshot(adapter, filePath);
    return;
  }
  const alias = "restore_source";
  adapter.exec(`ATTACH DATABASE '${escapeSqlPath(filePath)}' AS ${alias}`);

  try {
    const snapshotTables = new Set(
      getUserTables(adapter, alias).map((table) => table.name),
    );
    const liveTables = getUserTables(adapter).map((table) => table.name);
    const requiredTables = ["_meta", "settings", "providerConnections"];

    if (!requiredTables.every((table) => snapshotTables.has(table))) {
      throw new Error("SQLite snapshot is not a 9Router database");
    }

    const versionRow = adapter.get(
      `SELECT value FROM ${alias}._meta WHERE key = ?`,
      ["schemaVersion"],
    );
    const sourceVersion = Number.parseInt(versionRow?.value, 10);
    if (!Number.isFinite(sourceVersion) || sourceVersion !== latestVersion()) {
      throw new Error(
        `SQLite snapshot schema version is incompatible (expected ${latestVersion()})`,
      );
    }

    const copyPlan = liveTables.map((tableName) => {
      if (!snapshotTables.has(tableName)) {
        throw new Error(`SQLite snapshot is missing required table: ${tableName}`);
      }
      const liveColumns = getTableColumns(adapter, "main", tableName);
      const snapshotColumns = new Set(
        getTableColumns(adapter, alias, tableName),
      );
      if (!liveColumns.every((column) => snapshotColumns.has(column))) {
        throw new Error(`SQLite snapshot table is incompatible: ${tableName}`);
      }
      return { tableName, columns: liveColumns };
    });

    adapter.transaction(() => {
      // Foreign-key constraints are absent today, but copy in a deterministic
      // order so a future schema can introduce them with a documented update.
      for (const { tableName } of [...copyPlan].reverse()) {
        adapter.exec(`DELETE FROM main.${quoteIdentifier(tableName)}`);
      }
      for (const { tableName, columns } of copyPlan) {
        const columnList = columns.map(quoteIdentifier).join(", ");
        adapter.exec(
          `INSERT INTO main.${quoteIdentifier(tableName)} (${columnList}) SELECT ${columnList} FROM ${alias}.${quoteIdentifier(tableName)}`,
        );
      }
    });
  } finally {
    try {
      adapter.exec(`DETACH DATABASE ${alias}`);
    } catch {
      // The failed validation/transaction is already surfaced to the caller.
    }
  }
}

export function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      full: path.join(BACKUPS_DIR, entry.name),
      mtime: fs.statSync(path.join(BACKUPS_DIR, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try {
      fs.rmSync(old.full, { recursive: true, force: true });
    } catch {}
  }
}
