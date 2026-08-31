import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import * as localDb from "@/lib/localDb";

const originalFetch = global.fetch;

vi.mock("@/lib/localDb", () => {
  return {
    getProviderConnections: vi.fn(),
    updateProviderConnection: vi.fn(),
    getProviderConnectionById: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({}),
  };
});

describe("Kiro Account Deactivation on Suspension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("markAccountUnavailable", () => {
    it("should deactivate Kiro account permanently if error contains suspension/lock message", async () => {
      const mockConnection = {
        id: "conn-kiro-1",
        name: "clotilde3209",
        provider: "kiro",
        isActive: true,
        backoffLevel: 0,
      };

      localDb.getProviderConnections.mockResolvedValue([mockConnection]);
      localDb.updateProviderConnection.mockResolvedValue({});

      const errorText = `[ERROR] [403]: {"message":"Your User ID (c498b4d8-5031-70fe-104f-b46b056e5029) temporarily is suspended. We've locked your account as a security precaution. To restore access, please contact our support team to verify your identity: https://app.kiro.dev/account/usage?support_form","reason":null}`;

      const result = await markAccountUnavailable(
        "conn-kiro-1",
        403,
        errorText,
        "kiro",
        "claude-sonnet-4.5",
      );

      // Assert deactivation payload
      expect(localDb.updateProviderConnection).toHaveBeenCalledWith(
        "conn-kiro-1",
        expect.objectContaining({
          isActive: false,
          testStatus: "unavailable",
          lastError: expect.stringContaining("Suspended:"),
          errorCode: 403,
        }),
      );

      // Assert return values
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBe(5 * 60 * 60 * 1000); // 5 hours fallback cooldown
    });

    it("should deactivate Antigravity account permanently on 429 quota exhaustion", async () => {
      const mockConnection = {
        id: "conn-ag-1",
        name: "linhvinhz52631@gmail.com",
        provider: "antigravity",
        isActive: true,
        backoffLevel: 0,
      };

      localDb.getProviderConnections.mockResolvedValue([mockConnection]);
      localDb.updateProviderConnection.mockResolvedValue({});

      const errorText = `[ERROR] [429]: { "error": { "code": 429, "message": "Resource has been exhausted (e.g. check quota).", "status": "RESOURCE_EXHAUSTED" } }`;

      const result = await markAccountUnavailable(
        "conn-ag-1",
        429,
        errorText,
        "antigravity",
        "claude-sonnet-4-6",
      );

      expect(localDb.updateProviderConnection).toHaveBeenCalledWith(
        "conn-ag-1",
        expect.objectContaining({
          isActive: false,
          testStatus: "unavailable",
          lastError: expect.stringContaining("Quota reached:"),
          errorCode: 429,
        }),
      );
      expect(result.shouldFallback).toBe(true);
    });

    it("should not lock model on client abort (499 / Request aborted)", async () => {
      const mockConnection = {
        id: "conn-ag-1",
        name: "user@gmail.com",
        provider: "antigravity",
        isActive: true,
        backoffLevel: 0,
      };
      localDb.getProviderConnections.mockResolvedValue([mockConnection]);
      localDb.updateProviderConnection.mockResolvedValue({});

      const result = await markAccountUnavailable(
        "conn-ag-1",
        499,
        "Request aborted",
        "antigravity",
        "gemini-3-flash-agent",
      );

      expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
      expect(localDb.updateProviderConnection).not.toHaveBeenCalled();
      expect(localDb.getProviderConnections).not.toHaveBeenCalled();
    });
  });

  describe("checkFallbackError client abort", () => {
    it("returns no fallback / no cooldown for 499 and abort messages", () => {
      expect(checkFallbackError(499, "Request aborted")).toEqual({
        shouldFallback: false,
        cooldownMs: 0,
      });
      expect(checkFallbackError(499, "Client disconnected")).toEqual({
        shouldFallback: false,
        cooldownMs: 0,
      });
      expect(
        checkFallbackError(0, "The user aborted a request."),
      ).toEqual({ shouldFallback: false, cooldownMs: 0 });
    });
  });
});
