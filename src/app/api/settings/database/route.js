import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import {
  exportDb,
  exportFullDbSnapshot,
  getFullDbSnapshotUploadLimit,
  getSettings,
  importDb,
  importFullDbSnapshot,
} from "@/lib/localDb";
import { BACKUPS_DIR, ensureDirs } from "@/lib/db/paths";
import { removeSnapshot } from "@/lib/db/backup";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import {
  verifyDashboardPassword,
  verifyDashboardAuthToken,
} from "@/lib/auth/dashboardSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";
const SQLITE_CONTENT_TYPE = "application/vnd.sqlite3";

function formatMiB(bytes) {
  return Math.floor(bytes / (1024 * 1024));
}

function snapshotSizeError(maxBytes) {
  return new Error(
    `SQLite snapshot exceeds the ${formatMiB(maxBytes)} MiB upload limit for this SQLite runtime`,
  );
}

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

async function isAuthorized(request, password = null) {
  const token = request.cookies.get("auth_token")?.value;
  return (
    isCliRequest(request) ||
    (await verifyDashboardAuthToken(token)) ||
    (await verifyDashboardPassword(password ?? request.headers.get(PASSWORD_HEADER)))
  );
}

function snapshotFilename() {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `9router-backup-${stamp}.sqlite`;
}

function createSnapshotResponse(snapshot) {
  const nodeStream = fs.createReadStream(snapshot.filePath);
  const cleanup = () => removeSnapshot(snapshot);
  nodeStream.once("close", cleanup);
  nodeStream.once("error", cleanup);

  return new Response(Readable.toWeb(nodeStream), {
    headers: {
      "Content-Type": SQLITE_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${snapshotFilename()}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function writeSnapshotUpload(request, maxBytes) {
  if (!request.body) throw new Error("SQLite snapshot upload is empty");
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw snapshotSizeError(maxBytes);
  }

  ensureDirs();
  const dir = await fsp.mkdtemp(path.join(BACKUPS_DIR, "dashboard-import-"));
  const filePath = path.join(dir, `${randomUUID()}.sqlite`);
  let bytesWritten = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      bytesWritten += chunk.byteLength;
      if (bytesWritten > maxBytes) {
        throw snapshotSizeError(maxBytes);
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body.pipeThrough(limiter)),
      fs.createWriteStream(filePath),
    );
    return { dir, filePath };
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function reapplyOutboundProxySettings() {
  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
  } catch (error) {
    console.warn(
      "[Settings][DatabaseImport] Failed to re-apply outbound proxy env:",
      error,
    );
  }
}

export async function GET(request) {
  try {
    if (!(await isAuthorized(request))) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }

    const includeUsageAnalytics =
      new URL(request.url).searchParams.get("includeUsageAnalytics") === "true";

    if (includeUsageAnalytics) {
      const snapshot = await exportFullDbSnapshot();
      return createSnapshotResponse(snapshot);
    }

    return Response.json(await exportDb());
  } catch (error) {
    console.log("Error exporting database:", error);
    return Response.json(
      { error: "Failed to export database" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const isSnapshot = request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith(SQLITE_CONTENT_TYPE);

  if (isSnapshot) {
    let upload;
    try {
      if (!(await isAuthorized(request))) {
        return Response.json({ error: "Invalid password" }, { status: 401 });
      }
      const maxBytes = await getFullDbSnapshotUploadLimit();
      upload = await writeSnapshotUpload(request, maxBytes);
      await importFullDbSnapshot(upload.filePath);
      await reapplyOutboundProxySettings();
      return Response.json({ success: true, format: "sqlite" });
    } catch (error) {
      console.log("Error importing SQLite snapshot:", error);
      return Response.json(
        { error: error?.message || "Failed to import SQLite snapshot" },
        { status: 400 },
      );
    } finally {
      if (upload?.dir) await fsp.rm(upload.dir, { recursive: true, force: true });
    }
  }

  try {
    const { password, restoreUsageAnalytics = false, ...payload } =
      await request.json();
    if (!(await isAuthorized(request, password))) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload, { restoreUsageAnalytics });
    await reapplyOutboundProxySettings();
    return Response.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return Response.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 },
    );
  }
}
