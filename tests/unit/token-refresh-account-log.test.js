import { describe, it, expect, vi } from "vitest";
import {
  resolveRefreshAccountLabel,
  withRefreshAccountLog,
} from "../../open-sse/services/refresh-orchestrator.js";

describe("TOKEN_REFRESH account label", () => {
  it("resolveRefreshAccountLabel prefers connectionName then email then short id", () => {
    expect(
      resolveRefreshAccountLabel({
        connectionName: "Morgan Williams",
        email: "other@x.com",
      }),
    ).toBe("Morgan Williams");
    expect(
      resolveRefreshAccountLabel({
        email: "user@example.com",
        connectionId: "abcdef12-3456",
      }),
    ).toBe("user@example.com");
    // Raw connection row from localDb (name + id, no connectionName)
    expect(
      resolveRefreshAccountLabel({
        id: "6fd33e54-c86e-4a82-b391-31e6a3aa2e78",
        name: "dagostinot43",
        email: null,
      }),
    ).toBe("dagostinot43");
    expect(
      resolveRefreshAccountLabel({ connectionId: "abcdef12-3456-7890" }),
    ).toBe("abcdef12");
    expect(resolveRefreshAccountLabel(null)).toBeNull();
  });

  it("withRefreshAccountLog injects account into TOKEN_REFRESH data", () => {
    const info = vi.fn();
    const wrapped = withRefreshAccountLog(
      {
        connectionName: "clotilde3209",
        connectionId: "conn-kiro-1-uuid",
      },
      { info },
    );

    wrapped.info("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
      hasNewAccessToken: true,
      expiresIn: 3600,
    });

    expect(info).toHaveBeenCalledWith(
      "TOKEN_REFRESH",
      "Successfully refreshed Kiro AWS token",
      {
        hasNewAccessToken: true,
        expiresIn: 3600,
        account: "clotilde3209",
        connectionId: "conn-kir",
      },
    );

    // Usage/quota path: name + connectionId only
    const info2 = vi.fn();
    const wrapped2 = withRefreshAccountLog(
      {
        name: "dagostinot43",
        connectionId: "6fd33e54-c86e-4a82-b391-31e6a3aa2e78",
      },
      { info: info2 },
    );
    wrapped2.info("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
      hasNewAccessToken: true,
      expiresIn: 3600,
    });
    expect(info2).toHaveBeenCalledWith(
      "TOKEN_REFRESH",
      "Successfully refreshed Kiro AWS token",
      expect.objectContaining({
        account: "dagostinot43",
        connectionId: "6fd33e54",
      }),
    );

    // Non-TOKEN_REFRESH tags stay untouched
    wrapped.info("AUTH", "Using kiro account", { x: 1 });
    expect(info).toHaveBeenLastCalledWith("AUTH", "Using kiro account", {
      x: 1,
    });
  });
});