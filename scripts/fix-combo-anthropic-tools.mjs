// One-shot patch: add Anthropic-style tool_use/tool_result flatten to flattenToolHistory
// Upstream commit 86162ee — combo/fusion panel calls
import { readFileSync, writeFileSync } from "fs";

const file = "open-sse/services/combo.js";
const src = readFileSync(file, "utf8");

// Find flattenToolHistory closing block — unique anchor
const ANCHOR = "      return msg;\n    });\n}";
const idx = src.lastIndexOf(ANCHOR);
if (idx === -1) {
  console.error("Anchor not found — combo.js may already be patched or differs from expected.");
  process.exit(1);
}

// New block inserted before "return msg;"
const insertion =
`      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result")
              toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\\n");
          if (toolNames.length > 0) {
            newContent = \`\${newContent}\${newContent ? "\\n" : ""}\${TOOL_CALL_PREFIX}\${toolNames.join(", ")}]\`;
          }
          if (toolResults.length > 0) {
            newContent = \`\${newContent}\${newContent ? "\\n" : ""}\${TOOL_RESULT_PREFIX}\${toolResults.join("\\n")}]\`;
          }
          return { ...rest, content: newContent };
        }
      }
`;

const result = src.slice(0, idx) + insertion + ANCHOR.slice(0); // keep ANCHOR as-is after insertion
writeFileSync(file, result, "utf8");
console.log("combo.js — Anthropic tool_use/tool_result flatten added.");
