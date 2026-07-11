# Plan triển khai: Sync fork `9router` với `upstream/decolua` (gộp cả hai bên)

> Mục tiêu: Merge `upstream/master` (decolua/9router) vào code của bạn với chính sách **gộp cả hai bên, không bỏ một phía**, để fork sync full và về sau `git pull upstream` dễ dàng. Giữ nguyên toàn bộ tính năng của bạn.
>
> Repo: `C:\9router` · Branch nguồn: `new-feature` (đã backup) · Branch tích hợp: `merge/upstream-sync`

---

## 0. Bối cảnh & số liệu (từ dry-run đã chạy)

| Chỉ số | Giá trị |
|---|---|
| Merge-base | `ac2fee7` |
| Bạn đi trước base | **244 commits** (1047 file thay đổi) |
| Upstream đi trước base | **285 commits** (678 file thay đổi) |
| Upstream HEAD | `9845a1702` — v0.5.30 (2026-07-10) |
| **Tổng file conflict** | **339** |
| ├ content conflict | 213 |
| ├ add/add conflict | 119 (0 file trùng nội dung → đều là code độc lập) |
| ├ modify/delete | 7 |
| └ rename collision | 1 |

Phân bố conflict theo thư mục: `src/` 148 · `open-sse/` 129 · `tests/` 46 · `cli/` 7 · còn lại 9 (root config).

**Môi trường build/test:**
- Node `v24.15.0`, npm `11.15.0`
- `npm run build` = `next build --webpack`
- `npm run test` = `vitest run`
- `npm run format` = `prettier . --write`
- Lockfile: `package-lock.json` (root) + `cli/package-lock.json`. **Không** nằm trong conflict list nhưng **phải regen** sau khi gộp `package.json`.

---

## 1. Nguyên tắc xuyên suốt

1. **Không bao giờ dùng `-X ours` / `-X theirs` cho toàn merge.** Đó là bỏ một phía. Ta resolve từng nhóm có chủ đích.
2. **Không đụng branch `new-feature`.** Mọi thao tác trên `merge/upstream-sync`.
3. **Commit theo từng nhóm** (không commit 1 phát 339 file). Mỗi nhóm resolve xong → commit riêng để dễ review/rollback.
4. **Verify tính năng của bạn còn sống** ở cuối bằng build + test, và đối chiếu danh sách tính năng ở mục 8.
5. Bật `rerere` để nếu phải abort và làm lại, git nhớ cách resolve đã làm.

---

## 2. Chuẩn bị (Phase 0)

```bash
cd /c/9router
git config rerere.enabled true          # nhớ cách resolve conflict
git fetch upstream --prune              # đảm bảo upstream mới nhất
git checkout new-feature
git switch -c merge/upstream-sync       # branch tích hợp từ new-feature
git tag pre-merge-upstream-sync         # mốc rollback bằng tag (ngoài backup của bạn)
```

An toàn kép: bạn đã backup nhánh + ta có tag `pre-merge-upstream-sync`. Rollback bất kỳ lúc nào:
```bash
git merge --abort            # nếu đang giữa merge
git reset --hard pre-merge-upstream-sync
```

---

## 3. Khởi động merge (Phase 1)

```bash
git merge --no-commit --no-ff upstream/master
```
Merge sẽ dừng với 339 conflict. **Không commit vội.** Ta resolve theo nhóm bên dưới, mỗi nhóm `git add` phần đã xong rồi mới commit ở Phase cuối (hoặc commit theo nhóm nếu muốn lịch sử sạch — khuyến nghị commit theo nhóm).

> Ghi chú: vì đây là 1 merge commit duy nhất, "commit theo nhóm" nghĩa là ta có thể tạo các commit phụ TRƯỚC khi merge (không khả thi ở đây) — nên thực tế ta sẽ **resolve tất cả rồi tạo 1 merge commit**, nhưng xử lý & `git add` theo thứ tự nhóm để kiểm soát. Nếu muốn nhiều commit, dùng phương án B ở mục 9.

---

## 4. Xử lý theo nhóm

