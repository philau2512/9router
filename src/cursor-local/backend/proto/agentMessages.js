/**
 * Encode/decode subset of agent.v1 / aiserver.v1 messages used by agent loop.
 */
const {
  concat,
  encodeString,
  encodeMessage,
  encodeInt64,
  encodeInt64Always,
  encodeBool,
  encodeEnum,
  encodeUint32,
  encodeDouble,
  decodeFields,
  fieldString,
  fieldInt,
  fieldMessage,
  fieldMessages,
  fieldBytes,
  collectStrings,
} = require("./wire");

// AgentMode enum
const AGENT_MODE = {
  UNSPECIFIED: 0,
  AGENT: 1,
  ASK: 2,
  PLAN: 3,
  DEBUG: 4,
  TRIAGE: 5,
  PROJECT: 6,
  MULTITASK: 7,
};

function modeFromNumber(n) {
  switch (Number(n)) {
    case 2:
      return "ask";
    case 3:
      return "plan";
    case 4:
      return "debug";
    case 7:
      return "multitask";
    default:
      return "agent";
  }
}

function modeToNumber(mode) {
  switch (String(mode || "").toLowerCase()) {
    case "ask":
      return AGENT_MODE.ASK;
    case "plan":
      return AGENT_MODE.PLAN;
    case "debug":
      return AGENT_MODE.DEBUG;
    case "multitask":
      return AGENT_MODE.MULTITASK;
    default:
      return AGENT_MODE.AGENT;
  }
}

// ── aiserver BidiAppend ──────────────────────────────────────────

function decodeBidiAppendRequest(buf) {
  const fields = decodeFields(buf);
  // field 1 `data` is a string of hex-encoded AgentClientMessage (byok DecodeAgentClientMessage).
  // Some builds may send raw bytes; normalize everything to hex for the decoder.
  const dataBytes = fieldBytes(fields, 1);
  let data = "";
  if (dataBytes && dataBytes.length) {
    const asStr = dataBytes.toString("utf8").trim();
    if (/^[0-9a-fA-F]+$/.test(asStr) && asStr.length % 2 === 0) {
      data = asStr;
    } else {
      // raw protobuf payload of AgentClientMessage
      data = dataBytes.toString("hex");
    }
  } else {
    data = fieldString(fields, 1).trim();
  }
  // field 2: BidiRequestId { request_id = 1 }
  let requestId = "";
  const reqIdFields = fieldMessage(fields, 2);
  if (reqIdFields?.length) {
    requestId = fieldString(reqIdFields, 1);
  }
  if (!requestId) {
    requestId = fieldString(fields, 2);
  }
  const appendSeqno = fieldInt(fields, 3);
  return { data, requestId, appendSeqno, rawFieldCount: fields.length };
}

function encodeBidiAppendResponse() {
  return Buffer.alloc(0);
}

function encodeBidiRequestId(requestId) {
  return encodeString(1, requestId);
}

function decodeBidiRequestId(buf) {
  const fields = decodeFields(buf);
  return fieldString(fields, 1);
}

// ── AgentClientMessage ───────────────────────────────────────────

function decodeAgentClientMessageFromHex(hexData) {
  const trimmed = String(hexData || "").trim();
  if (!trimmed) return { kind: "empty", raw: null };
  // Mirror byok hex.DecodeString — reject non-hex / odd length
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) {
    return { kind: "invalid", error: "not valid hex" };
  }
  const payload = Buffer.from(trimmed, "hex");
  if (!payload.length) return { kind: "empty", raw: null };
  return decodeAgentClientMessage(payload);
}

function decodeAgentClientMessage(buf) {
  const fields = decodeFields(buf);
  // field 1: run_request
  const runRaw = fieldBytes(fields, 1);
  if (runRaw) {
    return { kind: "run_request", run: decodeAgentRunRequest(runRaw) };
  }
  // field 8: prewarm
  const prewarmRaw = fieldBytes(fields, 8);
  if (prewarmRaw) {
    return {
      kind: "prewarm_request",
      run: decodeAgentRunRequest(prewarmRaw),
      prewarm: true,
    };
  }
  // field 4: conversation_action
  const actionRaw = fieldBytes(fields, 4);
  if (actionRaw) {
    return decodeConversationActionMessage(actionRaw);
  }
  // field 2: exec_client_message
  const execRaw = fieldBytes(fields, 2);
  if (execRaw) {
    return { kind: "exec_client_message", exec: decodeExecClientMessage(execRaw) };
  }
  // field 7: heartbeat
  if (fields.some((f) => f.fieldNumber === 7)) {
    return { kind: "client_heartbeat" };
  }
  // field 3: kv
  if (fields.some((f) => f.fieldNumber === 3)) {
    return { kind: "kv_client_message" };
  }
  // field 6: interaction_response
  if (fields.some((f) => f.fieldNumber === 6)) {
    return { kind: "interaction_response" };
  }
  return { kind: "unknown", fields };
}

