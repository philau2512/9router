/**
 * Live probe for a Kiro OAuth connection:
 *   1) ListAvailableModels (via resolveKiroModels)
 *   2) Minimal generateAssistantResponse per upstream modelId
 *
 * Usage:
 *   set KIRO_CREDS_JSON=<json connection>   # PowerShell: $env:KIRO_CREDS_JSON = '...'
 *   node scripts/test-kiro-account.mjs
 *
 * Optional:
 *   KIRO_PROBE_MODELS=claude-opus-4.8,auto   # only probe these (default: all raw + failing static ids)
 *   KIRO_SKIP_CHAT=1                         # list only
 */
import { resolveKiroModels } from "../open-sse/services/kiroModels.js";
import { resolveKiroModel } from "../open-sse/config/kiroConstants.js";
import { proxyAwareFetch } from "../open-sse/utils/proxyFetch.js";
import { createHash, randomUUID } from "crypto";

const rawJson = process.env.KIRO_CREDS_JSON;
if (!rawJson) {
  console.error("Missing KIRO_CREDS_JSON env (full connection JSON).");
  process.exit(2);
}

const connection = JSON.parse(rawJson);
const credentials = {
  accessToken: connection.accessToken,
  refreshToken: connection.refreshToken,
  expiresAt: connection.expiresAt,
  providerSpecificData: connection.providerSpecificData || {},
  connectionId: connection.id,
};

const STATIC_SUSPECTS = [
  "claude-opus-4.8",
  "claude-opus-4.7",
  "claude-opus-4.5",
  "claude-sonnet-5",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  "auto",
];

function regionFromProfileArn(profileArn) {
  if (!profileArn || typeof profileArn !== "string") return "us-east-1";
  const parts = profileArn.split(":");
  return parts.length >= 4 && parts[3] ? parts[3] : "us-east-1";
}

function buildHeaders(creds) {
  const seed =
    creds?.providerSpecificData?.clientId ||
    creds?.refreshToken ||
    creds?.providerSpecificData?.profileArn ||
    creds?.accessToken ||
    "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");
  const sdk = "1.0.0";
  const ver = "0.10.32";
  const userAgent =
    `aws-sdk-js/${sdk} ua/2.1 os/windows#10.0.26200 lang/js md/nodejs#22.21.1 ` +
    `api/codewhispererruntime#${sdk} m/N,E KiroIDE-${ver}-${machineId}`;
  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.amazon.eventstream",
    "X-Amz-Target":
      "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
    "User-Agent": userAgent,
    "x-amz-user-agent": `aws-sdk-js/${sdk} KiroIDE-${ver}-${machineId}`,
    "x-amzn-kiro-agent-mode": "vibe",
    "x-amzn-codewhisperer-optout": "true",
    "amz-sdk-request": "attempt=1; max=1",
    "amz-sdk-invocation-id": randomUUID(),
  };
  if (creds?.providerSpecificData?.authMethod === "external_idp") {
    headers.TokenType = "EXTERNAL_IDP";
  }
  const profileArn = creds?.providerSpecificData?.profileArn;
  if (profileArn) {
    headers["x-amzn-codewhisperer-profile-arn"] = profileArn;
  }
  return headers;
}

async function probeChat(creds, modelId) {
  const profileArn = creds.providerSpecificData?.profileArn || "";
  const region = regionFromProfileArn(profileArn);
  // Match executor fallback order: codewhisperer host is what user logs show.
  const urls = [
    `https://codewhisperer.${region}.amazonaws.com/generateAssistantResponse`,
    `https://q.${region}.amazonaws.com/generateAssistantResponse`,
  ];
  const { upstream } = resolveKiroModel(modelId);
  const body = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: "Reply with exactly: pong",
          modelId: upstream,
          origin: "AI_EDITOR",
        },
      },
      history: [],
    },
    ...(profileArn ? { profileArn } : {}),
  };

  for (const url of urls) {
    const started = Date.now();
    try {
      const res = await proxyAwareFetch(url, {
        method: "POST",
        headers: buildHeaders(creds),
        body: JSON.stringify(body),
      });
      const text = await res.text().catch(() => "");
      const ms = Date.now() - started;
      const snippet = text.slice(0, 220).replace(/\s+/g, " ");
      return {
        modelId,
        upstream,
        url,
        status: res.status,
        ms,
        ok: res.ok,
        body: snippet,
      };
    } catch (e) {
      return {
        modelId,
        upstream,
        url,
        status: 0,
        ms: Date.now() - started,
        ok: false,
        body: String(e?.message || e),
      };
    }
  }
}

