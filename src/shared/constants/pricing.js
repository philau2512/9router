/**
 * Pricing constants — thin re-export barrel.
 *
 * Actual data and logic live in ./pricing/ sub-modules.
 * This file preserves backward compatibility for existing import paths
 * (e.g. `import { ... } from "@/shared/constants/pricing.js"`).
 */

export {
  MODEL_PRICING,
  PROVIDER_PRICING,
  PATTERN_PRICING,
  getPricingForModel,
  getDefaultPricing,
  formatCost,
  calculateCostFromTokens,
} from "./pricing/index.js";