function decodeAgentRunRequest(buf) {
  const fields = decodeFields(buf);
  // model_details = 3, requested_model = 9, conversation_id = 5, action = 2
  const modelDetails = fieldMessage(fields, 3);
  const requestedModel = fieldMessage(fields, 9);
  let modelId =
    fieldString(requestedModel, 1) || fieldString(modelDetails, 1) || "default";
  // variant channelId:effort
  let thinkingEffort = "";
  if (modelId.includes(":")) {
    const [id, effort] = modelId.split(":");
    modelId = id;
    thinkingEffort = effort || "";
  }
  // parameters on requested model field 3 repeated
  const params = fieldMessages(requestedModel, 3);
  for (const p of params) {
    const pid = fieldString(p, 1);
    const pval = fieldString(p, 2);
    if (pid && /thinking|effort/i.test(pid) && pval) thinkingEffort = pval;
  }

  const conversationId = fieldString(fields, 5) || "";
  const actionRaw = fieldBytes(fields, 2);
  let userText = "";
  let mode = "agent";
  if (actionRaw) {
    const action = decodeConversationActionInner(actionRaw);
    userText = action.userText || "";
    mode = action.mode || mode;
    if (action.cancel) {
      return {
        modelId,
        thinkingEffort,
        conversationId,
        userText: "",
        mode,
        cancel: true,
      };
    }
  }

  // Fallback: longest printable string as user text if structured parse empty
  if (!userText) {
    const strings = collectStrings(buf).filter((s) => s.length > 1 && s.length < 8000);
    // prefer longer natural language
    strings.sort((a, b) => b.length - a.length);
    userText = strings[0] || "";
  }

  return {
    modelId,
    thinkingEffort,
    conversationId,
    userText,
    mode,
    cancel: false,
  };
}

function decodeConversationActionMessage(buf) {
  const inner = decodeConversationActionInner(buf);
  if (inner.cancel) return { kind: "cancel", ...inner };
  if (inner.userText) {
    return {
      kind: "run_request",
      run: {
        modelId: "default",
        conversationId: "",
        userText: inner.userText,
        mode: inner.mode || "agent",
        cancel: false,
        thinkingEffort: "",
      },
    };
  }
  return { kind: "conversation_action", ...inner };
}

function decodeConversationActionInner(buf) {
  const fields = decodeFields(buf);
  // cancel_action = 3
  if (fields.some((f) => f.fieldNumber === 3)) {
    return { cancel: true, userText: "", mode: "agent" };
  }
  // user_message_action = 1
  const uma = fieldBytes(fields, 1);
  if (uma) {
    const umFields = decodeFields(uma);
    // UserMessage = field 1
    const um = fieldMessage(umFields, 1);
    const text = fieldString(um, 1);
    const mode = modeFromNumber(fieldInt(um, 4));
    return { cancel: false, userText: text, mode };
  }
  return { cancel: false, userText: "", mode: "agent" };
}

function decodeExecClientMessage(buf) {
  const fields = decodeFields(buf);
  const id = fieldInt(fields, 1);
  const execId = fieldString(fields, 15);
  // Collect any result-ish strings
  const strings = collectStrings(buf);
  const resultText = strings.filter((s) => s.length > 0).slice(0, 20).join("\n");
  return { id, execId, resultText, raw: buf };
}

// ── AgentServerMessage encoders ──────────────────────────────────

function encodeTextDelta(text) {
  // InteractionUpdate { text_delta = 1: TextDeltaUpdate { text = 1 } }
  const textDelta = encodeString(1, text);
  const interaction = encodeMessage(1, textDelta);
  // AgentServerMessage { interaction_update = 1 }
  return encodeMessage(1, interaction);
}

function encodeThinkingDelta(text) {
  const thinking = encodeString(1, text);
  // InteractionUpdate.thinking_delta = 4
  const interaction = encodeMessage(4, thinking);
  return encodeMessage(1, interaction);
}

