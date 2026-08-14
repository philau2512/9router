import { describe, it, expect } from "vitest";
import { parseLogLine, groupLogLines } from "@/app/(dashboard)/dashboard/console-log/utils/logParser";

describe("console-log logParser", () => {
  describe("parseLogLine", () => {
    it("parses request start with method, endpoint, combo, and msg count", () => {
      const line = "[15:21:09] bfxnve 📥 POST /v1/chat/completions | codex-free | 28 msgs | 21 tools";
      const parsed = parseLogLine(line);

      expect(parsed.timestamp).toBe("15:21:09");
      expect(parsed.reqId).toBe("bfxnve");
      expect(parsed.level).toBe("request");
      expect(parsed.metadata.method).toBe("POST");
      expect(parsed.metadata.endpoint).toBe("/v1/chat/completions");
      expect(parsed.metadata.combo).toBe("codex-free");
      expect(parsed.metadata.msgs).toBe(28);
    });

    it("parses model routing and does NOT match authmodel=1 as model", () => {
      const routeLine = "[15:21:09] bfxnve ℹ️ [ROUTING] cx/gpt-5.6-luna → codex/gpt-5.6-luna";
      const parsedRoute = parseLogLine(routeLine);
      expect(parsedRoute.metadata.targetModel).toBe("codex/gpt-5.6-luna");

      // TTFT line containing authmodel=1 must not extract model="1"
      const ttftLine = "[16:29:38] p68t0t:dceed7 🤯 [TTFT] OPENAI | gpt-5.6-terra | total=10870 | ttft=3980 | parse=0 | authmodel=1 | upstreamStart=2";
      const parsedTtft = parseLogLine(ttftLine);
      expect(parsedTtft.metadata.model).toBe("gpt-5.6-terra");
      expect(parsedTtft.metadata.model).not.toBe("1");
      expect(parsedTtft.metadata.duration).toBe(10870);
      expect(parsedTtft.metadata.ttft).toBe(3980);
    });

    it("parses account emails and connection hashes", () => {
      const authLine = "[15:21:09] bfxnve:fabb99 ℹ️ [AUTH] Using codex account: user@icloud.com";
      const parsedAuth = parseLogLine(authLine);
      expect(parsedAuth.reqId).toBe("bfxnve");
      expect(parsedAuth.connId).toBe("fabb99");
      expect(parsedAuth.metadata.userEmail).toBe("user@icloud.com");

      const usageLine = "[15:21:13] 📊 [USAGE] CODEX | in=43858 | out=157 | account=dceed7f8... | cache_read=42496 (96.89%)";
      const parsedUsage = parseLogLine(usageLine);
      expect(parsedUsage.metadata.tokensIn).toBe(43858);
      expect(parsedUsage.metadata.tokensOut).toBe(157);
      expect(parsedUsage.metadata.cacheRead).toBe(42496);
      expect(parsedUsage.metadata.cachePct).toBe(96.89);
      expect(parsedUsage.metadata.account).toBe("dceed7f8...");
    });
  });

  describe("groupLogLines", () => {
    it("groups related lines into a complete RequestGroup", () => {
      const rawLines = [
        "[15:21:09] bfxnve 📥 POST /v1/chat/completions | codex-free | 28 msgs",
        "[15:21:09] bfxnve ℹ️ [ROUTING] cx/gpt-5.6-luna → codex/gpt-5.6-luna",
        "[15:21:09] bfxnve:fabb99 ℹ️ [AUTH] Using codex account: user@icloud.com",
        "[15:21:10] bfxnve:fabb99 [PENDING] START | provider=codex | model=gpt-5.6-luna",
        "[15:21:13] 🌊 [STREAM] CODEX | gpt-5.6-luna | 4429ms | complete",
        "[15:21:13] 📊 [USAGE] CODEX | in=43858 | out=157 | account=fabb9953... | cache_read=42496 (96.89%)",
        "[15:21:13] bfxnve:fabb99 🤯 [TTFT] CODEX | gpt-5.6-luna | total=4432 | ttft=1431 | parse=0 | authmodel=1",
      ];

      const { groups } = groupLogLines(rawLines);
      expect(groups).toHaveLength(1);

      const req = groups[0];
      expect(req.id).toBe("bfxnve");
      expect(req.connId).toBe("fabb99");
      expect(req.endpoint).toBe("/v1/chat/completions");
      expect(req.combo).toBe("codex-free");
      expect(req.model).toBe("codex/gpt-5.6-luna");
      expect(req.account).toBe("user@icloud.com");
      expect(req.tokensIn).toBe(43858);
      expect(req.tokensOut).toBe(157);
      expect(req.cachePct).toBe(96.89);
      expect(req.duration).toBe(4432);
      expect(req.ttft).toBe(1431);
      expect(req.status).toBe("success");
    });

    it("preserves custom combo name over generic connection ID hash", () => {
      const rawLines = [
        "[16:18:37] jhcc93:dceed7 POST /v1/responses | leokun-byok | 148 msgs",
        "[16:18:37] jhcc93:dceed7 ℹ️ [ROUTING] custom-gpt → openai-compatible-chat-f8e452d1-ab61-42ef-a9cb-5599f26c3437/gpt-5.6-terra",
        "[16:18:40] 🌊 [STREAM] OPENAI | gpt-5.6-terra | 3860ms | complete",
        "[16:18:40] 📊 [USAGE] OPENAI | in=177000 | out=114 | account=dceed7f8... | cache_read=174000 (98.3%)",
        "[16:18:40] jhcc93:dceed7 🤯 [TTFT] OPENAI | gpt-5.6-terra | total=3860 | ttft=3080 | authmodel=5",
      ];

      const { groups } = groupLogLines(rawLines);
      expect(groups).toHaveLength(1);

      const req = groups[0];
      expect(req.id).toBe("jhcc93");
      expect(req.combo).toBe("leokun-byok");
      // Must preserve combo name 'leokun-byok' instead of 'dceed7f8...'
      expect(req.account).toBe("leokun-byok");
      // Must extract clean model name 'gpt-5.6-terra' instead of '5' (from authmodel=5) or long UUID
      expect(req.model).toBe("gpt-5.6-terra");
    });
  });
});
