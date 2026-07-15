# cursor-local

Separate subsystem that reimplements cursor-byok “local Cursor backend” in JS:

1. Fake Ultra inject into Cursor `state.vscdb` (restored on stop)
2. MITM HTTP proxy (`:18080`) for `*.cursor.sh`
3. Local backend (`:18090`) — Phase A stub; Phase B+ mocks + agent host
4. All LLM inference via 9router `/v1` (not direct providers)

## Lifecycle

```text
start → backend → inject auth → MITM → install CA → write Cursor settings.json proxy
stop  → clear settings → restore auth → stop MITM → stop backend
```

## Spawn

Managed by `src/lib/cursor-local/manager.js` and dashboard APIs under `/api/cursor-local/*`.

```bash
# manual debug
node src/cursor-local/index.js
```

## Data

`DATA_DIR/cursor-local/` (default `~/.9router/cursor-local` or `%APPDATA%/9router/cursor-local`)

## Phases

| Phase | Status |
|-------|--------|
| A Activation | implemented |
| B Mocks + BidiAppend/RunSSE chat via /v1 | implemented |
| C Agent tools + modes (agent/ask/plan/debug) | byok prompts + tools + compaction |
| C+ Dashboard/analytics mocks, telemetry ack, tab stub | implemented |
| D Golden fixtures (AvailableModels fields) | unit fixture tests |
| Tab full proxy to tab.leokun.cn | stub (set CURSOR_LOCAL_TAB_BASE) |

## Warnings

- **Experimental / wire-unverified:** protobuf field layouts are hand-rolled from byok study + smoke tests, not golden fixtures from live Cursor. Expect breakage across Cursor versions until Phase D fixture harness lands.
- Unofficial local Cursor backend; may violate Cursor ToS.
- Mutex with shared MITM Cursor DNS and OAuth auto-import.
- Restart Cursor after start so settings/`state.vscdb` are picked up.
- Always **Stop** from dashboard (graceful) so settings + auth restore; hard kill may leave proxy/auth residual.

