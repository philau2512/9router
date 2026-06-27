<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **9router** (14273 symbols, 29270 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/9router/context` | Codebase overview, check index freshness |
| `gitnexus://repo/9router/clusters` | All functional areas |
| `gitnexus://repo/9router/processes` | All execution flows |
| `gitnexus://repo/9router/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


## Upstream Sync Guide

### Repository Relationship

Fork: `philau2512/9router` ← upstream: `decolua/9router`

```bash
git remote add upstream https://github.com/decolua/9router.git
git fetch upstream
```

### Sync Process

1. `git log --oneline upstream/master` — identify target commit range
2. `git diff --stat <base>..<head>` — understand scope before committing to anything
3. Work on `test-upstream` branch; apply commits **manually** (not cherry-pick) because fork paths differ
4. Apply per-phase: Security → Stream/Transport → Translator → Providers → Kiro/Auth → TTS/UI/i18n
5. Run `npx vitest run tests/unit/security-audit.test.js tests/unit/openai-responses-terminal-event.test.js tests/unit/codebuddy-reasoning-optin.test.js tests/unit/param-support.test.js tests/unit/stream-stability-improvements.test.js` after each phase

### Architecture Differences (fork ≠ upstream)

| Area | Upstream Path | Fork Equivalent | Status |
|------|---------------|-----------------|--------|
| Provider registry | `open-sse/providers/registry/*.js` (per-file) | `open-sse/config/providers.js` (flat) + `open-sse/providers/registry/` compat layer | Partially aligned (v0.5.12) |
| Model capabilities | `open-sse/providers/capabilities.js` | `open-sse/providers/capabilities.js` | ✅ Aligned (v0.5.12) |
| Provider models | Distributed in registry files | `open-sse/config/providerModels.js` (flat, keyed by alias) | Flat stays |
| Usage tracking | `src/lib/db/repos/usageRepo.js` (monolithic) | `src/lib/db/repos/usage/*.js` (sub-modules) | Sub-modules stay |
| Providers page | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | `components/` + `hooks/` | Modular stays |
| chatCore | `open-sse/handlers/chatCore.js` | Same + `chatCore/streamingHandler.js` + `chatCore/nonStreamingHandler.js` | Split stays |
| tokenRefresh | `open-sse/services/tokenRefresh/providers.js` | No equivalent in fork | **Skip** |
| thinkingUnified | Full `applyFormat` + `toGeminiThinkingLevel` | Simplified — `extractThinking` only | Fork subset |

### Auto-Skip (never applicable to fork)

- `# v0.x.y` version bump commits
- `docker-compose.yml` chores (fork has own)
- `open-sse/providers/registry/*.js` bulk changes — requires mapping to individual registry files OR `open-sse/config/providers.js`
- `open-sse/services/tokenRefresh/providers.js` — not in fork

### Mapping Upstream Diffs to Modularized Files

When upstream changes a file the fork has split:

```bash
# Get the upstream diff
git show <hash> -- path/to/upstream/file.js

# Find fork equivalent
grep -rn "relevant_function_name" open-sse/ src/

# Apply to correct fork sub-module
```

**Patterns:**
- `handlers/chatCore.js` → map hunks to `chatCore/streamingHandler.js` or `chatCore/nonStreamingHandler.js`
- `src/lib/db/repos/usageRepo.js` → map to `usage/usage-writer.js`, `usage/usage-query.js`, etc.
- `src/app/(dashboard)/dashboard/providers/[id]/page.js` → map to `components/` or `hooks/`

### Last Sync

- **Date**: 2026-06-26
- **Range**: `cb65a45e` → `cce47dd` (v0.5.12), 31 commits
- **Applied**: 29/31 (skipped: docker-compose chore, version bump)
- **Commits**: `aad50a7` (main sync, 44 files) + `6983d39` (100% completion, 5 files)
- **Deferred**: thinkingUnified full impl, tokenRefresh/providers.js, computeRetryDelay refactor