function encodeHeartbeat() {
  // InteractionUpdate.heartbeat = 13: empty HeartbeatUpdate
  const heartbeat = Buffer.alloc(0);
  const interaction = encodeMessage(13, heartbeat);
  return encodeMessage(1, interaction);
}

function encodeTurnEnded(usage = {}) {
  const parts = [
    encodeInt64(1, usage.input_tokens || 0),
    encodeInt64(2, usage.output_tokens || 0),
  ];
  const turnEnded = concat(...parts);
  // InteractionUpdate.turn_ended = 14
  const interaction = encodeMessage(14, turnEnded);
  return encodeMessage(1, interaction);
}

function encodeToolCallStarted(callId, modelCallId, toolCallMsg) {
  // ToolCallStartedUpdate { call_id=1, tool_call=2, model_call_id=3 }
  const body = concat(
    encodeString(1, callId),
    encodeMessage(2, toolCallMsg),
    encodeString(3, modelCallId || callId),
  );
  // InteractionUpdate.tool_call_started = 2
  const interaction = encodeMessage(2, body);
  return encodeMessage(1, interaction);
}

function encodeToolCallCompleted(callId, modelCallId, toolCallMsg) {
  const body = concat(
    encodeString(1, callId),
    encodeMessage(2, toolCallMsg),
    encodeString(3, modelCallId || callId),
  );
  // InteractionUpdate.tool_call_completed = 3
  const interaction = encodeMessage(3, body);
  return encodeMessage(1, interaction);
}

/** ShellToolCall = field 1 of ToolCall; ShellArgs = field 1 of ShellToolCall */
function encodeShellToolCall(args) {
  const shellArgs = concat(
    encodeString(1, args.command || ""),
    encodeString(2, args.working_directory || ""),
    encodeInt64(3, args.timeout || 30),
    encodeString(4, args.tool_call_id || args.callId || ""),
    encodeString(15, args.description || ""),
  );
  const shellToolCall = encodeMessage(1, shellArgs);
  // ToolCall.shell_tool_call = 1
  return encodeMessage(1, shellToolCall);
}

/** ReadToolCall = field 8; ReadArgs typically path */
function encodeReadToolCall(args) {
  const readArgs = concat(
    encodeString(1, args.path || args.file || ""),
  );
  const readToolCall = encodeMessage(1, readArgs);
  return encodeMessage(8, readToolCall);
}

/** EditToolCall = field 12 */
function encodeEditToolCall(args) {
  const editArgs = concat(
    encodeString(1, args.path || ""),
    encodeString(2, args.old_string || args.oldString || ""),
    encodeString(3, args.new_string || args.newString || ""),
  );
  const editToolCall = encodeMessage(1, editArgs);
  return encodeMessage(12, editToolCall);
}

/** Write via WriteArgs on exec path; for ToolCall use edit or shell */
function encodeWriteToolCallAsEdit(args) {
  return encodeEditToolCall({
    path: args.path,
    old_string: "",
    new_string: args.contents || args.content || "",
  });
}

/** ExecServerMessage for shell: id=1, exec_id=15, shell_args=2 */
function encodeExecServerShell(id, execId, args) {
  const shellArgs = concat(
    encodeString(1, args.command || ""),
    encodeString(2, args.working_directory || ""),
    encodeInt64(3, args.timeout || 30),
    encodeString(4, args.tool_call_id || execId || ""),
    encodeString(15, args.description || "run command"),
  );
  return concat(
    encodeUint32(1, id || 1),
    encodeString(15, execId || ""),
    encodeMessage(2, shellArgs),
  );
}

function encodeAgentServerExec(execMsgBuf) {
  // AgentServerMessage.exec_server_message = 2
  return encodeMessage(2, execMsgBuf);
}

// ── AvailableModels ──────────────────────────────────────────────
// Field numbers from cursor-byok proto/aiserver_v1.proto AvailableModelsResponse:
//   model_names = 1 (repeated string)
//   models = 2 (repeated AvailableModel)
//   composer_model_config = 4 ... quick_agent = 10
//   use_model_parameters = 11
// AvailableModel: name=1, default_on=2, supports_agent=5, supports_thinking=9,
//   supports_images=10, client_display_name=17, server_model_name=18,
//   supports_plan_mode=22, inputbox_short_model_name=24, supports_sandboxing=25,
//   named_model_section_index=38
// FeatureModelConfig: default_model=1, fallback_models=2, best_of_n_default_models=3

