/**
 * Workspace context extractor from ConversationStateStructure (AgentRunRequest.conversation_state).
 * Byok extracts workspace paths from field 9 (previous_workspace_uris) and agent_type=22.
 * We extract: previous_workspace_uris and active_branch_name.
 */
const {
  decodeFields,
  fieldString,
  fieldBytes,
  collectStrings,
} = require("../proto/wire");

/**
 * @param {Buffer|null} conversationStateBuf — raw bytes of ConversationStateStructure
 * @returns {{ workspacePaths: string[], activeBranch: string }}
 */
function extractConversationStateContext(conversationStateBuf) {
  const result = { workspacePaths: [], activeBranch: "" };
  if (!conversationStateBuf || !conversationStateBuf.length) return result;
  try {
    const fields = decodeFields(conversationStateBuf);
    // previous_workspace_uris = 9 (repeated string)
    for (const f of fields) {
      if (f.fieldNumber === 9 && f.wireType === 2) {
        const s = f.value.toString("utf8").trim();
        if (s && !result.workspacePaths.includes(s)) result.workspacePaths.push(s);
      }
    }
    // active_branch_name = 19
    for (const f of fields) {
      if (f.fieldNumber === 19 && f.wireType === 2) {
        const s = f.value.toString("utf8").trim();
        if (s) result.activeBranch = s;
      }
    }
    // Fallback: collect file-path-looking strings if nothing found
    if (!result.workspacePaths.length) {
      const strings = collectStrings(conversationStateBuf);
      for (const s of strings) {
        if ((s.includes("/") || s.includes("\\")) && s.length > 3 && s.length < 500) {
          if (result.workspacePaths.length < 3) result.workspacePaths.push(s);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return result;
}

/**
 * Format workspace context snippet for system prompt injection.
 */
function formatWorkspaceContext(ctx) {
  const lines = [];
  if (ctx.workspacePaths.length) {
    lines.push(`<workspace_paths>\n${ctx.workspacePaths.join("\n")}\n</workspace_paths>`);
  }
  if (ctx.activeBranch) lines.push(`<active_branch>${ctx.activeBranch}</active_branch>`);
  return lines.join("\n");
}

module.exports = { extractConversationStateContext, formatWorkspaceContext };
