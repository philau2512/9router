# API Key Access Control

Control which provider types and models a local API key may use. This is useful when one 9Router instance is shared by multiple clients or environments.

Access control is independent from key budgets: a request must satisfy both the key's budget and its access policy.

---

## Configure a key

1. Open **Dashboard → Key Budgets**.
2. Find the API key and select **Edit Access**.
3. Select allowed provider types and/or models.
4. Select **Save Access**.

The card shows either **All access** or the number of configured providers and models.

> Clear both lists to restore unrestricted access.

## Matching rules

9Router evaluates access using the resolved provider and model, not the model alias originally sent by the client.

| Configuration | Result |
| --- | --- |
| No providers and no models | The key can use every available model. |
| Providers only | The key can use every model routed through one of those providers. |
| Models only | The key can use only the listed canonical model strings. |
| Both lists | A request is permitted when **either** its provider **or** its model matches. |

A model entry uses the canonical `provider/model` value, for example `openai/gpt-4o`.

### Examples

| Allowed providers | Allowed models | Request | Result |
| --- | --- | --- | --- |
| `claude` | — | `claude/claude-sonnet-4-5` | Allowed |
| `claude` | — | `openai/gpt-4o` | Denied |
| — | `openai/gpt-4o` | `openai/gpt-4o` | Allowed |
| `claude` | `openai/gpt-4o` | any Claude model | Allowed |
| `claude` | `openai/gpt-4o` | `openai/gpt-4o` | Allowed |

## Aliases and combos

- **Aliases** are resolved before access is checked. An alias cannot grant access to a target that the key does not allow.
- **Combos** are checked member by member. Every resolved combo member must be allowed; one denied member rejects the request.

A rejected request returns HTTP `403` with one of these machine-readable codes:

- `provider_not_allowed`
- `model_not_allowed`
- `access_not_allowed`

## Model catalogs

When a valid restricted API key is included in a request, 9Router filters these model catalogs to show only accessible models:

- `GET /v1/models`
- `GET /v1/models/{kind}`
- `GET /v1beta/models`

Without an API key, or with a key whose two allowlists are empty, the full catalog remains visible in local optional-key mode.

## API management

Use the existing key management endpoints to read or update access settings.

```http
GET /api/keys
GET /api/keys/{id}
PUT /api/keys/{id}
Content-Type: application/json

{
  "allowedProviders": ["claude"],
  "allowedModels": ["openai/gpt-4o"]
}
```

Both fields are optional arrays of non-empty strings. `null` or `[]` clears that side of the allowlist.

## Scope

The access policy currently protects chat-compatible request paths and the model catalog endpoints above. It does not yet apply to image, video, TTS, STT, embedding, or search handlers.