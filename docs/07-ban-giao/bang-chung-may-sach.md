# Bằng chứng dựng trên máy sạch (HB-192, tiêu chí 1)

**Ngày:** 11/11/2026. **Người chạy:** Claude (vai thi công chủ đạo). **Commit:** `main` d3e9963, cộng bản sửa HB-233 (#282) áp lên bản clone.

## Phạm vi và giới hạn

- **Đã làm:** `git clone` mới vào thư mục trống, không có `node_modules`, không có `.env`; làm từng bước theo [README](../../README.md) "Dựng trên máy sạch".
- **Giới hạn, cần người khác thử lại:**
  - Cùng một máy dev (Fedora, Node 22.23, pnpm 10.34.5); store pnpm có sẵn nên `pnpm install` chỉ mất 7 giây.
  - Container PostgreSQL 16 / Redis 7 của dev đang chạy và giữ cổng 5432/6379, nên dùng lại chúng thay cho `pnpm infra:up`, với CSDL riêng `hb192_clean`.
  - Tiêu chí "người khác thử, ghi kết quả" của HB-192 vẫn **chưa đạt**. Cần một máy khác hoặc container sạch.

## Kết quả

| Bước | Kết quả |
| --- | --- |
| `pnpm install --frozen-lockfile` | Thành công (7,2 giây, store đã có) |
| `cp .env.example .env` + sinh hai khoá JWT | Thành công |
| `pnpm migrate` | `Migration deploy succeeded` |
| `pnpm db:dev-roles` | `Development app_rw login configured` |
| `SEED_DEV_PASSWORD=… pnpm db:seed` | 3 cơ sở, 15 loại phòng, 55 phòng, 75 đơn vị bán, 7 kênh, 7 tài khoản |
| `pnpm --filter @pinehill/api dev` | **Lần đầu thất bại**: `Cấu hình thiếu/sai: EXPORT_DIR` (`EXPORT_DIR=` để trống bị từ chối). Sau HB-233: health 200 sau 4 giây; `POST /auth/login` với `owner` trả access token |
| `pnpm --filter @pinehill/worker dev` | **Lần đầu thất bại**: `EXPORT_DIR, NOTI_SMTP_URL, NOTI_SMTP_FROM`. Sau HB-233: chạy, xử lý `q.notification-send` |
| `pnpm --filter @pinehill/customer-web dev` | `GET /` 200 (cổng 3001) |
| `pnpm --filter @pinehill/operations-web dev` | `GET /` 200 (cổng 3002) |

## Phát hiện

1. **README cũ lỗi thời:** vẫn ghi "backend chưa được dựng", hướng dẫn `npm ci`, không có bước chạy app. Đã viết lại.
2. **API/worker không khởi động từ `.env.example`:** biến để trống bị từ chối. Đã sửa ở HB-233 (#282).
3. `.env.example` trỏ Redis DB 0. Trên máy đã có môi trường dev khác, worker mới sẽ nhận job của môi trường đó. README đã thêm lưu ý đổi chỉ số DB.
