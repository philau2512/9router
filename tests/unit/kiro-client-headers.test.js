/**
 * Phase 2 (Group A) — Kiro client-header fidelity.
 *
 * The executor previously sent a thin UA (`AWS-SDK-JS/3.0.0 kiro-ide/1.0.0`).
 * Kiro-Go emulates a realistic Kiro IDE client (aws-sdk-js/1.0.34 … KiroIDE-<ver>
 * + agent-mode + optout) which lowers the risk of an upstream flagging a
 * free-tier account. This test pins the new header contract WITHOUT disturbing
 * the auth branches (api_key / external_idp / idc / builder-id) or profileArn.
 */

import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import {
  KIRO_STREAMING_SDK_VERSION,
  buildKiroClientUserAgent,
} from "../../open-sse/config/kiroConstants.js";

const exec = new KiroExecutor();

describe("KiroExecutor.buildHeaders — client fidelity", () => {
  it("emits agent-mode + optout fidelity headers", () => {
    const h = exec.buildHeaders({ accessToken: "tok" });
    expect(h["x-amzn-kiro-agent-mode"]).toBe("vibe");
    expect(h["x-amzn-codewhisperer-optout"]).toBe("true");
  });

  it("UA matches the aws-sdk-js/1.0.34 … KiroIDE- shape", () => {
    const h = exec.buildHeaders({ accessToken: "tok" });
    expect(h["User-Agent"]).toMatch(
      /^aws-sdk-js\/1\.0\.34 .*api\/codewhispererstreaming#1\.0\.34.*KiroIDE-/,
    );
    expect(h["X-Amz-User-Agent"]).toMatch(/^aws-sdk-js\/1\.0\.34 KiroIDE-/);
  });

  it("derives a stable per-account machineId suffix (same account → same UA)", () => {
    const cred = { accessToken: "tok", providerSpecificData: { clientId: "acct-1" } };
    const a = exec.buildHeaders(cred);
    const b = exec.buildHeaders(cred);
    // Deterministic: same credential → identical UA (stable fingerprint).
    expect(a["User-Agent"]).toBe(b["User-Agent"]);
    // Always carries a KiroIDE-<ver>-<64hex machineId> tag now.
    expect(a["User-Agent"]).toMatch(/KiroIDE-[^ ]+-[0-9a-f]{64}$/);
  });

  it("gives different accounts different machineIds", () => {
    const a = exec.buildHeaders({
      accessToken: "tok",
      providerSpecificData: { clientId: "acct-1" },
    });
    const b = exec.buildHeaders({
      accessToken: "tok",
      providerSpecificData: { clientId: "acct-2" },
    });
    expect(a["User-Agent"]).not.toBe(b["User-Agent"]);
  });

  it("preserves the api_key auth branch (TokenType API_KEY)", () => {
    const h = exec.buildHeaders({
      accessToken: "key",
      providerSpecificData: { authMethod: "api_key" },
    });
    expect(h["Authorization"]).toBe("Bearer key");
    expect(h["TokenType"]).toBe("API_KEY");
  });

  it("preserves the external_idp auth branch (TokenType EXTERNAL_IDP)", () => {
    const h = exec.buildHeaders({
      accessToken: "tok",
      providerSpecificData: { authMethod: "external_idp" },
    });
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h["TokenType"]).toBe("EXTERNAL_IDP");
  });

  it("sets X-Amz-Target only for the CodeWhisperer surface", () => {
    const runtimeHeaders = exec.buildHeaders(
      { accessToken: "tok" },
      true,
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    );
    const codeWhispererHeaders = exec.buildHeaders(
      { accessToken: "tok" },
      true,
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
    );
    expect(runtimeHeaders["Accept"]).toBe("application/vnd.amazon.eventstream");
    expect(runtimeHeaders["X-Amz-Target"]).toBeUndefined();
    expect(codeWhispererHeaders["X-Amz-Target"]).toContain("GenerateAssistantResponse");
  });

  it("helper builds both UA strings for the streaming surface with a derived machineId", () => {
    const ua = buildKiroClientUserAgent({
      credentials: { providerSpecificData: { clientId: "acct-1" } },
      surface: "streaming",
    });
    expect(ua.streaming).toContain(`aws-sdk-js/${KIRO_STREAMING_SDK_VERSION}`);
    expect(ua.streaming).toContain("api/codewhispererstreaming");
    expect(ua.short).toMatch(/^aws-sdk-js\/1\.0\.34 KiroIDE-/);
    expect(ua.streaming).not.toMatch(/undefined/);
    expect(ua.machineId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("runtime surface swaps the sub-client version + api segment but keeps the same machineId", () => {
    const cred = { providerSpecificData: { clientId: "acct-1" } };
    const streaming = buildKiroClientUserAgent({ credentials: cred, surface: "streaming" });
    const runtime = buildKiroClientUserAgent({ credentials: cred, surface: "runtime" });
    // Same IDE install → identical machineId across sub-clients (no conflicting fingerprint).
    expect(runtime.machineId).toBe(streaming.machineId);
    expect(runtime.streaming).toContain("api/codewhispererruntime");
  });
});