### Nhóm A — Format-only (ưu tiên 1, tự động phần lớn)
Rất nhiều content-conflict chỉ do prettier: bên bạn xuống dòng import, upstream để 1 dòng (đã thấy ở `chatCore.js`). Cách xử lý an toàn nhất cho nhóm này:

**Chiến lược:** với file mà khác biệt thực chất chỉ là whitespace/format, lấy **bản upstream** cho nội dung rồi chạy prettier để đồng nhất, NHƯNG chỉ khi chắc chắn không mất logic. Quy trình phát hiện:

```bash
# Với mỗi file content-conflict, so sánh bản 2 (ours) và 3 (theirs) bỏ qua whitespace:
for f in $(git diff --name-only --diff-filter=U); do
  if git diff --ignore-all-space --quiet :2:"$f" :3:"$f" 2>/dev/null; then
    echo "FORMAT-ONLY: $f"
  fi
done
```
File nào in ra `FORMAT-ONLY` = hai bên **giống hệt nếu bỏ whitespace** → an toàn lấy 1 bản rồi format:
```bash
git checkout --theirs "$f" && git add "$f"   # lấy bản upstream (mới hơn về format chuẩn repo gốc)
```
Cuối nhóm chạy `npm run format` một lần để chuẩn hóa toàn bộ.

> ⚠️ Chỉ áp dụng lối tắt này cho file THỰC SỰ format-only. File có khác biệt logic phải qua Nhóm C.

### Nhóm B — add/add (119 file, cả 2 tự tạo cùng path)
0 file nào trùng nội dung → **không được bỏ bên nào**. Từng file phải **ghép nội dung**:
- Mở conflict, hiểu mỗi bên định nghĩa gì (thường là: bạn thêm export/hàm A, upstream thêm export/hàm B trong cùng file).
- Gộp: giữ cả hai tập export/hàm/logic. Nếu trùng tên hàm nhưng khác thân → xem Nhóm C (đây là xung đột logic thật).
- Ưu tiên xử lý bằng tay/Agent theo lô thư mục: `open-sse/` trước (core), rồi `src/`, rồi `tests/`.

### Nhóm C — content (213 file, xung đột logic thật)
Đây là phần nặng nhất và là lõi của "giữ tính năng của bạn + chèn cái mới của upstream":
- **Giữ 100% logic tính năng của bạn.**
- **Chèn thêm** import mới, hàm mới, tham số mới, provider/model mới mà upstream thêm.
- Khi cùng một hàm bị cả hai sửa: hợp nhất từng hunk — lấy khung/API mới của upstream nếu nó là refactor, rồi nhét lại logic riêng của bạn vào; hoặc ngược lại tùy hàm. Không xóa nhánh code tính năng của bạn.
- Xử lý theo lô, mỗi lô 10-20 file, build/test tăng dần (mục 6).

Ưu tiên thứ tự trong Nhóm C:
1. `open-sse/config/*` + `open-sse/providers/*` (nền tảng: providers, models, pricing, capabilities)
2. `open-sse/translator/*` (request/response/schema — nhiều file, dễ vỡ nhất)
3. `open-sse/handlers/*`, `open-sse/executors/*`, `open-sse/services/*`
4. `src/lib/*` (db, oauth, headroom, pxpipe, tunnel, mitm)
5. `src/app/**` (API routes + dashboard UI)
6. `src/shared/*`
7. `tests/*` cuối cùng (điều chỉnh test theo API đã hợp nhất)

