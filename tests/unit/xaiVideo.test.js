import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  resolveVideoEndpoint,
  handleXaiVideo,
} from "../../open-sse/handlers/videoProviders/xai.js";

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveVideoEndpoint", () => {
  it("defaults to POST /videos/generations", () => {
    expect(resolveVideoEndpoint({})).toEqual({
      method: "POST",
      path: "/videos/generations",
      hasBody: true,
    });
  });
  it("routes edits/extensions operations", () => {
    expect(resolveVideoEndpoint({ operation: "edits" }).path).toBe(
      "/videos/edits",
    );
    expect(resolveVideoEndpoint({ operation: "extensions" }).path).toBe(
      "/videos/extensions",
    );
  });
  it("polls GET /videos/{request_id} when request_id is present", () => {
    const r = resolveVideoEndpoint({ request_id: "vid_123" });
    expect(r.method).toBe("GET");
    expect(r.path).toBe("/videos/vid_123");
    expect(r.hasBody).toBe(false);
  });
});

describe("handleXaiVideo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without an access token", async () => {
    const res = await handleXaiVideo({ body: {}, credentials: {} });
    expect(res.status).toBe(401);
    expect(res.ok).toBe(false);
  });

  it("creates a video job and returns the request_id payload", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(200, { request_id: "vid_abc", status: "pending" }),
    );
    const res = await handleXaiVideo({
      body: { prompt: "a cat", model: "grok-video" },
      credentials: { accessToken: "tok" },
    });
    expect(res.ok).toBe(true);
    expect(res.data.request_id).toBe("vid_abc");
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/generations");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("polls with GET and no body when request_id is set", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(200, { request_id: "vid_abc", status: "completed" }),
    );
    const res = await handleXaiVideo({
      body: { request_id: "vid_abc" },
      credentials: { accessToken: "tok" },
    });
    expect(res.data.status).toBe("completed");
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/vid_abc");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("surfaces upstream errors as non-ok", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(429, { error: { message: "rate limited" } }),
    );
    const res = await handleXaiVideo({
      body: { prompt: "x" },
      credentials: { accessToken: "tok" },
    });
    expect(res.status).toBe(429);
    expect(res.ok).toBe(false);
  });
});
