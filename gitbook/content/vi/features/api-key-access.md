# Kiểm soát truy cập API Key

Kiểm soát các loại provider và model mà một API key cục bộ được phép sử dụng. Tính năng này hữu ích khi nhiều client hoặc môi trường dùng chung một 9Router instance.

Kiểm soát truy cập độc lập với budget của key: request phải thỏa cả budget lẫn access policy của key.

---

## Cấu hình key

1. Mở **Dashboard → Key Budgets**.
2. Chọn API key cần cấu hình, sau đó chọn **Edit Access**.
3. Chọn provider type và/hoặc model được phép.
4. Chọn **Save Access**.

Card của key hiển thị **All access** hoặc số lượng provider và model đã cấu hình.

> Xóa cả hai danh sách để khôi phục quyền truy cập không giới hạn.

## Quy tắc khớp

9Router kiểm tra quyền truy cập bằng provider và model sau khi đã resolve, không dùng alias model ban đầu do client gửi.

| Cấu hình | Kết quả |
| --- | --- |
| Không có provider và model | Key dùng được mọi model đang có. |
| Chỉ có providers | Key dùng được mọi model được route qua một trong các provider đó. |
| Chỉ có models | Key chỉ dùng được các canonical model string đã liệt kê. |
| Có cả hai danh sách | Request được phép khi **provider hoặc model** khớp. |

Một model entry dùng giá trị canonical `provider/model`, ví dụ `openai/gpt-4o`.

### Ví dụ

| Allowed providers | Allowed models | Request | Kết quả |
| --- | --- | --- | --- |
| `claude` | — | `claude/claude-sonnet-4-5` | Được phép |
| `claude` | — | `openai/gpt-4o` | Bị từ chối |
| — | `openai/gpt-4o` | `openai/gpt-4o` | Được phép |
| `claude` | `openai/gpt-4o` | bất kỳ Claude model nào | Được phép |
| `claude` | `openai/gpt-4o` | `openai/gpt-4o` | Được phép |

## Aliases và combos

- **Aliases** được resolve trước khi kiểm tra quyền. Alias không thể cấp quyền đến target mà key không cho phép.
- **Combos** được kiểm tra từng member. Mọi model đã resolve trong combo đều phải được cho phép; chỉ một member bị từ chối cũng sẽ khiến request thất bại.

Request bị từ chối trả về HTTP `403` với một trong các mã máy đọc được:

- `provider_not_allowed`
- `model_not_allowed`
- `access_not_allowed`

## Danh mục model

Khi request gửi API key hợp lệ có allowlist, 9Router lọc các model catalog sau để chỉ hiển thị model key có thể truy cập:

- `GET /v1/models`
- `GET /v1/models/{kind}`
- `GET /v1beta/models`

Không gửi API key, hoặc dùng key có cả hai allowlist trống, sẽ vẫn thấy toàn bộ catalog trong optional-key local mode.

## Quản lý qua API

Dùng key management endpoints hiện có để đọc hoặc cập nhật quyền truy cập.

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

Hai trường là mảng chuỗi không rỗng và đều là tùy chọn. `null` hoặc `[]` sẽ xóa allowlist ở phía tương ứng.

## Phạm vi hiện tại

Access policy hiện bảo vệ các chat-compatible request paths và model catalog endpoints nêu trên. Nó chưa áp dụng cho image, video, TTS, STT, embedding hoặc search handlers.