function encodeFeatureModelConfig(defaultModel, allIds) {
  const ids = allIds || [];
  const parts = [encodeString(1, defaultModel || "")];
  for (const id of ids) parts.push(encodeString(2, id));
  for (const id of ids) parts.push(encodeString(3, id));
  return concat(...parts);
}

const THINKING_EFFORT_PARAM_ID = "thinking_effort";
const THINKING_EFFORTS = ["disabled", "low", "medium", "high", "xhigh", "max"];

/** ModelParameterDefinition-ish: id=1, name=3, is_cycleable=2, enum values nested */
function encodeThinkingEffortParameterDefinition() {
  // Simplified enum parameter: id, name, tooltip, is_cycleable
  // Full byok nest is deep; emit minimal id+name so use_model_parameters path is non-empty
  const enumValues = THINKING_EFFORTS.map((v) =>
    concat(
      encodeString(1, v), // value
      encodeString(2, v === "disabled" ? "Off" : v.charAt(0).toUpperCase() + v.slice(1)), // displayName best-effort
    ),
  );
  // parameterType.enumParameter.values — best-effort nested messages as field 4/1/1
  const enumParam = concat(
    ...enumValues.map((ev) => encodeMessage(1, ev)),
  );
  const paramType = encodeMessage(1, enumParam); // enumParameter = 1 inside oneof-ish
  return concat(
    encodeString(1, THINKING_EFFORT_PARAM_ID),
    encodeBool(2, true), // is_cycleable_by_hotkey
    encodeString(3, "Thinking intensity"),
    encodeMessage(4, paramType), // parameter_type best-effort field 4
    encodeString(5, "Controls the model thinking intensity for this run."),
  );
}

function encodeThinkingEffortVariants(channelId, displayName, defaultEffort) {
  const def = (defaultEffort || "medium").toLowerCase();
  return THINKING_EFFORTS.map((value) => {
    const label =
      value === "disabled"
        ? displayName
        : `${displayName} (${value})`;
    return concat(
      // ModelVariantConfig: parameter_values=1, display_name=2, is_max_mode=3,
      // is_default_non_max_config=5, tagline=7, variant_string_representation=9
      encodeMessage(
        1,
        concat(
          encodeString(1, THINKING_EFFORT_PARAM_ID),
          encodeString(2, value),
        ),
      ),
      encodeString(2, label),
      encodeBool(3, false),
      encodeBool(5, value === def),
      value !== "disabled" ? encodeString(7, value) : Buffer.alloc(0),
      encodeString(9, `${channelId}:${value}`),
    );
  });
}

function encodeAvailableModelsResponse(models) {
  const list = models || [];
  const ids = list
    .map((m) => String(m.id || m.name || "").trim())
    .filter(Boolean);
  const defaultModel = ids[0] || "";

  // model_names = 1
  const nameParts = ids.map((id) => encodeString(1, id));

  // models = 2
  const modelParts = list.map((m) => {
    const id = String(m.id || m.name || "").trim();
    const display = String(m.displayName || m.clientDisplayName || id).trim();
    if (!id) return Buffer.alloc(0);
    const ctx = Number(m.contextWindowTokens) || 0;
    const defaultEffort = (m.reasoningEffort || "medium").toLowerCase();
    const paramDef = encodeThinkingEffortParameterDefinition();
    const variants = encodeThinkingEffortVariants(id, display, defaultEffort);
    const body = concat(
      encodeString(1, id),
      encodeBool(2, true), // default_on
      encodeBool(5, true), // supports_agent
      encodeBool(9, m.capabilities?.thinking !== false || !!m.reasoningEffort),
      encodeBool(10, m.capabilities?.images !== false),
      ctx > 0 ? encodeInt64(15, ctx) : Buffer.alloc(0),
      ctx > 0 ? encodeInt64(16, ctx) : Buffer.alloc(0),
      encodeString(17, display),
      encodeString(18, id),
      encodeBool(19, true),
      encodeBool(22, true),
      encodeString(24, display),
      encodeBool(25, true),
      // parameter_definitions = 29, variants = 30 (byok parity)
      encodeMessage(29, paramDef),
      ...variants.map((v) => encodeMessage(30, v)),
      encodeInt64(38, 1),
    );
    return encodeMessage(2, body);
  });

  const feature = encodeFeatureModelConfig(defaultModel, ids);
  const configParts = [4, 5, 6, 7, 8, 9, 10].map((fn) =>
    encodeMessage(fn, feature),
  );

  return concat(
    ...nameParts,
    ...modelParts,
    ...configParts,
    encodeBool(11, true), // use_model_parameters
    encodeInt64(12, 720), // disable_unused_models_after_n_hours
    encodeInt64(13, 168), // upgrade_unchanged_models_after_n_hours
  );
}

