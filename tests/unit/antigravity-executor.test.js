import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import {
  ANTIGRAVITY_BASE_URLS,
} from "../../open-sse/providers/antigravity-provider-metadata.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const credentials = {
  accessToken: "ag-token",
  projectId: "ag-project",
  connectionId: "ag-executor-test",
};
const body = {
  request: {
    contents: [{ role: "user", parts: [{ text: "hello" }] }],
    generationConfig: { maxOutputTokens: 99999 },
  },
};
const log = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };

describe("AntigravityExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("builds production-first URLs and forces image generation to non-streaming", () => {
    const executor = new AntigravityExecutor();

    expect(executor.getBaseUrls()).toBe(ANTIGRAVITY_BASE_URLS);
    expect(
      ANTIGRAVITY_BASE_URLS.map((_, index) =>
        executor.buildUrl("gemini-3-flash", true, index),
      ),
    ).toEqual(
      ANTIGRAVITY_BASE_URLS.map(
        (base) => `${base}/v1internal:streamGenerateContent?alt=sse`,
      ),
    );
    expect(executor.buildUrl("gemini-3-flash", true, 99)).toBe(
      `${ANTIGRAVITY_BASE_URLS[0]}/v1internal:streamGenerateContent?alt=sse`,
    );
    expect(executor.buildUrl("gemini-3.1-flash-image-16x9", true)).toBe(
      `${ANTIGRAVITY_BASE_URLS[0]}/v1internal:generateContent`,
    );
  });

  it("transforms image and chat requests without changing URL metadata", () => {
    const executor = new AntigravityExecutor();
    const image = executor.transformRequest(
      "gemini-3.1-flash-image-16x9",
      {
        request: {
          contents: [
            { role: "user", parts: [{ text: "draw" }, { inlineData: { data: "ignored" } }] },
          ],
          tools: [{ functionDeclarations: [{ name: "ignored" }] }],
        },
      },
      true,
      credentials,
    );
    const chat = executor.transformRequest(
      "gemini-3-flash",
      {
        request: {
          contents: [
            {
              role: "model",
              parts: [
                { thought: true, text: "hidden" },
                { thoughtSignature: "sig" },
                { functionResponse: { name: "tool" } },
              ],
            },
          ],
          output_config: { effort: "high" },
          generationConfig: { maxOutputTokens: 99999 },
          tools: [
            {
              functionDeclarations: [
                { name: "bad tool!", parameters: { type: "OBJECT", enumDescriptions: ["x"] } },
                { name: "bad tool!", parameters: { type: "OBJECT" } },
              ],
            },
          ],
        },
      },
      true,
      credentials,
    );

    expect(image).toMatchObject({
      project: "ag-project",
      model: "gemini-3.1-flash-image",
      requestType: "image_gen",
      request: {
        contents: [{ role: "user", parts: [{ text: "draw" }] }],
        generationConfig: { imageConfig: { aspectRatio: "16:9" } },
      },
    });
    expect(image.request.tools).toBeUndefined();
    expect(chat.request).toMatchObject({
      generationConfig: { maxOutputTokens: 16384 },
      contents: [{ role: "user", parts: [{ functionResponse: { name: "tool" } }] }],
      toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
    });
    expect(chat.request.output_config).toBeUndefined();
    expect(chat.request.tools[0].functionDeclarations).toHaveLength(1);
    expect(chat.request.tools[0].functionDeclarations[0].name).toBe("bad_tool_");
  });

  it("falls through production network failure and long-retry quota response", async () => {
    const executor = new AntigravityExecutor();
    proxyAwareFetch
      .mockRejectedValueOnce(new Error("production offline"))
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "quota" } }, 429, { "retry-after": "60" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await executor.execute({
      model: "gemini-3-flash",
      body,
      stream: true,
      credentials,
      log,
      proxyOptions: { proxy: "http://proxy.test" },
    });

    expect(result.url).toBe(
      `${ANTIGRAVITY_BASE_URLS[2]}/v1internal:streamGenerateContent?alt=sse`,
    );
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual(
      ANTIGRAVITY_BASE_URLS.map(
        (base) => `${base}/v1internal:streamGenerateContent?alt=sse`,
      ),
    );
    expect(result.headers).toMatchObject({
      Authorization: "Bearer ag-token",
      Accept: "text/event-stream",
    });
  });

  it("throws after every fallback URL fails", async () => {
    const executor = new AntigravityExecutor();
    proxyAwareFetch.mockRejectedValue(new Error("unreachable"));

    await expect(
      executor.execute({
        model: "gemini-3-flash",
        body,
        stream: false,
        credentials,
        log,
      }),
    ).rejects.toThrow("unreachable");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(ANTIGRAVITY_BASE_URLS.length);
  });

  it("parses retry headers, duration text, and gRPC quota reset details", () => {
    const executor = new AntigravityExecutor();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));

    expect(executor.parseRetryHeaders(new Headers({ "retry-after": "12" }))).toBe(
      12000,
    );
    expect(executor.parseRetryHeaders(new Headers({ "x-ratelimit-reset-after": "3" }))).toBe(
      3000,
    );
    expect(executor.parseRetryFromErrorMessage("quota will reset after 1h2m3s")).toBe(
      3723000,
    );
    expect(
      executor.parseError(
        { status: 429 },
        JSON.stringify({
          error: {
            message: "quota",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                metadata: { quotaResetTimeStamp: "2026-07-16T01:00:00Z" },
              },
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "30s",
              },
            ],
          },
        }),
      ),
    ).toMatchObject({ status: 429, resetsAtMs: Date.parse("2026-07-16T01:00:00Z") });
  });
});
