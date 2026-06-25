import { describe, it, expect } from "vitest";
import {
  maskProxyUrl,
  sanitizeProxyError,
  normalizeProxyUrl,
  shouldBypassByNoProxy,
} from "open-sse/utils/proxy-helper.js";

describe("Proxy Helper Utilities", () => {
  describe("maskProxyUrl", () => {
    it("leaves standard proxy URLs without credentials unchanged", () => {
      const url = "http://127.0.0.1:7890";
      expect(maskProxyUrl(url)).toBe("http://127.0.0.1:7890/");
    });

    it("redacts username and password in proxy URLs", () => {
      const url = "http://admin:secret123@myproxy.com:8080/path?query=1";
      expect(maskProxyUrl(url)).toBe("http://***:***@myproxy.com:8080/path?query=1");
    });

    it("handles SOCKS proxy URLs with credentials", () => {
      const url = "socks5://user:pass@127.0.0.1:1080";
      expect(maskProxyUrl(url)).toBe("socks5://***:***@127.0.0.1:1080");
    });

    it("returns placeholder for invalid URLs", () => {
      expect(maskProxyUrl("not-a-url")).toBe("<invalid-proxy-url>");
      expect(maskProxyUrl("")).toBe("<invalid-proxy-url>");
      expect(maskProxyUrl(null)).toBe("<invalid-proxy-url>");
    });
  });

  describe("sanitizeProxyError", () => {
    it("formats standard error properties", () => {
      const err = { name: "ConnectTimeoutError", code: "ETIMEDOUT", message: "connection timed out" };
      expect(sanitizeProxyError(err)).toBe("ConnectTimeoutError/ETIMEDOUT: connection timed out");
    });

    it("redacts credentials from proxy URLs embedded inside error messages", () => {
      const err = {
        name: "Error",
        message: "Failed to connect to http://user:pass123@proxy.com:8080",
      };
      expect(sanitizeProxyError(err)).toBe("Error: Failed to connect to <redacted-url>");
    });

    it("redacts proxy-authorization headers inside error messages", () => {
      const err = {
        name: "ProxyError",
        message: "Proxy rejected authorization: proxy-authorization=Basic dXNlcjpwYXNz",
      };
      expect(sanitizeProxyError(err)).toContain("authorization=<redacted>");
    });

    it("slices excessively long error messages to safe limit", () => {
      const longMessage = "a".repeat(300);
      const err = { name: "LongError", message: longMessage };
      const sanitized = sanitizeProxyError(err);
      expect(sanitized.length).toBeLessThan(300);
    });
  });

  describe("normalizeProxyUrl", () => {
    it("returns null for empty inputs", () => {
      expect(normalizeProxyUrl("")).toBeNull();
      expect(normalizeProxyUrl(null)).toBeNull();
    });

    it("returns valid URL as is", () => {
      expect(normalizeProxyUrl("http://localhost:7890")).toBe("http://localhost:7890");
    });

    it("automatically prepends http protocol to bare host:port inputs", () => {
      expect(normalizeProxyUrl("127.0.0.1:8888")).toBe("http://127.0.0.1:8888");
    });
  });

  describe("shouldBypassByNoProxy", () => {
    it("returns false if noProxy pattern list is empty", () => {
      expect(shouldBypassByNoProxy("https://api.openai.com", "")).toBe(false);
    });

    it("matches wildcard pattern", () => {
      expect(shouldBypassByNoProxy("https://api.openai.com", "*")).toBe(true);
    });

    it("matches exact hostnames and subdomains of the suffix", () => {
      expect(shouldBypassByNoProxy("https://api.openai.com/v1", "api.openai.com")).toBe(true);
      expect(shouldBypassByNoProxy("https://api.openai.com/v1", "openai.com")).toBe(true);
      expect(shouldBypassByNoProxy("https://api.anthropic.com/v1", "openai.com")).toBe(false);
    });

    it("matches suffix dot subdomains", () => {
      expect(shouldBypassByNoProxy("https://sub.api.openai.com", ".openai.com")).toBe(true);
      expect(shouldBypassByNoProxy("https://openai.com", ".openai.com")).toBe(true);
    });
  });
});