function encodeServerTimeResponse() {
  // aiserver ServerTimeResponse: double receive_timestamp=1, double transmit_timestamp=2
  const sec = Date.now() / 1000;
  return concat(encodeDouble(1, sec), encodeDouble(2, sec));
}

function encodeGetMeResponse(email) {
  return concat(
    encodeString(1, "local_auth"),
    encodeInt64(2, 1),
    encodeString(3, email || "cursor@local.9router"),
    encodeString(4, "Cursor"),
    encodeString(5, "Local"),
  );
}

/** GetEmailResponse: email=1, sign_up_type=2 (GOOGLE=3) — byok encodeAuthGetEmailResponse */
function encodeGetEmailResponse(email) {
  return concat(
    encodeString(1, email || "cursor@local.9router"),
    encodeInt64Always(2, 3), // SIGN_UP_TYPE_GOOGLE
  );
}

/** Minimal plan/usage/privacy payloads (non-empty so Cursor doesn't treat as free-tier fail) */
function encodeGetPlanInfoResponse() {
  // plan_info nested: plan_name, included_amount_cents, price, billing_cycle_end — best-effort
  const planInfo = concat(
    encodeString(1, "Ultra Plan"),
    encodeInt64(2, 20000),
    encodeString(3, "$200/mo"),
    encodeInt64(4, Date.now() + 10 * 365 * 24 * 3600 * 1000),
  );
  return encodeMessage(1, planInfo);
}

/** Extract ConversationStateStructure bytes from AgentRunRequest (field 1) */
function decodeConversationStateBuf(runRequestBuf) {
  if (!runRequestBuf || !runRequestBuf.length) return null;
  try {
    const fields = decodeFields(runRequestBuf);
    return fieldBytes(fields, 1) || null;
  } catch {
    return null;
  }
}

/**
 * InteractionQuery for AskQuestion — AgentServerMessage.interaction_query = 7.
 * InteractionQuery: id=1, ask_question_interaction_query=3 (AskQuestionInteractionQuery)
 * AskQuestionInteractionQuery: args=1 (AskQuestionArgs)
 * AskQuestionArgs: question=2 (Question { text=1, options=3[] })
 */
function encodeAskQuestionInteractionQuery(id, questionText, options) {
  const id32 = Number(id) || 1;
  const optionMsgs = (options || []).map((o) =>
    concat(encodeString(1, String(o.key || o)), encodeString(2, String(o.label || o))),
  );
  const questionMsg = concat(
    encodeString(1, questionText || ""),
    ...optionMsgs.map((om) => encodeMessage(3, om)),
  );
  const askArgs = encodeMessage(2, questionMsg);
  const askInteraction = encodeMessage(1, askArgs);
  // InteractionQuery: id=1, ask_question=3
  const interactionQuery = concat(
    encodeInt64Always(1, id32),
    encodeMessage(3, askInteraction),
  );
  // AgentServerMessage.interaction_query = 7
  return encodeMessage(7, interactionQuery);
}

function encodeEmpty() {
  return Buffer.alloc(0);
}

module.exports = {
  AGENT_MODE,
  modeFromNumber,
  modeToNumber,
  decodeBidiAppendRequest,
  encodeBidiAppendResponse,
  encodeBidiRequestId,
  decodeBidiRequestId,
  decodeAgentClientMessageFromHex,
  decodeAgentClientMessage,
  decodeAgentRunRequest,
  decodeConversationStateBuf,
  encodeAskQuestionInteractionQuery,
  encodeTextDelta,
  encodeThinkingDelta,
  encodeHeartbeat,
  encodeTurnEnded,
  encodeToolCallStarted,
  encodeToolCallCompleted,
  encodeGetEmailResponse,
  encodeGetPlanInfoResponse,
  encodeShellToolCall,
  encodeReadToolCall,
  encodeEditToolCall,
  encodeWriteToolCallAsEdit,
  encodeExecServerShell,
  encodeAgentServerExec,
  encodeAvailableModelsResponse,
  encodeServerTimeResponse,
  encodeGetMeResponse,
  encodeEmpty,
};
