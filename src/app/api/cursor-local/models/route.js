import { NextResponse } from "next/server";
import fs from "fs";
import crypto from "crypto";
import { cursorLocalConfigPath, cursorLocalRoot } from "@/lib/cursor-local/paths";

function channelId(displayName, routerModel) {
  const payload = `${String(displayName || "").trim()}\n${String(routerModel || "").trim()}`;
  return `9r_${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function normalizeEffort(v) {
  // Empty / missing → medium (product default for cursor-local)
  if (v == null || String(v).trim() === "") return "medium";
  const s = String(v).trim().toLowerCase();
  if (["low", "medium", "high", "xhigh", "max"].includes(s)) return s;
  return "medium";
}

function normalizeEndpoint(v) {
  const s = String(v || "").trim();
  if (s === "/v1/responses" || s === "/v1/chat/completions") return s;
  return "/v1/chat/completions";
}

function normalizeModel(m) {
  const displayName = String(m.displayName || m.name || "").trim();
  const routerModel = String(m.routerModel || m.model || "").trim();
  if (!displayName || !routerModel) return null;
  const contextWindowTokens = Math.max(
    0,
    parseInt(m.contextWindowTokens, 10) || 0,
  );
  const maxCompletionTokens = Math.max(
    0,
    parseInt(m.maxCompletionTokens, 10) || 0,
  );
  const reasoningEffort = normalizeEffort(m.reasoningEffort);
  const openAIEndpoint = normalizeEndpoint(m.openAIEndpoint);
  return {
    id: m.id || channelId(displayName, routerModel),
    displayName,
    routerModel,
    contextWindowTokens,
    maxCompletionTokens,
    reasoningEffort,
    openAIEndpoint,
    capabilities: {
      agent: m.capabilities?.agent !== false,
      images: m.capabilities?.images !== false,
      thinking: m.capabilities?.thinking !== false || !!reasoningEffort,
    },
    source: m.source || "manual",
  };
}

function readConfig() {
  try {
    const p = cursorLocalConfigPath();
    if (!fs.existsSync(p)) return { models: [] };
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { models: [] };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(cursorLocalRoot(), { recursive: true });
  fs.writeFileSync(cursorLocalConfigPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

export async function GET() {
  const cfg = readConfig();
  const models = (cfg.models || []).map((m) => normalizeModel(m)).filter(Boolean);
  return NextResponse.json({ models });
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const models = Array.isArray(body.models)
      ? body.models.map(normalizeModel).filter(Boolean)
      : [];
    const cfg = readConfig();
    cfg.models = models;
    writeConfig(cfg);
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
