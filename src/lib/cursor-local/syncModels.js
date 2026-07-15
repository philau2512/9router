/**
 * Build cursor-local model map from 9Router's live LLM catalog (/v1 models list).
 */
import crypto from "crypto";
import fs from "fs";
import { buildModelsList } from "@/app/api/v1/models/route";
import { getCombos, getModelAliases } from "@/lib/localDb";
import { cursorLocalConfigPath, cursorLocalRoot } from "@/lib/cursor-local/paths";

const LLM_KIND = "llm";

function channelId(displayName, routerModel) {
  const payload = `${String(displayName || "").trim()}\n${String(routerModel || "").trim()}`;
  return `9r_${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function readConfig() {
  try {
    const p = cursorLocalConfigPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(cursorLocalRoot(), { recursive: true });
  fs.writeFileSync(cursorLocalConfigPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

/**
 * Collect router model ids: aliases, combos, then full LLM catalog.
 * @param {{ max?: number, includeCatalog?: boolean }} opts
 */
export async function collectRouterModelIds(opts = {}) {
  const max = Math.min(500, Math.max(1, opts.max || 200));
  const includeCatalog = opts.includeCatalog !== false;
  const seen = new Set();
  const ordered = [];

  const push = (id, displayName) => {
    const routerModel = String(id || "").trim();
    if (!routerModel || seen.has(routerModel)) return;
    seen.add(routerModel);
    ordered.push({
      displayName: String(displayName || routerModel).trim() || routerModel,
      routerModel,
    });
  };

  // 1) User aliases (short names first — best for Cursor picker)
  try {
    const aliases = await getModelAliases();
    for (const [alias, full] of Object.entries(aliases || {})) {
      if (!alias || !full) continue;
      // Prefer alias as both display and router id (9router accepts alias in /v1)
      push(alias, alias);
      // Also expose full provider/model if different
      if (String(full) !== alias) push(full, full);
    }
  } catch {
    /* ignore */
  }

  // 2) Combos
  try {
    const combos = await getCombos();
    for (const c of combos || []) {
      const name = c?.name || c?.id;
      if (name) push(name, name);
    }
  } catch {
    /* ignore */
  }

  // 3) Full LLM catalog from buildModelsList
  if (includeCatalog) {
    try {
      const list = await buildModelsList([LLM_KIND]);
      const items = list?.data || list?.models || list || [];
      for (const m of items) {
        const id = m?.id || m?.name;
        if (id) push(id, id);
        if (ordered.length >= max) break;
      }
    } catch (e) {
      console.log("[cursor-local] catalog sync failed:", e?.message || e);
    }
  }

  return ordered.slice(0, max).map((m) => ({
    id: channelId(m.displayName, m.routerModel),
    displayName: m.displayName,
    routerModel: m.routerModel,
    capabilities: { agent: true, images: true, thinking: true },
    source: "9router-sync",
  }));
}

/**
 * Sync into cursor-local config.json models array.
 * @param {{ replace?: boolean, max?: number }} opts
 *   replace=true (default): overwrite map with catalog
 *   replace=false: merge, keep existing displayName overrides
 */
export async function syncCursorLocalModels(opts = {}) {
  const replace = opts.replace !== false;
  const catalog = await collectRouterModelIds({
    max: opts.max,
    includeCatalog: opts.includeCatalog,
  });

  const cfg = readConfig();
  let models;
  if (replace || !Array.isArray(cfg.models) || cfg.models.length === 0) {
    models = catalog;
  } else {
    const byRouter = new Map(
      cfg.models.map((m) => [String(m.routerModel || "").trim(), m]),
    );
    models = catalog.map((c) => {
      const prev = byRouter.get(c.routerModel);
      if (prev?.displayName) {
        return {
          ...c,
          displayName: prev.displayName,
          id: channelId(prev.displayName, c.routerModel),
        };
      }
      return c;
    });
    // keep manual entries not in catalog
    for (const prev of cfg.models) {
      const rm = String(prev.routerModel || "").trim();
      if (rm && !models.some((m) => m.routerModel === rm)) {
        models.push({
          id: prev.id || channelId(prev.displayName, prev.routerModel),
          displayName: prev.displayName || rm,
          routerModel: rm,
          capabilities: prev.capabilities || {
            agent: true,
            images: true,
            thinking: true,
          },
          source: prev.source || "manual",
        });
      }
    }
  }

  cfg.models = models;
  writeConfig(cfg);
  return {
    models,
    count: models.length,
    replaced: replace,
  };
}