### Nhóm D — modify/delete (7 file, quyết từng cái)
| File | Tình huống | Quyết định đề xuất |
|---|---|---|
| `open-sse/translator/helpers/claudeHelper.js` | upstream xóa, bạn sửa | **Giữ bản bạn** NẾU còn code nào import nó; nếu upstream đã thay bằng module mới → port logic của bạn sang module mới rồi xóa |
| `open-sse/translator/helpers/imageHelper.js` | upstream xóa, bạn sửa | Như trên — kiểm tra ai còn `import imageHelper` |
| `open-sse/translator/request/openai-to-kiro.old.js` | upstream xóa, bạn sửa | Tên `.old` → nhiều khả năng **xóa** (theo upstream), xác nhận không còn import |
| `src/lib/usage/fetcher.js` | upstream xóa, bạn sửa | Kiểm tra usage đã được thay bằng cấu trúc mới của upstream chưa; nếu rồi → port logic bạn sang chỗ mới |
| `tester/translator/testFromFile.js` | upstream xóa, bạn sửa | Tool test — giữ bản bạn nếu bạn còn dùng |
| `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js` | **bạn xóa**, upstream sửa | Bạn đã refactor bỏ file này → xem đã có file thay thế chưa; nếu có, **giữ trạng thái xóa** và port thay đổi upstream sang file mới |
| `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` | **bạn xóa**, upstream sửa | Như trên |

Lệnh quyết từng file:
```bash
git rm "<path>"                 # theo hướng xóa
# hoặc
git add "<path>"               # sau khi khôi phục + port logic (giữ file)
```
Kiểm tra còn ai import không trước khi xóa (dùng grep toàn repo cho tên file/symbol).

### Nhóm E — rename collision (1 file)
`src/shared/constants/pricing.js` → `open-sse/providers/pricing.js` (rename + content conflict + đụng path khác).
- Xác định vị trí "đúng" sau merge: upstream đã chuyển pricing sang `open-sse/providers/pricing.js`.
- Hợp nhất nội dung pricing của bạn (bảng giá/model bạn thêm) vào file đích `open-sse/providers/pricing.js`.
- Xóa path cũ nếu không còn import; cập nhật mọi import trỏ về path mới.
- Cẩn thận "nested conflict markers" mà git cảnh báo — soi kỹ file này bằng tay.

### Nhóm F — package.json + lockfile (union)
`package.json` conflict chỉ là mỗi bên thêm script khác (đã xác nhận):
- Bạn có: `lint`, `smoke:docker`, `format`, `test`, `test:watch`
- Upstream có: `cli:pack`, `cli:publish`
- **Gộp cả hai** khối scripts. Tương tự với `dependencies`/`devDependencies`: lấy union, nếu trùng package khác version → chọn version cao hơn tương thích, ghi chú lại.
- Sau khi resolve `package.json`:
```bash
rm -f package-lock.json && npm install     # regen lockfile sạch từ package.json đã gộp
# cli cũng vậy nếu cli/package.json bị đụng:
npm --prefix cli install
```
- `git add package.json package-lock.json cli/package.json cli/package-lock.json`

### Nhóm G — file config root còn lại
`.env.example`, `.gitignore`, `next.config.mjs`, `custom-server.js`, `README.md`, `CHANGELOG.md`, `public/i18n/literals/zh-CN.json`:
- `.env.example`, `.gitignore`: **union** (gộp mọi dòng cả hai bên).
- `CHANGELOG.md`, `README.md`: ưu tiên bản upstream + chèn lại mục của bạn; hoặc union theo mốc.
- `next.config.mjs`, `custom-server.js`: xung đột logic → xử lý như Nhóm C (giữ config tính năng bạn + cấu hình mới upstream).
- `zh-CN.json`: gộp key (union), giữ cả bản dịch hai bên.

---

## 5. Thứ tự thực thi (roadmap)

1. **Phase 0** — Chuẩn bị: branch + tag + rerere (mục 2)
2. **Phase 1** — Khởi động merge `--no-commit` (mục 3)
3. **Phase 2** — Nhóm A (format-only auto-detect) → `git add`
4. **Phase 3** — Nhóm F + G (package.json/lockfile + config root) → regen lockfile
5. **Phase 4** — Nhóm B (add/add) theo lô `open-sse` → `src` → `tests`
6. **Phase 5** — Nhóm C (content) theo 7 lớp ưu tiên, build tăng dần
7. **Phase 6** — Nhóm D (modify/delete) + Nhóm E (rename)
8. **Phase 7** — Verify (mục 6) → tạo merge commit
9. **Phase 8** — Đối chiếu tính năng (mục 8) + báo cáo

---

