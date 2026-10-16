# Kênh thông báo của worker (`src/noti`)

## Kênh email

- Cấu hình lấy từ `WorkerConfig` (`NOTI_SMTP_URL`/`NOTI_SMTP_FROM`); thiếu ⇒ kênh EMAIL lỗi
  `EMAIL_NOT_CONFIGURED` (không giả vờ đã gửi).
- **Bảo mật — thân thư được chuẩn hoá kết thúc dòng về CRLF rồi mới dot-stuffing** trước khi gửi khối
  `DATA` (`smtp.ts`): `renderMessage` nối thân thư bằng LF, mà nhiều máy chủ SMTP vẫn coi LF là kết thúc
  dòng — một dòng `.` sau LF trần sẽ không được nhân đôi và có thể kết thúc `DATA` sớm, biến phần còn lại
  của nội dung (`guestName`/`reason` chứa `\n`) thành lệnh SMTP (SMTP smuggling). Cùng lý do đó, mọi giá
  trị đưa vào **một dòng lệnh/tiêu đề** (`From`/`To`/`Subject`, `MAIL FROM`/`RCPT TO`) đều bị làm phẳng
  CR/LF. Không đổi hợp đồng nào với bên ngoài.
- SMS/ZALO_OA/PUSH là adapter **giả lập có chủ ý**: dựng nội dung + kiểm người nhận, không gọi mạng; chỉ
  EMAIL đi SMTP thật.
