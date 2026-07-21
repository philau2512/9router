# Design: API Key Access Allowlist (Provider Types + Models)

**Date**: 2026-07-21
**Status**: Implemented (2026-07-21)
**Surface**: `/dashboard/key-budgets` (Edit Access)
**Approach**: A — JSON columns on `apiKeys`

## Problem

Local API keys today only support identity + budget limits (`apiKeyLimits`). Any valid key can call any provider type and any model. Multi-tenant / multi-client setups need per-key access scoping without pinning individual upstream accounts.

## Goals

- Per API key: allowlist **provider types** and/or **model strings**
- Default open: unset/empty lists keep current behavior (all access)
- Enforce on chat paths; filter `/v1/models` when API key auth applies
- Configure via dedicated **Edit Access** UI on Key Budgets (separate from budget)

## Non-goals (this round)

- Pinning provider **accounts/connections**
- Media handlers (image/video/TTS/STT/embeddings) — phase 2
- Deny-by-default for new keys
- Configure access on Endpoint create/edit key flow
- RBAC roles, per-IP rules, per-model rate limits

## Decisions

| Topic | Decision |
|-------|----------|
| Scope unit | Provider **type** (e.g. `claude`, `openai`) + model strings |
| Default | Allow all when both lists empty/null |
| Combine rule | **OR**: pass if `provider ∈ allowedProviders` **or** resolved model ∈ `allowedModels` |
| Alias/combo | Check **after resolve**; combo fails if any member fails |
| Enforce | Chat (+ Claude/Gemini chat equivalents) + filter models list |
| UI | Key Budgets → button **Edit Access** (modal separate from Edit Budget) |
| Storage | Two JSON TEXT columns on `apiKeys` |

## Semantics

```
if allowedProviders empty/null AND allowedModels empty/null:
  → ALLOW

else:
  pass = (provider ∈ allowedProviders) OR (resolvedModelString ∈ allowedModels)
  → 403 if !pass
```

Implications:

- Providers only → all models of those providers
- Models only → those model strings only
- Both set → OR (either match is enough)
- Combo: every resolved member must pass
- Alias: resolve first (cannot bypass via alias name)

**Provider match**: resolved provider id/alias used by routing (`claude`, `openai`, custom node id when that is the resolved provider, etc.).

**Model match**: canonical `provider/model` (or equivalent string after resolve) used by the product.

### Optional API key mode

When `requireApiKey` is false but the client still sends a valid key, apply that key’s access policy (same as budget evaluation when a key is present).

## Data model

```text
apiKeys
  ...existing columns...
  allowedProviders TEXT  -- JSON array of strings; null or [] = unrestricted side
  allowedModels    TEXT  -- JSON array of strings; null or [] = unrestricted side
```

- App-layer validation: arrays of non-empty trimmed strings
- Empty array and null both mean “this side unrestricted”
- Both unrestricted → allow all (migration-safe for existing keys)

Migration: next versioned migration after current latest (e.g. `006-api-key-access-allowlist.js`) + update `schema.js`.

## API

- `GET /api/keys` (and any key detail endpoints): include `allowedProviders`, `allowedModels` as arrays
- Key update path used by Key Budgets (`PUT /api/keys/[id]`): accept optional `allowedProviders` / `allowedModels`
- Create key on Endpoint: no required access fields (default all access)

Suggested error shape on deny:

- HTTP `403`
- `code`: `provider_not_allowed` or `model_not_allowed` (or single `access_not_allowed` with detail)
- Message includes which dimension failed; optional echo of configured lists for admin DX (avoid leaking other keys)

## Enforcement points

1. **Chat** — implemented in `src/sse/handlers/chat.js` after API-key/budget validation and model/combo resolution:
   - `assertApiKeyAccess(keyInfo, { provider, model })` for single models
   - `assertApiKeyAccessBatch(keyInfo, members)` for combos
2. **Models list** — implemented for `src/app/api/v1/models/route.js`, `src/app/api/v1/models/[kind]/route.js`, and `src/app/api/v1beta/models/route.js`:
   - A valid restricted key filters catalog entries through the same OR rule
   - Local unauthenticated / no-key mode returns the full catalog

Still out of scope: embeddings and media handlers.

## UI (Key Budgets)

- Card badge summary:
  - `All access`
  - or `N providers · M models` / single-side counts
- Button **Edit Access** next to **Edit Budget**
- Modal:
  - Multi-select provider types (built-in OAuth / API key / free providers; custom nodes can be included if they appear as provider ids in routing — not required for v1 picker completeness if list is built-in only, but resolved custom node ids must still enforce if present in stored allowlist)
  - Multi-select models (reuse `ModelSelectModal` multi-select patterns where possible)
  - Clear → empty = unrestricted for that side
  - Short copy: “Match if provider **or** model is allowed. Leave both empty for all access.”
- Save → update key → refresh card

## Acceptance tests

1. Key with null/empty lists → chat any model OK
2. `allowedProviders: ["claude"]` only → non-claude 403; claude model OK
3. `allowedModels: ["openai/gpt-4o"]` only → that model OK; others 403
4. Both set, OR → provider-only match OK; model-only match OK
5. Alias resolves to disallowed target → 403
6. Combo with one disallowed member → 403
7. `/v1/models` hides disallowed entries for restricted keys
8. Edit Access UI save round-trips correctly

## Touchpoints (expected files)

- `src/lib/db/schema.js`
- `src/lib/db/migrations/00x-api-key-access-allowlist.js` + `migrations/index.js`
- `src/lib/db/repos/apiKeysRepo.js`
- `src/app/api/keys/**`
- `src/sse/services/api-key-validation.js` (or small sibling helper)
- `src/sse/handlers/chat.js` (+ other chat entrypoints as needed)
- `src/app/api/v1/models/route.js` (+ v1beta if applicable)
- `src/app/(dashboard)/dashboard/key-budgets/**`
- Unit tests for pure OR matcher

## Implementation record

Implemented in schema migration `006-api-key-access-allowlist.js` and schema version 6.

- `apiKeys.allowedProviders` and `apiKeys.allowedModels` are persisted as JSON TEXT arrays.
- Repository reads/writes, `GET /api/keys`, `GET /api/keys/[id]`, and `PUT /api/keys/[id]` round-trip both fields.
- Database export/import snapshots include both columns.
- `src/sse/services/api-key-access.js` centralizes normalization, canonical model IDs, single/combo decisions, and model catalog filtering.
- Optional-key mode evaluates budget and access only when a **valid** supplied key is present. An invalid supplied key remains fail-open in optional local mode, preserving existing local behavior.
- Key Budgets provides the separate **Edit Access** modal with provider and model multi-select controls.

## Risks

| Risk | Mitigation |
|------|------------|
| OR with both lists is loose | UI copy; document; optional future AND mode |
| Media paths still open | Explicit phase 2; document |
| Alias/combo bypass if checked pre-resolve | Always resolve first |
| Cloud sync of keys omits new columns | Verify sync payload maps full key row or extend sync |

## Approved options (session)

- Restrict level: Provider type + Models
- Default: Allow all
- Combine: OR
- UI: Edit Access button on Key Budgets
- Resolve: after alias/combo resolve
- Scope: Chat + models list

**Design A approved as-is** (2026-07-21).
