import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const transform = (body) =>
  new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {
    accessToken: "test-token",
  });

describe("CodexExecutor input sanitization", () => {
  it("removes all replay status fields and account-scoped reasoning ciphertext", () => {
    // Reproduced from logs/openai-responses_openai-responses_gpt-5.6-terra_20260719_002143_695
    const result = transform({
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "continue" }],
        },
        {
          type: "reasoning",
          status: "completed",
          encrypted_content: "7skkZDVYmZ/CMnr+uH/dbsZgyzQRHgNI",
          summary: [{ type: "summary_text", text: "Read the terminal." }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: "{}",
          status: "completed",
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "ok",
          status: "completed",
        },
      ],
    });

    expect(result.input).toHaveLength(4);
    expect(result.input.every((item) => item.status === undefined)).toBe(true);

    const reasoning = result.input[1];
    expect(reasoning.encrypted_content).toBeUndefined();
    expect(reasoning.summary).toEqual([
      { type: "summary_text", text: "Read the terminal." },
    ]);

    expect(result.input[2]).toMatchObject({
      type: "function_call",
      call_id: "call_1",
      name: "read_file",
      arguments: "{}",
    });
    expect(result.input[3]).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
      output: "ok",
    });
  });

  it("drops orphan function_call_output from replayed history", () => {
    // Reproduced from logs/openai-responses_openai-responses_gpt-5.6-terra_20260719_003250_104.
    // Codex returns 400 if this output is sent without its omitted function call.
    const result = transform({
      input: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will inspect tests." }],
        },
        {
          type: "function_call_output",
          call_id: "call-04d59318-04a5-4862-bbaf-3bfca34ba769-1",
          output: "terminal data",
          status: "completed",
        },
        {
          type: "function_call",
          call_id: "call_valid",
          name: "read_file",
          arguments: "{}",
          status: "completed",
        },
        {
          type: "function_call_output",
          call_id: "call_valid",
          output: "file data",
          status: "completed",
        },
      ],
    });

    expect(result.input).toHaveLength(3);
    expect(result.input.find((item) => item.call_id === "call-04d59318-04a5-4862-bbaf-3bfca34ba769-1")).toBeUndefined();
    expect(result.input.at(-1)).toMatchObject({
      type: "function_call_output",
      call_id: "call_valid",
      output: "file data",
    });
  });

  it("leaves client input without replay-only fields intact", () => {
    const result = transform({
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ]);
  });
});