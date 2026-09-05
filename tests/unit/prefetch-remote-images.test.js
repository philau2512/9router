import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchImageAsBase64: vi.fn(),
}));

vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  fetchImageAsBase64: mocks.fetchImageAsBase64,
  parseDataUri: (value) => typeof value === "string" && value.startsWith("data:"),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("remote image prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchImageAsBase64.mockReset();
  });

  it("prefetches remote images concurrently with the request abort signal", async () => {
    const first = deferred();
    const second = deferred();
    const controller = new AbortController();
    mocks.fetchImageAsBase64
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const body = {
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "https://images.example/one.png" } },
          { type: "image_url", image_url: { url: "https://images.example/two.png" } },
        ],
      }],
    };

    const prefetch = prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.GEMINI, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.fetchImageAsBase64).toHaveBeenCalledTimes(2));
    expect(mocks.fetchImageAsBase64).toHaveBeenNthCalledWith(
      1,
      "https://images.example/one.png",
      expect.objectContaining({ signal: controller.signal }),
    );

    first.resolve({ url: "data:image/png;base64,one", mimeType: "image/png" });
    second.resolve({ url: "data:image/png;base64,two", mimeType: "image/png" });
    await expect(prefetch).resolves.toBe(2);
  });

  it("keeps prefetch fail-open when one image fetch rejects", async () => {
    mocks.fetchImageAsBase64
      .mockRejectedValueOnce(new Error("image fetch failed"))
      .mockResolvedValueOnce({ url: "data:image/png;base64,two", mimeType: "image/png" });
    const first = { type: "image_url", image_url: { url: "https://images.example/one.png" } };
    const second = { type: "image_url", image_url: { url: "https://images.example/two.png" } };
    const body = { messages: [{ role: "user", content: [first, second] }] };

    await expect(prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.GEMINI)).resolves.toBe(1);
    expect(first.image_url.url).toBe("https://images.example/one.png");
    expect(second.image_url.url).toBe("data:image/png;base64,two");
  });

  it("does not mutate image blocks after the client aborts", async () => {
    const pending = deferred();
    const controller = new AbortController();
    mocks.fetchImageAsBase64.mockReturnValueOnce(pending.promise);
    const block = { type: "image_url", image_url: { url: "https://images.example/one.png" } };
    const body = { messages: [{ role: "user", content: [block] }] };

    const prefetch = prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.GEMINI, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.fetchImageAsBase64).toHaveBeenCalledTimes(1));
    controller.abort();
    pending.resolve({ url: "data:image/png;base64,one", mimeType: "image/png" });

    await expect(prefetch).resolves.toBe(0);
    expect(block.image_url.url).toBe("https://images.example/one.png");
  });
});
