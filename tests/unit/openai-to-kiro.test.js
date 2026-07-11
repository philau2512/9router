/**
 * Unit tests for open-sse/translator/request/openai-to-kiro.js
 *
 * Tests cover:
 *  - buildKiroPayload() - basic message conversion
 *  - Image forwarding fix: images in currentMessage must be included in payload
 */

import { describe, it, expect } from "vitest";
import { buildKiroPayload } from "../../open-sse/translator/request/openai-to-kiro.js";

describe("buildKiroPayload", () => {
  describe("basic message conversion", () => {
    it("should convert a simple text message", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("Hello");
      expect(currentMsg.userInputMessage.modelId).toBe("claude-sonnet-4.6");
      expect(currentMsg.userInputMessage.origin).toBe("AI_EDITOR");
    });

    it("should not include images field when no images are present", () => {
      const body = {
        messages: [{ role: "user", content: "No images here" }],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });

    it("should fallback to 'continue' for empty message content without tool results", () => {
      const body = {
        messages: [{ role: "user", content: "" }],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("continue");
    });

    it("should fallback to '[Tool Output]' for empty message content with tool results", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                content: "some output",
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "some_tool",
              parameters: {},
            },
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("[Tool Output]");
    });
  });

  describe("image forwarding", () => {
    it("should forward base64 image from image_url content part", () => {
      const fakeBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${fakeBase64}` },
              },
            ],
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeDefined();
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
      expect(currentMsg.userInputMessage.images[0].format).toBe("png");
      expect(currentMsg.userInputMessage.images[0].source.bytes).toBe(
        fakeBase64,
      );
    });

    it("should forward multiple base64 images", () => {
      const fakeBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Compare these images" },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${fakeBase64}` },
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${fakeBase64}` },
              },
            ],
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toHaveLength(2);
      expect(currentMsg.userInputMessage.images[0].format).toBe("jpeg");
      expect(currentMsg.userInputMessage.images[1].format).toBe("png");
    });

    it("should not include images field when images array is empty", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Just text" }],
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });

    it("should include both images and text content together", () => {
      const fakeBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${fakeBase64}` },
              },
            ],
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain(
        "What is in this image?",
      );
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
    });

    it("should treat http image URLs as text fallback (Kiro only supports base64)", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/photo.jpg" },
              },
            ],
          },
        ],
      };

      const result = buildKiroPayload("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      // HTTP URLs are not supported by Kiro — converted to text placeholder
      expect(currentMsg.userInputMessage.images).toBeUndefined();
      expect(currentMsg.userInputMessage.content).toContain(
        "[Image: https://example.com/photo.jpg]",
      );
    });
  });

  describe("profileArn resolution", () => {
    it("omits profileArn for builder-id with no stored ARN (executor discovers it)", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const credentials = {
        providerSpecificData: {
          profileArn: null,
          authMethod: "builder-id",
        },
      };
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        body,
        true,
        credentials,
      );
      // No stored ARN yet: buildKiroPayload emits nothing. The executor's
      // ListAvailableProfiles discovery populates the real per-account ARN
      // before the request goes out (a hardcoded ARN would 403; omitting
      // permanently would 400).
      expect(result.profileArn || "").toBe("");
    });

    it("USES the account's own stored ARN for builder-id (discovered, real)", () => {
      const realArn =
        "arn:aws:codewhisperer:us-east-1:111122223333:profile/REALBUILDERID";
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        {
          providerSpecificData: {
            profileArn: realArn,
            authMethod: "builder-id",
          },
        },
      );
      // A Builder ID account's own discovered ARN is the ONLY value that works;
      // it must be sent, not ignored.
      expect(result.profileArn).toBe(realArn);
    });

    it("falls back to social shared profileArn when authMethod is google/github", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const credentials = {
        providerSpecificData: {
          profileArn: null,
          authMethod: "google",
        },
      };
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        body,
        true,
        credentials,
      );
      expect(result.profileArn).toBe(
        "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
      );
    });
  });

  // Every chat-capable Kiro account has its OWN real per-account profileArn.
  // The gateway rejects a missing ARN (400 "profileArn is required") and a
  // wrong/placeholder ARN (403 "User is not authorized"). So we always prefer
  // the account's own stored/discovered ARN.
  describe("profileArn always prefers the account's own ARN", () => {
    it("uses the stored ARN for builder-id", () => {
      const ownArn =
        "arn:aws:codewhisperer:us-east-1:111122223333:profile/OWNBUILDERID";
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        {
          providerSpecificData: {
            profileArn: ownArn,
            authMethod: "builder-id",
          },
        },
      );
      expect(result.profileArn).toBe(ownArn);
    });

    it("uses the stored ARN for imported tokens", () => {
      const ownArn =
        "arn:aws:codewhisperer:us-east-1:222233334444:profile/OWNIMPORTED";
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        {
          providerSpecificData: {
            profileArn: ownArn,
            authMethod: "imported",
          },
        },
      );
      expect(result.profileArn).toBe(ownArn);
    });

    it("uses the stored ARN for account-bound api_key auth", () => {
      const ownArn =
        "arn:aws:codewhisperer:us-east-1:444455556666:profile/OWNACCOUNT";
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        {
          providerSpecificData: {
            profileArn: ownArn,
            authMethod: "api_key",
          },
        },
      );
      expect(result.profileArn).toBe(ownArn);
    });

    it("omits profileArn for idc with no stored ARN (executor discovers it)", () => {
      const result = buildKiroPayload(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "Hello" }] },
        true,
        {
          providerSpecificData: {
            profileArn: null,
            authMethod: "idc",
          },
        },
      );
      // No stored ARN: the executor's discovery step fills it in before send.
      expect(result.profileArn || "").toBe("");
    });
  });
});
