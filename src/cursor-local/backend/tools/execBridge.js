/**
 * Map OpenAI tool_calls ↔ Cursor ToolCall / ExecServerMessage.
 * Canonical byok names: Shell, Read, Write, PatchEdit, Grep, Glob, Delete, Ls, ...
 */
const {
  encodeShellToolCall,
  encodeReadToolCall,
  encodeEditToolCall,
  encodeWriteToolCallAsEdit,
  encodeExecServerShell,
  encodeAgentServerExec,
  encodeToolCallStarted,
  encodeToolCallCompleted,
} = require("../proto/agentMessages");

function parseToolCall(tc) {
  const name = tc.function?.name || tc.name || "";
  let args = {};
  try {
    args = JSON.parse(tc.function?.arguments || tc.arguments || "{}");
  } catch {
    args = { raw: tc.function?.arguments };
  }
  const callId = tc.id || `call_${Date.now()}`;
  return { name, args, callId };
}

function normalizeToolName(name) {
  const n = String(name || "").trim();
  // Map aliases → byok canonical
  const lower = n.toLowerCase();
  if (lower === "edit" || lower === "str_replace" || lower === "search_replace")
    return "PatchEdit";
  if (lower === "bash" || lower === "run_terminal_cmd") return "Shell";
  if (lower === "read_file") return "Read";
  if (lower === "write_file") return "Write";
  if (lower === "delete_file") return "Delete";
  if (lower === "list_dir") return "Ls";
  if (lower === "search") return "Grep";
  // Preserve PascalCase catalog names
  if (n === "PatchEdit" || n === "TodoWrite" || n === "AskQuestion") return n;
  if (n === "CreatePlan" || n === "CallMcpTool" || n === "ReadLints") return n;
  if (n === "WebSearch" || n === "WebFetch" || n === "SwitchMode") return n;
  if (n === "AwaitShell" || n === "WriteShellStdin" || n === "ForceBackgroundShell")
    return n;
  if (n === "FetchMcpResource" || n === "GenerateImage" || n === "Task") return n;
  // Title-case common
  const titled = n.charAt(0).toUpperCase() + n.slice(1);
  if (
    [
      "Shell",
      "Read",
      "Write",
      "Delete",
      "Grep",
      "Glob",
      "Ls",
    ].includes(titled)
  )
    return titled;
  return n;
}

function encodeToolCallBody(name, args, callId) {
  const canon = normalizeToolName(name);
  if (canon === "Shell") {
    return encodeShellToolCall({
      command: args.command || args.cmd || "",
      working_directory: args.working_directory || args.cwd || "",
      description: args.description || "",
      tool_call_id: callId,
      callId,
    });
  }
  if (canon === "Read") {
    return encodeReadToolCall({ path: args.path || args.file || "" });
  }
  if (canon === "PatchEdit") {
    // byok EditToolCall field 12 for patch/edit UI
    return encodeEditToolCall({
      path: args.path,
      old_string:
        args.old_string ||
        args.oldString ||
        args.old_str ||
        args.search ||
        "",
      new_string:
        args.new_string ||
        args.newString ||
        args.new_str ||
        args.replace ||
        "",
    });
  }
  if (canon === "Write") {
    return encodeWriteToolCallAsEdit({
      path: args.path,
      contents: args.contents || args.content || args.new_string || "",
    });
  }
  if (canon === "Grep") {
    return encodeShellToolCall({
      command: `rg -n -- ${JSON.stringify(args.pattern || "")} ${JSON.stringify(args.path || ".")}`,
      tool_call_id: callId,
      callId,
      description: "Grep",
    });
  }
  if (canon === "Glob") {
    return encodeShellToolCall({
      command: `find ${JSON.stringify(args.path || ".")} -name ${JSON.stringify(args.glob_pattern || args.pattern || "*")}`,
      tool_call_id: callId,
      callId,
      description: "Glob",
    });
  }
  if (canon === "Delete") {
    return encodeShellToolCall({
      command: `rm -f -- ${JSON.stringify(args.path || "")}`,
      tool_call_id: callId,
      callId,
      description: "Delete",
    });
  }
  if (canon === "Ls") {
    return encodeShellToolCall({
      command: `ls -la -- ${JSON.stringify(args.path || ".")}`,
      tool_call_id: callId,
      callId,
      description: "Ls",
    });
  }
  if (canon === "ReadLints") {
    return encodeShellToolCall({
      command: `echo "read_lints ${JSON.stringify(args.paths || args.path || [])}"`,
      tool_call_id: callId,
      callId,
      description: "ReadLints",
    });
  }
  // Interaction / local tools — still emit ToolCall shell marker; interaction handled separately
  if (
    [
      "AskQuestion",
      "CreatePlan",
      "WebSearch",
      "WebFetch",
      "SwitchMode",
      "TodoWrite",
      "Task",
      "CallMcpTool",
      "FetchMcpResource",
      "AwaitShell",
      "GenerateImage",
    ].includes(canon)
  ) {
    return encodeShellToolCall({
      command: `true # interaction-or-local ${canon}`,
      tool_call_id: callId,
      callId,
      description: canon,
    });
  }
  // Unknown — do NOT echo tool payload (security/noise); soft no-op
  return encodeShellToolCall({
    command: `true # unsupported_tool ${canon}`,
    tool_call_id: callId,
    callId,
    description: canon,
  });
}

