import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDb: vi.fn(),
  exportFullDbSnapshot: vi.fn(),
  getFullDbSnapshotUploadLimit: vi.fn(),
  getSettings: vi.fn(),
  importDb: vi.fn(),
  importFullDbSnapshot: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  ensureDirs: vi.fn(),
  removeSnapshot: vi.fn((snapshot) =>
    fs.rmSync(snapshot.dir, { recursive: true, force: true }),
  ),
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  exportFullDbSnapshot: mocks.exportFullDbSnapshot,
  getFullDbSnapshotUploadLimit: mocks.getFullDbSnapshotUploadLimit,
  getSettings: mocks.getSettings,
  importDb: mocks.importDb,
  importFullDbSnapshot: mocks.importFullDbSnapshot,
}));
vi.mock("@/lib/db/paths", () => ({
  BACKUPS_DIR: os.tmpdir(),
  ensureDirs: mocks.ensureDirs,
}));
vi.mock("@/lib/db/backup", () => ({
  removeSnapshot: mocks.removeSnapshot,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  verifyDashboardPassword: mocks.verifyDashboardPassword,
}));
vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

function request(url, { token = "valid-token" } = {}) {
  return {
    url,
    headers: new Headers(),
    cookies: { get: () => (token ? { value: token } : undefined) },
  };
}

describe("database backup route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("downloads analytics as a SQLite attachment without JSON serialization", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-route-backup-"));
    const filePath = path.join(dir, "snapshot.sqlite");
    fs.writeFileSync(filePath, Buffer.from("SQLite format 3\0test payload"));
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    mocks.exportFullDbSnapshot.mockResolvedValue({ dir, filePath });

    const { GET } = await import("@/app/api/settings/database/route.js");
    const response = await GET(
      request("http://localhost/api/settings/database?includeUsageAnalytics=true"),
    );

    expect(mocks.exportFullDbSnapshot).toHaveBeenCalledOnce();
    expect(mocks.exportDb).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.sqlite3",
    );
    expect(response.headers.get("content-disposition")).toMatch(/\.sqlite/);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 16).toString()).toBe(
      "SQLite format 3\0",
    );
    expect(mocks.removeSnapshot).toHaveBeenCalledWith({ dir, filePath });
  });

  it("rejects an oversized SQLite upload before writing it", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    mocks.getFullDbSnapshotUploadLimit.mockResolvedValue(128 * 1024 * 1024);

    const { POST } = await import("@/app/api/settings/database/route.js");
    const response = await POST({
      headers: new Headers({
        "content-type": "application/vnd.sqlite3",
        "content-length": "134217729",
      }),
      cookies: { get: () => ({ value: "valid-token" }) },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "SQLite snapshot exceeds the 128 MiB upload limit for this SQLite runtime",
    });
    expect(mocks.importFullDbSnapshot).not.toHaveBeenCalled();
  });

  it("rejects unauthorized analytics downloads before creating a snapshot", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockResolvedValue(false);

    const { GET } = await import("@/app/api/settings/database/route.js");
    const response = await GET(
      request("http://localhost/api/settings/database?includeUsageAnalytics=true", {
        token: null,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid password" });
    expect(mocks.exportFullDbSnapshot).not.toHaveBeenCalled();
  });
});
