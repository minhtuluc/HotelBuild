# HB-035 — grid chỉ đọc

GET `/api/v1/inventory/grid` dùng primary PostgreSQL và loader HB-034 + engine HB-032.
Range gồm cả from/to, tối đa31 ngày lịch hợp lệ; transaction REPEATABLE READ, một
instant từ clock_timestamp cho mọi loại. Không khoá hàng/ghi dữ liệu, no-store.

Pool được âm; published và channelAvailable dùng trực tiếp kết quả engine.
Kênh INACTIVE/missing trả channelAvailable0. Không truyền channelCode thì không
trả trường này. Không lọc loại phòng: grids chứa mọi loại theo code/id, root là
bản chiếu loại đầu, không phải tổng cơ sở. Không có loại phù hợp trả404.

Nguồn quyền BR-RBAC-03 + UC-INV-01: FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER
trong phạm vi. Ticket/API cũ ghi HOUSEKEEPING không phù hợp nguồn; giữ ticket và
BR bất biến, đồng bộ docs04 theo QĐ05/AGENTS§4.
