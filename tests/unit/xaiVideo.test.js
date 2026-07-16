import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  resolveVideoEndpoint,
  handleXaiVideo,
  resolveBearerToken,
  hasVideoCredentials,
  normalizeVideoBody,
  validateVideoBody,
  videoModelRequiresImage,
  DEFAULT_VIDEO_MODEL,
} from "../../open-sse/handlers/videoProviders/xai.js";

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveBearerToken / hasVideoCredentials", () => {
  it("prefers accessToken then apiKey", () => {
    expect(resolveBearerToken({ accessToken: "a", apiKey: "k" })).toBe("a");
    expect(resolveBearerToken({ apiKey: "k" })).toBe("k");
    expect(resolveBearerToken({})).toBe(null);
    expect(hasVideoCredentials({ apiKey: "k" })).toBe(true);
    expect(hasVideoCredentials({})).toBe(false);
  });
});

describe("videoModelRequiresImage / validateVideoBody", () => {
  it("flags grok-imagine-video-1.5 as image-required", () => {
    expect(videoModelRequiresImage("grok-imagine-video-1.5")).toBe(true);
    expect(videoModelRequiresImage("xai/grok-imagine-video-1.5")).toBe(true);
    expect(videoModelRequiresImage("grok-imagine-video")).toBe(false);
  });

  it("rejects 1.5 create without image", () => {
    const r = validateVideoBody({
      model: "grok-imagine-video-1.5",
      prompt: "spin",
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe("image_required");
  });

  it("allows 1.5 when image is set", () => {
    expect(
      validateVideoBody({
        model: "grok-imagine-video-1.5",
        prompt: "spin",
        image: "https://example.com/frame.png",
      }).ok,
    ).toBe(true);
  });

  it("skips image check for poll / base model", () => {
    expect(
      validateVideoBody({
        model: "grok-imagine-video-1.5",
        request_id: "vid_1",
      }).ok,
    ).toBe(true);
    expect(
      validateVideoBody({ model: "grok-imagine-video", prompt: "x" }).ok,
    ).toBe(true);
  });
});

describe("normalizeVideoBody", () => {
  it("maps duration_seconds → duration and drops alias", () => {
    const out = normalizeVideoBody({
      prompt: "x",
      duration_seconds: 8,
      auto_poll: "true",
    });
    expect(out.duration).toBe(8);
    expect(out.duration_seconds).toBeUndefined();
    expect(out.auto_poll).toBeUndefined();
  });

  it("defaults model to grok-imagine-video", () => {
    expect(normalizeVideoBody({ prompt: "x" }).model).toBe(DEFAULT_VIDEO_MODEL);
  });

  it("splits reference_images string", () => {
    const out = normalizeVideoBody({
      prompt: "x",
      reference_images: "https://a.png, https://b.png",
    });
    expect(out.reference_images).toEqual([
      "https://a.png",
      "https://b.png",
    ]);
  });
});

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

  it("returns 401 without access token or apiKey", async () => {
    const res = await handleXaiVideo({ body: {}, credentials: {} });
    expect(res.status).toBe(401);
    expect(res.ok).toBe(false);
  });

  it("returns 400 for 1.5 without image before calling upstream", async () => {
    const res = await handleXaiVideo({
      body: { model: "grok-imagine-video-1.5", prompt: "a cat" },
      credentials: { apiKey: "k" },
    });
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
    expect(res.data.error.code).toBe("image_required");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("creates a video job with accessToken", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(200, { request_id: "vid_abc", status: "pending" }),
    );
    const res = await handleXaiVideo({
      body: { prompt: "a cat", model: "grok-imagine-video" },
      credentials: { accessToken: "tok" },
    });
    expect(res.ok).toBe(true);
    expect(res.data.request_id).toBe("vid_abc");
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/generations");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("accepts apiKey as Bearer when accessToken missing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(200, { request_id: "vid_k" }),
    );
    await handleXaiVideo({
      body: { prompt: "x", duration_seconds: 5 },
      credentials: { apiKey: "xai-key" },
    });
    const [, init] = proxyAwareFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer xai-key");
    const sent = JSON.parse(init.body);
    expect(sent.duration).toBe(5);
    expect(sent.duration_seconds).toBeUndefined();
    expect(sent.model).toBe(DEFAULT_VIDEO_MODEL);
  });

  it("polls with GET and no body when request_id is set", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(200, { request_id: "vid_abc", status: "done" }),
    );
    const res = await handleXaiVideo({
      body: { request_id: "vid_abc" },
      credentials: { accessToken: "tok" },
    });
    expect(res.data.status).toBe("done");
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