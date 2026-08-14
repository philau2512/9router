# Fork changelog

## Sau sync upstream — Hoàn thiện regression và dashboard hydration

### Regression theo contract của fork

- **Antigravity:** test metadata, discovery và executor xác nhận thứ tự failover chat `daily-cloudcode-pa.googleapis.com` → `cloudcode-pa.googleapis.com`. Discovery/onboarding vẫn dùng PROD; chat bắt đầu ở daily để giảm 429 và chỉ chuyển PROD khi cần.
- **Codex remote image:** fixture regression dùng JPEG magic bytes hợp lệ. Điều này khớp cơ chế hardening của fork: chỉ inline base64 khi remote payload qua SSRF guard, giới hạn kích thước và xác thực image signature; payload không hợp lệ tiếp tục giữ URL gốc.
- **SAML:** chuyển test helper từ `node:test` sang Vitest để full suite nhận diện đúng test file.
- **CLI package:** `cli/scripts/build-cli.js` chỉ thực thi build khi được gọi trực tiếp; export helper copy/merge/validate artifacts để test được mà không vô tình chạy `next build` hay tranh chấp build lock.

### Dashboard console log

- **File:** `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js`
  - Render đầu tiên luôn dùng view `feed` trên cả SSR và client.
  - Chỉ khôi phục view đã lưu trong `localStorage` sau hydration, tránh server render feed nhưng client render terminal/table ngay từ lượt đầu.

### Verification

- Full Vitest suite: **207 files passed**, **2079 tests passed**.
- `git diff --check` passed.

---

## 2026-08-06 — Fix Kiro `REQUEST_BODY_INVALID` với Claude CLI → Kiro/auto

### Vấn đề

User gặp lỗi `REQUEST_BODY_INVALID` khi chat từ Claude CLI với model `kiro/auto`. Error xảy ra tương tự bug đã fix ngày 2026-08-05 nhưng ở translator route khác.

### Root cause

Translator `claude-to-kiro.js` (direct route, không pivot qua OpenAI) vẫn serialize `systemPrompt` vào top-level payload. Kiro server từ chối schema này với `REQUEST_BODY_INVALID`.

### Fix

- **File:** `open-sse/translator/request/claude-to-kiro.js`
  - Không serialize `systemPrompt` vào outgoing payload (dùng `Object.defineProperty` với `enumerable: false`).
  - Giữ `systemPrompt` dưới dạng metadata cho session replay compatibility.
  - System prompt đã được prepend vào replayed conversation content.

### Verification

- Node test: `systemPrompt` không xuất hiện trong `Object.keys()` và `JSON.stringify()` nhưng vẫn accessible qua property access.
- Regression: 43/43 OpenAI-to-Kiro tests passed (pattern tương tự).

---

## 2026-08-05 — Fix Kiro `REQUEST_BODY_INVALID` với thinking/agentic models

### Vấn đề

User `elza36890922` gặp lỗi `REQUEST_BODY_INVALID` khi dùng `kiro-combo → kiro/claude-sonnet-4.5-thinking` qua OpenAI Responses format với 10 messages, 22 tools và `max_output_tokens: 65536`.

### Root cause

Translator `openai-to-kiro.js` tự động thêm top-level field `systemPrompt` vào payload Kiro cho thinking/agentic variants. Kiro server từ chối schema này và trả về `REQUEST_BODY_INVALID`.

### Fix

- **File:** `open-sse/translator/request/openai-to-kiro.js`
  - Không serialize `systemPrompt` vào outgoing payload (dùng `Object.defineProperty` với `enumerable: false`).
  - Giữ `systemPrompt` dưới dạng metadata cho session replay compatibility.
  - System prompt đã được prepend vào replayed conversation content, không cần gửi riêng field này lên provider wire.

- **File:** `tests/unit/openai-to-kiro.test.js`
  - Thêm assertion xác nhận `systemPrompt` không xuất hiện trong `Object.keys()` và `JSON.stringify()`.
  - Verify thinking mode tags vẫn xuất hiện trong conversation content.

### Verification

- Local dev `localhost:20127`: cả `kr/claude-sonnet-4.5-agentic` và `kr/claude-sonnet-4.5-thinking` đều trả `200 OK`.
- Regression tests: 79/79 Kiro canonical translator tests passed.
- Production server `localhost:20128` với real API key cũng hoạt động bình thường.

---

## 2026-08-04 — Merge upstream into `sync-upstream`

### Upstream integration

- Đồng bộ registry, model catalog, executor và OAuth provider modules; bổ sung các provider/flow mới gồm CodeBuddy Intl, Devin CLI, Trae, Windsurf và Zed.
- Tách OAuth provider implementations theo module, cập nhật callback/proxy UI và server routing; giữ tương thích các refresh export cũ.
- Cập nhật provider usage, fetch, embeddings, search, tunnel PID ownership, dashboard quota rendering và provider assets/i18n.
- Cập nhật Antigravity daily chat transport, model metadata và signed tool continuation; discovery/onboarding vẫn dùng PROD endpoint.
- Cập nhật Kiro model/routing/session architecture, canonical conversation replay, endpoint-aware headers/profile ARN và bounded retry behavior.

### Fork behavior preserved and repaired

- **Grok CLI quota:** giữ đủ ba request `billing?format=credits`, `billing` và `user?include=subscription`; merge quota giữ free-tier unknown bars, monthly currency format và pay-as-you-go. Khi credits billing fail-open, `onDemandCap` từ plain billing vẫn quyết định đúng trạng thái pay-as-you-go.
- **SQLite backup:** giữ backup analytics dưới dạng SQLite snapshot và các route/service compatibility liên quan.
- **Antigravity thinking:** giữ cap 16,384 cho request thường, tối đa 65,535 cho thinking phù hợp; giữ buffering `part.thought` và signed tool continuation.
- **Kiro thinking stream:** giữ xử lý tag `<thinking>` bị chia frame, phát `reasoning_content`, không phát content rỗng và flush phần tag còn lại khi EOF.
- **Kiro contracts:** giữ agentic prompt, fingerprint/detection, endpoint/API-key routing, profile ARN, suffix/override model và canonical history/session replay.
- **Codex:** giữ proactive token auto-refresh trước hạn 2 ngày.
- **Dashboard:** Round Robin hiển thị số account đang enabled theo `isActive !== false`; quota UI giữ unknown/currency rows ở trạng thái trung tính.
- **Token refresh:** khôi phục public re-export `refreshKimiToken` từ module đang sở hữu implementation.

### Validation

- Alias contract: 164 aliases unchanged.
- Provider contract: 96 providers unchanged.
- OAuth URL contract: 14 providers unchanged.
- Aggregate regression baseline: 0 unapproved failures.
- Focused fork contract, SQLite snapshot, Responses output index và Kiro stream suites đều pass.

> `CHANGELOG_FORK.md` là ghi chú local/untracked của fork và không thuộc merge commit.