## 6. Verify tăng dần & cổng chất lượng (Phase 7)

Sau MỖI lô lớn của Nhóm C, chạy kiểm tra cú pháp nhanh để bắt lỗi sớm:
```bash
git diff --check                      # phát hiện conflict marker sót (<<<<<<< / >>>>>>>)
npx eslint <thư-mục-vừa-sửa>          # lint cục bộ
```

Khi resolve xong toàn bộ (0 file còn `U` trong `git status`):
```bash
git diff --check                      # PHẢI trống — không còn marker nào
grep -rn '^<<<<<<<\|^>>>>>>>\|^=======$' --include='*.js' . | head   # quét lần cuối

npm run build                         # next build --webpack — PHẢI xanh
npm run test                          # vitest run — PHẢI xanh (46 test files có conflict, chú ý)
npm run lint                          # eslint .
```

**Cổng chặn:** không tạo merge commit / không mở PR nếu build hoặc test đỏ. Fix tới khi xanh.

Tạo merge commit khi mọi thứ xanh:
```bash
git commit -m "merge: sync fork with upstream/decolua v0.5.30 (union, keep all features)"
```

---

## 7. Rủi ro & phương án giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| 339 file quá nhiều, dễ sót logic | Chia lô nhỏ, commit/verify tăng dần, `rerere` bật |
| Test files (46) conflict → khó biết logic đúng | Resolve test SAU cùng, ưu tiên khớp API đã hợp nhất; test là "nguồn chân lý" cho hành vi |
| Nested conflict marker ở pricing rename | Soi tay file `open-sse/providers/pricing.js`, `git diff --check` |
| Lockfile lệch sau union package.json | Regen bằng `npm install`, không sửa tay |
| Refactor lớn của upstream (file bị xóa/di chuyển) | Nhóm D/E xử lý riêng, grep import trước khi xóa |
| Mất tính năng của bạn | Mục 8 checklist đối chiếu + test |

---

## 8. Checklist tính năng của bạn cần còn sống sau merge

Từ commit log của `new-feature`, các tính năng chính phải verify còn nguyên:
- [ ] `external_idp` token refresh cho Microsoft Entra (refresh-providers)
- [ ] Dashboard: hiển thị context length dưới available models trong provider details
- [ ] Provider-detail: copy + toggle connection management + JSON export modal
- [ ] Port CLIProxyAPI features: dynamic models, 429 retry, xAI video, Grok/xAI quota
- [ ] Grok Imagine image options (media)
- [ ] Pagination + quota tracker (feat/pagination-quota-tracker)
- [ ] Worker thread reliability + provider handling refactor

> Sau merge: mở dashboard chạy `npm run dev`, kiểm tra bằng mắt các màn hình provider/usage/media; chạy `vitest run` để test tự động phủ phần còn lại.

---

## 9. Phương án B — nếu muốn lịch sử commit sạch hơn (tùy chọn)

Thay vì 1 merge commit khổng lồ, có thể **rebase theo tính năng** hoặc tách nhiều PR nhỏ. Nhưng với mục tiêu "sync fork full để pull upstream dễ", **1 merge commit là đúng bài** (giữ liên hệ tổ tiên với upstream để lần sau `git pull upstream master` chỉ còn conflict phần mới). Giữ Phương án A (merge).

> Lưu ý: KHÔNG dùng squash cho merge này — squash làm mất liên hệ tổ tiên với upstream, lần sync sau sẽ lại conflict toàn bộ. Merge commit thật mới giúp pull tương lai dễ.

---

## 10. Sau khi merge xong (không tự làm, chờ bạn duyệt)

- Push branch: `git push origin merge/upstream-sync`
- Mở PR nội bộ trong fork của bạn (origin `philau2512/9router`) để review diff trước khi merge vào `master`/`new-feature`.
- KHÔNG mở PR vào `decolua` từ nhánh sync-full này (1047 file, maintainer sẽ không nhận). Nếu muốn đóng góp lên gốc → tách PR theo từng tính năng ở checklist mục 8, mỗi tính năng 1 branch sạch tách từ `upstream/master`.
