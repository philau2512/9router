/**
 * Unit tests for the Kiro external_idp (Microsoft Entra) token refresh branch.
 *
 * Regression guard for the bug where external_idp accounts (clientId but no
 * clientSecret) fell through to the Kiro social endpoint and failed with
 * 401 "Bad credentials". The external_idp branch must:
 *  - POST application/x-www-form-urlencoded to the account's Microsoft
 *    tokenEndpoint (NOT the AWS OIDC or kiro.dev social endpoints)
 *  - send grant_type=refresh_token + client_id + refresh_token + scope
 *  - read the snake_case Microsoft OAuth response (access_token / refresh_token
 *    / expires_in)
 *  - run BEFORE the AWS and social branches
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { refreshKiroToken } from "../../open-sse/services/refresh-providers.js";

const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/07683ab4-aa77-4fef-a0fc-30aabefab60b/oauth2/v2.0/token";
const CLIENT_ID = "723b88dc-91e4-458a-b637-00723b3f4ea0";
const SCOPE =
  "api://723b88dc-91e4-458a-b637-00723b3f4ea0/codewhisperer:conversations offline_access";

function externalIdpData(overrides = {}) {
  return {
    profileArn: "arn:aws:codewhisperer:us-east-1:220704014990:profile/P9EQHA3X7EYP",
    region: "us-east-1",
    authMethod: "external_idp",
    provider: "CLIProxyAPI",
    clientId: CLIENT_ID,
    tokenEndpoint: TOKEN_ENDPOINT,
    scope: SCOPE,
    ...overrides,
  };
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Unique refresh token per test so dedupRefresh's in-flight cache never
// collides across cases.
let _rt = 0;
function uniqueRefreshToken() {
  _rt += 1;
  return `entra-refresh-token-${_rt}`;
}

describe("refreshKiroToken — external_idp branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs form-urlencoded to the Microsoft tokenEndpoint with the right params", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse(200, {
        access_token: "new-entra-access",
        refresh_token: "rotated-entra-refresh",
        expires_in: 4509,
      }),
    );

    const refreshToken = uniqueRefreshToken();
    const result = await refreshKiroToken(refreshToken, externalIdpData(), null);

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    // Body is a URLSearchParams carrying the OAuth refresh grant.
    const body = options.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("refresh_token")).toBe(refreshToken);
    expect(body.get("scope")).toBe(SCOPE);
    // No client_secret for a public Entra client.
    expect(body.get("client_secret")).toBeNull();

    // Reads snake_case Microsoft OAuth response.
    expect(result.accessToken).toBe("new-entra-access");
    expect(result.refreshToken).toBe("rotated-entra-refresh");
    expect(result.expiresIn).toBe(4509);
    expect(result.providerSpecificData.authMethod).toBe("external_idp");
    expect(result.providerSpecificData.tokenEndpoint).toBe(TOKEN_ENDPOINT);
  });

  it("keeps the old refresh token when Microsoft does not rotate it", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse(200, {
        access_token: "new-entra-access",
        expires_in: 3600,
      }),
    );

    const refreshToken = uniqueRefreshToken();
    const result = await refreshKiroToken(refreshToken, externalIdpData(), null);

    expect(result.refreshToken).toBe(refreshToken);
    expect(result.accessToken).toBe("new-entra-access");
  });

  it("never hits the AWS OIDC or Kiro social endpoints for external_idp", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse(200, {
        access_token: "a",
        refresh_token: "b",
        expires_in: 100,
      }),
    );

    await refreshKiroToken(uniqueRefreshToken(), externalIdpData(), null);

    const calledUrls = proxyAwareFetch.mock.calls.map((c) => c[0]);
    expect(calledUrls).toEqual([TOKEN_ENDPOINT]);
    for (const url of calledUrls) {
      expect(url).not.toContain("amazonaws.com");
      expect(url).not.toContain("kiro.dev");
    }
  });

  it("returns null when Microsoft responds with an error (e.g. 401)", async () => {
    proxyAwareFetch.mockResolvedValue(
      jsonResponse(401, { error: "invalid_grant" }),
    );

    const result = await refreshKiroToken(
      uniqueRefreshToken(),
      externalIdpData(),
      null,
    );
    expect(result).toBeNull();
  });

  it("rejects a non-Microsoft tokenEndpoint before making any request", async () => {
    const result = await refreshKiroToken(
      uniqueRefreshToken(),
      externalIdpData({ tokenEndpoint: "https://evil.example.com/token" }),
      null,
    );

    expect(result).toBeNull();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("returns null (no request) when clientId is missing", async () => {
    const result = await refreshKiroToken(
      uniqueRefreshToken(),
      externalIdpData({ clientId: "" }),
      null,
    );

    expect(result).toBeNull();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
