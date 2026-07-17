/**
 * Topology active-edge matching (generic).
 *
 * Pending/SSE may report a short alias (`kr`, `cc`, `gcli`) or a credential
 * sibling id (`xai`) while the graph node uses the stored connection id
 * (`kiro`, `claude`, `grok-cli`). Exact-id match then leaves the edge dark.
 *
 * Groups are derived from:
 *  1. AI_PROVIDERS id + alias
 *  2. Extra short aliases used at runtime (PROVIDER_ALIASES extras)
 *  3. Explicit credential-sibling sets (distinct provider ids that share auth)
 */

import { AI_PROVIDERS } from "@/shared/constants/providers";

/**
 * Distinct provider ids that share credentials / runtime identity.
 * These are NOT alias↔id pairs — they are two real AI_PROVIDERS entries.
 */
const CREDENTIAL_SIBLING_GROUPS = Object.freeze([
  // xai (API key / page) ↔ grok-cli (Grok Build OAuth) — see provider-credentials.js
  Object.freeze(["xai", "grok-cli"]),
]);

/**
 * Runtime aliases that resolve to a connection id but may not appear as
 * AI_PROVIDERS[id].alias (open-sse PROVIDER_ALIASES extras).
 */
const EXTRA_ALIAS_TO_ID = Object.freeze({
  gcli: "grok-cli",
  gb: "grok-cli",
  "grok-build": "grok-cli",
});

/** Union-find parent map (lowercase). */
function buildParentMap() {
  const parent = new Map();

  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    // path compress
    let c = x;
    while (c !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  };

  const union = (a, b) => {
    if (a == null || b == null || a === "" || b === "") return;
    const aa = String(a).toLowerCase();
    const bb = String(b).toLowerCase();
    const ra = find(aa);
    const rb = find(bb);
    if (ra !== rb) parent.set(ra, rb);
  };

  // 1) id ↔ alias from dashboard registry
  for (const p of Object.values(AI_PROVIDERS)) {
    if (!p?.id) continue;
    union(p.id, p.id);
    if (p.alias) union(p.id, p.alias);
  }

  // 2) runtime short aliases
  for (const [alias, id] of Object.entries(EXTRA_ALIAS_TO_ID)) {
    union(alias, id);
  }

  // 3) credential siblings (multi-id identity)
  for (const group of CREDENTIAL_SIBLING_GROUPS) {
    for (let i = 1; i < group.length; i++) {
      union(group[0], group[i]);
    }
  }

  return { parent, find };
}

const { find } = buildParentMap();

/** root → frozen sorted member list */
const GROUPS_BY_ROOT = (() => {
  const buckets = new Map();
  // Re-walk all known keys from AI_PROVIDERS + extras + siblings
  const keys = new Set();
  for (const p of Object.values(AI_PROVIDERS)) {
    if (p?.id) keys.add(String(p.id).toLowerCase());
    if (p?.alias) keys.add(String(p.alias).toLowerCase());
  }
  for (const [alias, id] of Object.entries(EXTRA_ALIAS_TO_ID)) {
    keys.add(alias.toLowerCase());
    keys.add(String(id).toLowerCase());
  }
  for (const group of CREDENTIAL_SIBLING_GROUPS) {
    for (const id of group) keys.add(String(id).toLowerCase());
  }

  for (const k of keys) {
    const root = find(k);
    if (!buckets.has(root)) buckets.set(root, new Set());
    buckets.get(root).add(k);
  }

  return Object.freeze(
    Object.fromEntries(
      [...buckets.entries()].map(([root, set]) => [
        root,
        Object.freeze([...set].sort()),
      ]),
    ),
  );
})();

/**
 * Lookup: any member → full sibling/alias group (lowercase ids).
 * Kept for tests / debugging; prefer expandTopologyProviderIds.
 */
export const TOPOLOGY_PROVIDER_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.values(GROUPS_BY_ROOT).flatMap((group) =>
      group.map((id) => [id, group]),
    ),
  ),
);

/**
 * @param {string|null|undefined} providerId
 * @returns {string[]} lowercase ids that should light the same topology node
 */
export function expandTopologyProviderIds(providerId) {
  if (providerId == null || providerId === "") return [];
  const id = String(providerId).toLowerCase();
  const group = TOPOLOGY_PROVIDER_ALIASES[id];
  if (group) return [...group];
  // Unknown provider: still match exact id
  return [id];
}

/**
 * Expand every active request provider into a match set for graph nodes/edges.
 * @param {Array<{ provider?: string }>} activeRequests
 * @returns {Set<string>}
 */
export function buildActiveProviderSet(activeRequests = []) {
  const set = new Set();
  for (const r of activeRequests) {
    for (const id of expandTopologyProviderIds(r?.provider)) {
      set.add(id);
    }
  }
  return set;
}

/**
 * Expand a single last/error provider id the same way as active streams.
 * @param {string} providerId
 * @returns {Set<string>}
 */
export function buildProviderMatchSet(providerId) {
  return new Set(expandTopologyProviderIds(providerId));
}

/**
 * Distinct logical providers in a (possibly expanded) active set.
 * One stream that expands to several sibling/alias ids still counts as 1.
 * @param {Set<string>|Iterable<string>} activeSet
 * @returns {number}
 */
export function countActiveProviderGroups(activeSet) {
  const seen = new Set();
  let n = 0;
  for (const id of activeSet) {
    const key = expandTopologyProviderIds(id).slice().sort().join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    n += 1;
  }
  return n;
}

/**
 * Whether a topology node provider should glow for the given match set.
 * Expands both sides so alias/sibling mismatches still match.
 */
export function isTopologyProviderActive(providerId, activeSet) {
  if (!activeSet || activeSet.size === 0) return false;
  return expandTopologyProviderIds(providerId).some((id) => activeSet.has(id));
}