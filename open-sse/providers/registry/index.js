// Registry index — generates a minimal registry array from the fork's flat config.
// Individual provider files override generated entries for key providers.
//
// This is a compatibility layer. The upstream uses per-file registry entries in
// open-sse/providers/registry/{id}.js; the fork stores equivalent data in
// open-sse/config/providers.js (transport) and open-sse/config/providerModels.js (models).

import { PROVIDERS } from "../../config/providers.js";
import {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
} from "../../config/providerModels.js";

// Individual registry files take precedence over auto-generated entries.
// Multi-endpoint providers MUST be listed so `transports[]` is available to resolveTransport.
import veniceRegistry from "./venice.js";
import blackboxRegistry from "./blackbox.js";
import perplexityAgentRegistry from "./perplexity-agent.js";
import grokCLIRegistry from "./grok-cli.js";
import deepseekRegistry from "./deepseek.js";
import glmRegistry from "./glm.js";
import kimiRegistry from "./kimi.js";
import kimiCodingRegistry from "./kimi-coding.js";
import minimaxRegistry from "./minimax.js";
import minimaxCnRegistry from "./minimax-cn.js";
import xiaomiMimoRegistry from "./xiaomi-mimo.js";
import xiaomiTokenplanRegistry from "./xiaomi-tokenplan.js";

const REGISTRY_OVERRIDES = new Map([
  ["venice", veniceRegistry],
  ["blackbox", blackboxRegistry],
  ["perplexity-agent", perplexityAgentRegistry],
  ["grok-cli", grokCLIRegistry],
  ["deepseek", deepseekRegistry],
  ["glm", glmRegistry],
  ["kimi", kimiRegistry],
  ["kimi-coding", kimiCodingRegistry],
  ["minimax", minimaxRegistry],
  ["minimax-cn", minimaxCnRegistry],
  ["xiaomi-mimo", xiaomiMimoRegistry],
  ["xiaomi-tokenplan", xiaomiTokenplanRegistry],
]);

// Generate minimal registry entries from fork's flat provider config.
// Upstream registry entries have many more display/serviceKinds/embeddingConfig fields;
// those are in individual registry files when present.
const registry = Object.entries(PROVIDERS).map(([id, config]) => {
  const override = REGISTRY_OVERRIDES.get(id);
  if (override) return override;
  return {
    id,
    alias: PROVIDER_ID_TO_ALIAS[id] || id,
    aliases: [],
    category: config.category || "apikey",
    transport: config,
    models: PROVIDER_MODELS[id] || [],
  };
});

export default registry;