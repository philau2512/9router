# Merge Invariants

## Grok CLI quota tracking

`open-sse/services/usage/grok-cli.js` intentionally uses the fork's verified three-request quota flow:

1. `GET /v1/billing?format=credits` for weekly/API usage and pay-as-you-go data.
2. `GET /v1/billing` for monthly credits.
3. `GET /v1/user?include=subscription` for plan identity.

Merge all three responses with `buildMergedGrokQuotas`. Do **not** replace this with upstream single-shape/single-billing parsing, conditional endpoint fetching, or a provider-specific quota format unless a captured Grok CLI payload and regression tests prove compatibility.

Before accepting upstream changes to this flow, run:

```bash
cd tests
npx vitest run unit/grokBilling.test.js unit/grok-cli-executor.test.js unit/grok-cli-models.test.js unit/provider-quota-visibility.test.js unit/quota-auto-ping.test.js
```

`tests/unit/grokBilling.test.js` protects the captured two-billing-shape merge and its fail-open behavior.

## SQLite backup export

The local backup flow exports analytics as SQLite snapshots rather than the older
JSON/download-only shape. Preserve the database route, backup service, dashboard
profile flow, and compatibility exports together; do not restore the removed
`profileDownloadUtils.js` path or reduce a snapshot to a partial JSON export.

Before accepting upstream changes to backup/export behavior, run:

```bash
cd tests
npx vitest run unit/database-backup-route.test.js unit/db-sqlite-vs-lowdb.test.js
```

## Antigravity thinking and tool continuations

Antigravity has two local protocol safeguards that must be kept as one behavior:

1. Keep ordinary `generationConfig.maxOutputTokens` capped at `16384`, but permit
   active medium/high or extended thinking to use up to `65535`. A universal
   `16384` final cap can exhaust provider thought output and expose incomplete
   self-talk at `max_tokens`.
2. Treat `part.thought === true` as reasoning. For Antigravity only, buffer
   otherwise-unmarked text until a signed tool-call boundary or terminal result
   establishes whether it is visible text; drop that pending text before a signed
   tool continuation, but preserve signed visible text and genuine final answers.

Do not replace this with signature-only filtering: a `thoughtSignature` without
`thought: true` can accompany visible text and is required for tool continuity.
Keep the non-streaming, resumed-stream, and Gemini-to-OpenAI paths aligned.

Before accepting upstream changes to this flow, run:

```bash
cd tests
npx vitest run unit/antigravity-executor.test.js unit/antigravity-stream-resume.test.js translator/bugs-antigravity.test.js
```

## OpenAI Responses output indexes

Both Responses conversion paths must allocate one stable, unique `output_index`
per output item across a response: reasoning, every assistant message, and every
function call. Do not derive indexes independently from the upstream choice index
or tool index; that creates duplicate indexes when a response contains reasoning,
text, and tools.

Keep `open-sse/transformer/responsesTransformer.js` and
`open-sse/translator/response/openai-responses.js` behaviorally synchronized.

Before accepting upstream changes to this flow, run:

```bash
cd tests
npx vitest run unit/responses-output-indexes.test.js translator/bugs-antigravity.test.js
```

## Dashboard provider round-robin label

The provider connections toolbar displays the configured round-robin count as the
actual number of enabled accounts. Preserve the local count rendering when syncing
upstream dashboard changes; do not replace it with an unrelated aggregate or omit
it from the provider toolbar.

## Kiro thinking stream (split tags → reasoning_content)

Live Kiro EventStream often emits thinking as text tags inside
`assistantResponseEvent`, with the open tag **split across frames**
(`"<thinking"` then `">…"`). A whole-token strip of `"<thinking>"` only will
leak tags into `delta.content` and never produce client-visible reasoning.

`open-sse/executors/kiro.js` must keep this fork behavior as one unit:

1. Carry partial open/close tag prefixes across frames (`splitKiroThinkingText` +
   `thinkingTagPending`).
2. Surface the thinking body as OpenAI `delta.reasoning_content` (also keep
   native `reasoningContentEvent` → `reasoning_content`).
3. Emit visible `content` only when non-empty after strip (no empty-content flood
   while thinking).
4. Flush any leftover tag carry on clean stream EOF.

Do **not** restore “strip tags and discard body” or match only the full
`"<thinking>"` token without a partial-tag buffer. Downstream Responses /
Claude paths already map `reasoning_content` → reasoning summary / thinking
blocks; losing the intermediate field breaks all client formats.

Before accepting upstream changes to this flow, run:

```bash
cd tests
npx vitest run unit/kiro-thinking-strip.test.js unit/kiro-buffer-boundary.test.js unit/kiro-fused-objecthandoff.test.js
```

`tests/unit/kiro-thinking-strip.test.js` protects the live split-tag shape and
re-emit as `reasoning_content`. Optional live check (needs local server + API
key):

```bash
RUN_REAL=1 REAL_BASE_URL=http://localhost:20127/v1 REAL_API_KEY=sk-... \
  npx vitest run --config tests/vitest.config.js tests/translator/real/kiro-thinking-stream.live.test.js
```