const log = {
  info: (tag, msg) => console.log(`[${tag}] ${msg}`),
  warn: (tag, msg) => console.warn(`[${tag}] ${msg}`),
  debug: () => {},
};

console.log("=== Kiro account probe ===");
console.log("connectionId:", connection.id);
console.log("email:", connection.email || connection.name);
console.log(
  "profileArn:",
  connection.providerSpecificData?.profileArn || "(none)",
);
console.log("expiresAt:", connection.expiresAt);
console.log(
  "token remaining sec:",
  connection.expiresAt
    ? Math.round((new Date(connection.expiresAt).getTime() - Date.now()) / 1000)
    : "n/a",
);

const listed = await resolveKiroModels(credentials, {
  forceRefresh: true,
  log,
});

if (!listed) {
  console.error("ListAvailableModels failed / returned null");
  process.exit(1);
}

const rawIds = listed.rawModels
  .map((m) => m?.modelId || m?.id)
  .filter(Boolean);
const expandedIds = listed.models.map((m) => m.id);

console.log("\n=== RAW upstream models (ListAvailableModels) ===");
console.log("count:", rawIds.length);
for (const m of listed.rawModels) {
  const id = m?.modelId || m?.id;
  const name = m?.modelName || "";
  const rate = m?.rateMultiplier;
  console.log(`- ${id}${name ? ` | ${name}` : ""}${rate != null ? ` | rate=${rate}` : ""}`);
}

console.log("\n=== Expanded 9router variants (sample) ===");
console.log("count:", expandedIds.length);
console.log(expandedIds.slice(0, 40).join("\n"));
if (expandedIds.length > 40) console.log(`... +${expandedIds.length - 40} more`);

const staticMissing = STATIC_SUSPECTS.filter(
  (id) => !rawIds.includes(id) && !rawIds.includes(resolveKiroModel(id).upstream),
);
console.log("\n=== Static catalog IDs NOT in live raw catalog ===");
console.log(staticMissing.length ? staticMissing.join("\n") : "(none)");

if (process.env.KIRO_SKIP_CHAT === "1") {
  process.exit(0);
}

const envProbe = process.env.KIRO_PROBE_MODELS
  ? process.env.KIRO_PROBE_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

// Probe: every raw id + static suspects (so we see INVALID_MODEL_ID vs success)
const probeSet = [
  ...new Set([...(envProbe || rawIds), ...(envProbe ? [] : STATIC_SUSPECTS)]),
];

console.log("\n=== Chat probe (minimal generateAssistantResponse) ===");
const results = [];
for (const modelId of probeSet) {
  const r = await probeChat(credentials, modelId);
  results.push(r);
  const flag = r.ok ? "OK " : "ERR";
  console.log(
    `${flag} ${r.status} ${r.ms}ms model=${r.modelId} upstream=${r.upstream} | ${r.body}`,
  );
}

const ok = results.filter((r) => r.ok);
const bad = results.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(`ok=${ok.length} bad=${bad.length} total=${results.length}`);
console.log(
  "working upstream ids:",
  ok.map((r) => r.upstream).join(", ") || "(none)",
);
console.log(
  "invalid/failed:",
  bad.map((r) => `${r.upstream}(${r.status})`).join(", ") || "(none)",
);

// Exit non-zero only if list succeeded but ZERO chat models work
if (rawIds.length > 0 && ok.length === 0) process.exit(3);
process.exit(0);