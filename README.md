# Pine Hill — Thiết kế OOAD hệ thống đặt phòng

Bộ yêu cầu, phân tích và thiết kế cho chuỗi khách sạn–homestay. Repository hiện chứa **tài liệu thiết kế và công cụ kiểm tra tài liệu**, chưa chứa ứng dụng vận hành.

- [Bản đồ tài liệu](docs/README.md)
- [Hướng dẫn bàn giao cho đội thi công](docs/07-ban-giao/huong-dan-thi-cong.md)
- [Kết quả kiểm chứng và công việc còn lại](docs/07-ban-giao/ket-qua-kiem-chung.md)
- [Quy tắc nghiệp vụ](docs/02-nghiep-vu/quy-tac-nghiep-vu.md)
- [API](docs/04-thiet-ke/api.md) · [CSDL](docs/04-thiet-ke/csdl.md) · [Quyết định kiến trúc](docs/04-thiet-ke/adr/README.md)
- [Ma trận truy vết](docs/06-truy-vet/ma-tran-truy-vet.md)

## Kiến trúc sản phẩm tham chiếu

Thiết kế mục tiêu dùng **một backend chung** cho toàn hệ thống và bốn ứng dụng giao diện độc lập:

| Sản phẩm | Thư mục thi công dự kiến | Người dùng chính |
|---|---|---|
| Customer Web | `apps/customer-web` | Khách tự tìm phòng, đặt, thanh toán, huỷ/đổi ngày |
| Customer Android | `apps/customer-android` | Khách sử dụng trên thiết bị Android |
| Operations Web | `apps/operations-web` | Lễ tân, quản lý, kế toán, chủ chuỗi, quản trị hệ thống |
| Operations Android | `apps/operations-android` | Lễ tân, quản lý cơ sở, buồng phòng tại hiện trường |
| Backend + worker dùng chung | `apps/api`, `apps/worker` | API, transaction nghiệp vụ, job nền, outbox và tích hợp |

Các hợp đồng API và mô hình miền dùng chung nằm trong `packages/contracts` và `packages/domain`; UI web/native không chia sẻ component một cách gượng ép. Cây thư mục này là **blueprint cho giai đoạn thi công**, không phải tuyên bố các app đã được triển khai.

## Kiểm tra tại máy

Node.js 22.13 trở lên:

```sh
npm ci
npm run check
```

Lệnh kiểm tra liên kết/anchor Markdown, cú pháp Mermaid, mã yêu cầu và truy vết, công cụ trích DDL, các ràng buộc CSDL bằng PostgreSQL nhúng. Xem scripts trong [package.json](package.json) và hướng dẫn bàn giao để phân biệt kiểm tra đã thực thi với nghiệm thu ứng dụng trong tương lai. PostgreSQL nhúng không thay thế kiểm thử cạnh tranh và vận hành trên PostgreSQL 16.

Không dùng DDL mẫu để chạy trực tiếp vào cơ sở dữ liệu đang vận hành. Khi thi công, chuyển DDL thành migration được review, kiểm tra dữ liệu, backup và diễn tập phục hồi trước triển khai.

## Kiểm thử PostgreSQL 16 thật

Trỏ `DATABASE_URL` tới cluster PostgreSQL 16 dành riêng cho kiểm thử, với quyền tạo database/role và extension. Runner xác minh major version, tạo database tên ngẫu nhiên, chạy DDL/test rồi xoá database tạm. Không dùng cluster production; role kiểm thử là cấp cluster.

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/postgres'
npm run test:postgres
```

Thay USER/PASSWORD bằng thông tin local; không commit credential. Ca cạnh tranh dùng hai kết nối độc lập, quan sát khóa thật và kiểm cả commit/rollback. Kết quả mới nhất và các cổng chưa nghiệm thu nằm trong báo cáo kiểm chứng ở đầu trang.
