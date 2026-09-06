import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnableRequestLogs = process.env.ENABLE_REQUEST_LOGS;
const originalObservabilityEnabled = process.env.OBSERVABILITY_ENABLED;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.doUnmock("@/lib/db/repos/settingsRepo.js");
  vi.resetModules();
  restoreEnv("ENABLE_REQUEST_LOGS", originalEnableRequestLogs);
  restoreEnv("OBSERVABILITY_ENABLED", originalObservabilityEnabled);
});

describe("request detail observability configuration", () => {
  it("keeps database details enabled when file logging is disabled", async () => {
    process.env.ENABLE_REQUEST_LOGS = "false";
    process.env.OBSERVABILITY_ENABLED = "true";
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
      getSettings: vi.fn().mockResolvedValue({ enableObservability: true }),
    }));

    const { __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    const config = await __test__.getObservabilityConfig();

    expect(config.enabled).toBe(true);
  });

  it("honors the dashboard toggle independently of file logging", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    process.env.OBSERVABILITY_ENABLED = "true";
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
      getSettings: vi.fn().mockResolvedValue({ enableObservability: false }),
    }));

    const { __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    const config = await __test__.getObservabilityConfig();

    expect(config.enabled).toBe(false);
  });
});