# QĐ-05 — Chốt mâu thuẫn tài liệu cho ba engine HB-032, HB-052, HB-053

**Ngày:** 02/10/2026 · **Người lập:** lead (Opus) theo báo cáo của Codex · **Nguyên tắc chung:** khi kế hoạch kiểm thử hoặc thiết kế lớp mâu thuẫn với quy tắc nghiệp vụ (`docs/02-nghiep-vu`), **quy tắc nghiệp vụ thắng**; sửa tài liệu kém thẩm quyền trong cùng PR.

| # | Ticket | Mâu thuẫn | Quyết định |
|---|---|---|---|
| 1 | HB-053 | BR-BOOK-18 (hoàn toàn bộ tiền trước xác nhận) vs BR-GEN-03 và chính sách huỷ §5 bước 6 (hoàn làm tròn xuống 1.000) khi phân bổ ra số lẻ (vd. 5.001 VND) | Booking **chưa** xác nhận hoàn **đúng số đã thu**, không làm tròn. Làm tròn xuống chỉ áp cho tiền hoàn tính theo chính sách huỷ của booking đã xác nhận. Lý do: trả lại tiền chưa thành giao dịch không phải là áp chính sách, và không được giữ tiền lẻ của khách. Đã ghi ngoại lệ vào BR-GEN-03 và bảng §5 — **người dùng có quyền bác** |
| 2 | HB-032 | TC-INV-07 giới hạn **tổng** allotment các kênh ≤ 13, BR-INV-05 chỉ giới hạn từng kênh | Theo BR-INV-05: giới hạn từng kênh; hạn mức hiệu lực `min(allotment − used, tồn chung)` |
| 3 | HB-032 | TC-INV-11 "tồn/used không âm" vs BR-INV-01 cho `pool` âm | `pool` nội bộ được âm; tồn công bố `max(0, pool)` và `used` không âm |
| 4 | HB-032 | Thiết kế lớp `NightAvailability` dùng công thức cũ (bỏ sót CONFIRMED chưa gán) | Đồng bộ theo BR-INV-01 |
| 5 | HB-052 | AC đòi đảo hai hệ số làm đổi kết quả (phép nhân giao hoán) | TC-RATE-01 kiểm thứ tự dấu vết 11 bước + phản ví dụ đảo kẹp/kênh hoặc AMOUNT/PERCENT |
| 6 | HB-052 | AC đòi mọi tiền ra bội 1.000 nhưng giá sau từng bước có số lẻ | Bội 1.000 chỉ cho giá đêm, subtotal, total, cọc đã chốt; giá trung gian là phân số chính xác (tử/mẫu nguyên), không số thực, không làm tròn trung gian |
| 7 | HB-052 | TC-RATE-02 (2 đêm SE-REUN + 1 đêm thường) vs động giá §5 ca 2 (3 đêm SE-REUN, OTA_BOOKING, 8.112.000) | Theo động giá §5 ca 2 |
| 8 | HB-052 | TC-RATE-06 ghi hệ số SE-REUN 2,20, nguồn ghi 1,80 | 1,80 |
| 9 | HB-052 | TC-RATE-07 định nghĩa công suất riêng (assignment + hold, loại phòng block) vs BR §4.3 | Theo BR §4.3 |

Bổ sung AGENTS.md §4 (tự quyết): kế hoạch kiểm thử hoặc thiết kế 03–04 mâu thuẫn quy tắc nghiệp vụ thì làm theo quy tắc nghiệp vụ và sửa tài liệu đó trong cùng PR; chỉ dừng khi **hai quy tắc nghiệp vụ** mâu thuẫn nhau (như mục 1).
