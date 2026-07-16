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