function needsExecChannel(name) {
  const canon = normalizeToolName(name);
  return [
    "Shell",
    "Read",
    "Write",
    "PatchEdit",
    "Grep",
    "Glob",
    "Delete",
    "Ls",
    "ReadLints",
    "WriteShellStdin",
    "ForceBackgroundShell",
    "AwaitShell",
  ].includes(canon);
}

function isInteractionTool(name) {
  return [
    "AskQuestion",
    "CreatePlan",
    "WebSearch",
    "WebFetch",
    "SwitchMode",
  ].includes(normalizeToolName(name));
}

function publishToolStart(stream, tc) {
  const mapped = parseToolCall(tc);
  mapped.canonicalName = normalizeToolName(mapped.name);
  const toolMsg = encodeToolCallBody(mapped.name, mapped.args, mapped.callId);
  mapped.toolMsg = toolMsg;
  stream.publish(
    encodeToolCallStarted(mapped.callId, mapped.callId, toolMsg),
  );

  // Only shell-like tools get ExecServerMessage shell_args (typed oneofs would be better)
  // Skip dual-channel for Write/PatchEdit pure UI (byok uses typed WriteArgs; we avoid cat/true races)
  const canon = mapped.canonicalName;
  if (canon === "Shell" || canon === "Grep" || canon === "Glob" || canon === "Delete" || canon === "Ls" || canon === "ReadLints") {
    const execId = mapped.callId;
    const execSeq = stream.execSeq++;
    let command = mapped.args.command || "";
    if (canon === "Grep") {
      command = `rg -n -- ${JSON.stringify(mapped.args.pattern || "")} ${JSON.stringify(mapped.args.path || ".")}`;
    } else if (canon === "Glob") {
      command = `find ${JSON.stringify(mapped.args.path || ".")} -name ${JSON.stringify(mapped.args.glob_pattern || mapped.args.pattern || "*")}`;
    } else if (canon === "Delete") {
      command = `rm -f -- ${JSON.stringify(mapped.args.path || "")}`;
    } else if (canon === "Ls") {
      command = `ls -la -- ${JSON.stringify(mapped.args.path || ".")}`;
    } else if (canon === "ReadLints") {
      command = `true # read_lints`;
    }
    const execBuf = encodeExecServerShell(execSeq, execId, {
      command,
      working_directory: mapped.args.working_directory || mapped.args.cwd || "",
      description: mapped.args.description || canon,
      tool_call_id: execId,
    });
    stream.publish(encodeAgentServerExec(execBuf));
  } else if (canon === "Read") {
    // Typed read path preferred; still send shell cat for clients that only run shell
    const execId = mapped.callId;
    const execSeq = stream.execSeq++;
    const execBuf = encodeExecServerShell(execSeq, execId, {
      command: `cat -- ${JSON.stringify(mapped.args.path || mapped.args.file || "")}`,
      description: "Read",
      tool_call_id: execId,
    });
    stream.publish(encodeAgentServerExec(execBuf));
  }
  // Write/PatchEdit: ToolCall only — Cursor applies via tool_call UI without shell race

  return mapped;
}

function publishToolComplete(stream, mapped, resultText) {
  // Prefer completed with same tool shape; result text is carried in history tool role
  stream.publish(
    encodeToolCallCompleted(mapped.callId, mapped.callId, mapped.toolMsg),
  );
  void resultText;
}

module.exports = {
  parseToolCall,
  normalizeToolName,
  encodeToolCallBody,
  publishToolStart,
  publishToolComplete,
  needsExecChannel,
  isInteractionTool,
};
