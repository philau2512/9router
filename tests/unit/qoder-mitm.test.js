import { describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const { TARGET_HOSTS, getToolForHost, QODER_CONNECT_HOST } = require("../../src/mitm/config.js");
const { qoderEncodeBody } = require("../../src/lib/qoder/encoding.js");
const {
  intercept,
  extractQoderModel,
  pipeQoderSSE,
  __test__: qoderHandlerTest,
} = require("../../src/mitm/handlers/qoder.js");

function createResponseRecorder() {
  return {
    headersSent: false,
    statusCode: null,
    headers: null,
    chunks: [],
    writeHead(statusCode, headers) {
      this.headersSent = true;
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(Buffer.from(chunk).toString("utf8"));
    },
    end(chunk) {
      if (chunk) this.write(chunk);
      this.ended = true;
    },
  };
}

describe("Qoder IDE MITM configuration", () => {
  const qoder = MITM_TOOLS.qoder;

  it("registers qoder in MITM_TOOLS with mandatory default model", () => {
    expect(qoder).toBeDefined();
    expect(qoder.id).toBe("qoder");
    expect(qoder.name).toBe("Qoder IDE");
    expect(
      qoder.defaultModels.find((m) => m.id === "qmodel_latest")?.mandatory,
    ).toBe(true);
  });

  it("includes Qoder domains in TARGET_HOSTS and TOOL_HOSTS", () => {
    const { TOOL_HOSTS } = require("../../src/shared/constants/mitmToolHosts.js");
    expect(TARGET_HOSTS).toContain("api2.qoder.sh");
    expect(TARGET_HOSTS).toContain("api3.qoder.sh");
    expect(TARGET_HOSTS).toContain("center.qoder.sh");
    expect(TOOL_HOSTS.qoder).toContain("api2.qoder.sh");
    expect(TOOL_HOSTS.qoder).toContain("api3.qoder.sh");
  });

  it("correctly identifies Qoder hosts in getToolForHost", () => {
    expect(getToolForHost("api2.qoder.sh")).toBe("qoder");
    expect(getToolForHost("api3.qoder.sh")).toBe("qoder");
    expect(getToolForHost("openapi.qoder.sh")).toBe("qoder");
    expect(getToolForHost("center.qoder.sh")).toBe("qoder");
    expect(getToolForHost("api.qoder.sh")).toBe("qoder");
  });

  it("only intercepts the direct Qoder agent IP through CONNECT", () => {
    const { isQoderConnectTarget } = require("../../src/mitm/config.js");
    expect(isQoderConnectTarget("47.57.243.249")).toBe(true);
    expect(isQoderConnectTarget("api3.qoder.sh")).toBe(false);
    expect(isQoderConnectTarget("center.qoder.sh")).toBe(false);
    expect(isQoderConnectTarget("example.com")).toBe(false);
    expect(QODER_CONNECT_HOST).toBe("api3.qoder.sh");
  });

  it("keeps the configured default alias available for model-less native chat", () => {
    expect(
      qoder.defaultModels.find((model) => model.id === "qmodel_latest"),
    ).toMatchObject({ alias: "qmodel_latest", mandatory: true });
  });

  it("extracts model from plaintext and WAF-encoded Qoder bodies", () => {
    const { extractModel } = require("../../src/mitm/config.js");

    const json = JSON.stringify({ chat_context: { modelConfig: { model: "qmodel_latest" } } });
    expect(extractModel("/agent_chat_generation", Buffer.from(json))).toBe("qmodel_latest");

    const encoded = qoderEncodeBody(json);
    expect(extractModel("/agent_chat_generation", Buffer.from(encoded))).toBe("qmodel_latest");
  });

  it("extracts a nested Qoder model from the encoded native chat shape", () => {
    const payload = {
      request: {
        chat_context: {
          modelConfig: { model: "qmodel_latest" },
        },
      },
      telemetry: { model: "telemetry-only" },
    };
    expect(
      extractQoderModel(
        Buffer.from(qoderEncodeBody(JSON.stringify(payload)), "latin1"),
      ),
    ).toBe("qmodel_latest");
  });

  it("adds the selected model to model-less native Qoder payloads", async () => {
    const payload = {
      messages: [{ role: "user", content: "hello from Qoder" }],
    };
    const routerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    try {
      await intercept(
        { headers: { host: "api2.qoder.sh", "x-qoder-client": "ide" } },
        createResponseRecorder(),
        Buffer.from(qoderEncodeBody(JSON.stringify(payload)), "latin1"),
        "dynamic-ai-agents",
      );

      expect(JSON.parse(routerFetch.mock.calls[0][1].body)).toMatchObject({
        model: "dynamic-ai-agents",
      });
    } finally {
      routerFetch.mockRestore();
    }
  });

  it("uses text blocks from native Qoder message contents", () => {
    expect(
      qoderHandlerTest.extractQoderMessages({
        messages: [
          {
            role: "user",
            content: "",
            contents: [
              { type: "text", text: "<user_query>\nQODER-PROBE-84721\n</user_query>" },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        role: "user",
        content: "<user_query>\nQODER-PROBE-84721\n</user_query>",
      },
    ]);
  });

  it("moves Qoder rules into a system message", () => {
    expect(
      qoderHandlerTest.extractQoderMessages({
        messages: [
          {
            role: "user",
            contents: [
              {
                type: "text",
                text: [
                  "<rules>",
                  "Always respond in Vietnamese.",
                  "</rules>",
                  "<user_query>",
                  "Explain this code.",
                  "</user_query>",
                ].join("\n"),
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { role: "system", content: "Always respond in Vietnamese." },
      { role: "user", content: "Explain this code." },
    ]);
  });

  it("injects local Qoder rules into agent requests when native payload omits them", async () => {
    qoderHandlerTest.qoderSessions.clear();
    const originalHome = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-rules-"));
    const rulesDir = path.join(tempHome, ".qoder", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "main-rule.md"),
      [
        "---",
        "trigger: always_on",
        "response_language: vi",
        "---",
        "Always respond in Vietnamese.",
      ].join("\n"),
    );
    process.env.USERPROFILE = tempHome;
    const routerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: [DONE]\\n\\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    try {
      await intercept(
        { headers: { host: "api3.qoder.sh" } },
        createResponseRecorder(),
        Buffer.from(
          qoderEncodeBody(
            JSON.stringify({
              session_id: "agent-rule-session",
              business: { type: "agent" },
              messages: [{ role: "user", content: "Say hello." }],
            }),
          ),
          "latin1",
        ),
        "router-model",
      );

      const forwardedMessages = JSON.parse(routerFetch.mock.calls[0][1].body).messages;
      expect(forwardedMessages).toEqual([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Global Qoder rule loaded from"),
        }),
        { role: "user", content: "Say hello." },
      ]);
      expect(forwardedMessages[0].content).toContain(
        "Always respond in Vietnamese.",
      );
      expect(forwardedMessages[0].content).toContain(
        "Do not claim that this rule file is unavailable or unread.",
      );
      expect(forwardedMessages[0].content).not.toContain("trigger: always_on");
    } finally {
      routerFetch.mockRestore();
      qoderHandlerTest.qoderSessions.clear();
      process.env.USERPROFILE = originalHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("does not route Qoder background-memory requests to the configured model", async () => {
    const routerFetch = vi.spyOn(globalThis, "fetch");
    const res = createResponseRecorder();

    try {
      await intercept(
        { headers: { host: "api3.qoder.sh" } },
        res,
        Buffer.from(
          qoderEncodeBody(
            JSON.stringify({
              session_id: "agent-rule-session",
              business: { type: "memory" },
              messages: [{ role: "user", content: "Extract memories." }],
            }),
          ),
          "latin1",
        ),
        "router-model",
      );

      expect(routerFetch).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(204);
    } finally {
      routerFetch.mockRestore();
    }
  });

  it("merges local rules into Qoder's native system prompt", () => {
    expect(
      qoderHandlerTest.prependQoderRules(
        [
          { role: "system", content: "Native Qoder instruction." },
          { role: "user", content: "Hello." },
        ],
        [{ role: "system", content: "Always respond in Vietnamese." }],
      ),
    ).toEqual([
      {
        role: "system",
        content:
          "Native Qoder instruction.\n\nAlways respond in Vietnamese.",
      },
      { role: "user", content: "Hello." },
    ]);
  });

  it("uses the native chat_context prompt when Qoder omits messages", async () => {
    const routerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const prompt = "What is 2 + 2?";

    try {
      await intercept(
        { headers: { host: "api3.qoder.sh" } },
        createResponseRecorder(),
        Buffer.from(
          qoderEncodeBody(
            JSON.stringify({
              session_id: "native-prompt-session",
              chat_context: { extra: { originalContent: prompt } },
            }),
          ),
          "latin1",
        ),
        "router-model",
      );

      const forwardedMessages = JSON.parse(routerFetch.mock.calls[0][1].body).messages;
      expect(forwardedMessages.at(-1)).toEqual({ role: "user", content: prompt });
      expect(forwardedMessages).toContainEqual(
        expect.objectContaining({ role: "system" }),
      );
    } finally {
      routerFetch.mockRestore();
      qoderHandlerTest.qoderSessions.clear();
    }
  });

  it("wraps OpenAI SSE chunks in Qoder's response envelope", async () => {
    const response = new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
    const res = createResponseRecorder();

    await pipeQoderSSE(response, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/event-stream");
    const envelopes = res.chunks
      .join("")
      .split("\n\n")
      .filter(Boolean)
      .map((frame) => JSON.parse(frame.slice("data: ".length)));
    expect(envelopes).toEqual([
      {
        statusCodeValue: 200,
        body: '{"choices":[{"delta":{"content":"ok"}}]}',
      },
      { statusCodeValue: 200, body: "[DONE]" },
    ]);
  });

  it("keeps native Qoder conversation history when later requests only contain the new user turn", () => {
    const history = [
      { role: "user", content: "Remember the secret word is cedar." },
      { role: "assistant", content: "I will remember cedar." },
    ];
    expect(
      qoderHandlerTest.mergeQoderHistory(history, [
        { role: "user", content: "What is the secret word?" },
      ]),
    ).toEqual([
      ...history,
      { role: "user", content: "What is the secret word?" },
    ]);
  });

  it("persists streamed assistant tool calls and forwards the matching tool result", async () => {
    qoderHandlerTest.qoderSessions.clear();
    const sessionId = "qoder-tool-session";
    const routerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Paris\\"}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    ).mockResolvedValueOnce(
      new Response("data: [DONE]\\n\\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    try {
      await intercept(
        { headers: { host: "api3.qoder.sh" } },
        createResponseRecorder(),
        Buffer.from(
          qoderEncodeBody(
            JSON.stringify({
              session_id: sessionId,
              messages: [{ role: "user", content: "What is the weather?" }],
            }),
          ),
          "latin1",
        ),
        "router-model",
      );

      expect(qoderHandlerTest.qoderSessions.get(sessionId)?.messages).toEqual([
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_weather",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"city":"Paris"}',
              },
            },
          ],
        },
      ]);

      await intercept(
        { headers: { host: "api3.qoder.sh" } },
        createResponseRecorder(),
        Buffer.from(
          qoderEncodeBody(
            JSON.stringify({
              session_id: sessionId,
              messages: [
                {
                  role: "tool",
                  tool_call_id: "call_weather",
                  content: '{"temperature":"21C"}',
                },
              ],
            }),
          ),
          "latin1",
        ),
        "router-model",
      );

      const secondRequest = JSON.parse(routerFetch.mock.calls[1][1].body);
      const secondMessages = secondRequest.messages;
      expect(secondMessages).toContainEqual({
        role: "user",
        content: "What is the weather?",
      });
      expect(secondMessages).toContainEqual(
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "call_weather",
              function: expect.objectContaining({ name: "get_weather" }),
            }),
          ],
        }),
      );
      expect(secondMessages).toContainEqual({
        role: "tool",
        tool_call_id: "call_weather",
        content: '{"temperature":"21C"}',
      });
    } finally {
      routerFetch.mockRestore();
      qoderHandlerTest.qoderSessions.clear();
    }
  });

  it("decodes an encoded Qoder request before forwarding it to 9Router", async () => {
    const payload = {
      model: "qmodel_latest",
      chat_context: { modelConfig: { model: "qmodel_latest" } },
      messages: [{ role: "user", content: "hello from Qoder" }],
    };
    const routerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const res = createResponseRecorder();

    try {
      await intercept(
        { headers: { host: "api3.qoder.sh", "x-qoder-client": "ide" } },
        res,
        Buffer.from(qoderEncodeBody(JSON.stringify(payload)), "latin1"),
        "router-model",
      );

      expect(routerFetch).toHaveBeenCalledOnce();
      const [url, options] = routerFetch.mock.calls[0];
      expect(url).toBe("http://localhost:20128/v1/chat/completions");
      expect(JSON.parse(options.body)).toMatchObject({
        model: "router-model",
        chat_context: { modelConfig: { model: "router-model" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["Content-Type"]).toContain("text/event-stream");
      const qoderFrames = res
        .chunks
        .join("")
        .split("\n\n")
        .filter(Boolean)
        .map((frame) => JSON.parse(frame.slice("data: ".length)));
      expect(qoderFrames.at(-1)).toMatchObject({
        statusCodeValue: 200,
        body: "[DONE]",
      });
    } finally {
      routerFetch.mockRestore();
    }
  });
});
