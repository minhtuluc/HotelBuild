/** Câu chữ SCR-57/58 (khách đến & check-in) — mọi nhãn hiển thị/trợ năng đi qua danh mục này. */
import { makeTranslate } from '@pinehill/ui-native';

export const catalog = {
  title: 'Khách đến hôm nay',
  date: 'Ngày {date}',
  back: 'Về màn chính',
  refresh: 'Làm mới',
  filter: 'Tìm theo mã booking',
  scan: 'Quét mã QR',
  idle: 'Chưa tải danh sách khách đến.',
  loading: 'Đang tải danh sách khách đến…',
  ready: 'Danh sách khách đến',
  empty: 'Hôm nay không có khách đến.',
  offline: 'Chưa có dữ liệu ngoại tuyến. Kết nối mạng rồi bấm Làm mới.',
  expired: 'Phiên đã hết hạn. Hãy đăng nhập lại.',
  forbidden: 'Vai trò của bạn không được xem danh sách khách đến.',
  error: 'Không thể tải danh sách. Vui lòng thử lại.',
  truncated: 'Danh sách bị giới hạn. Dùng ô tìm theo mã booking hoặc Tra cứu.',
  synced: 'Đồng bộ lúc {time} (giờ VN)',
  staleOffline:
    'Đang ngoại tuyến — hiển thị dữ liệu đã tải lúc {time}. Cần mạng để xác nhận nhận phòng.',
  staleError: 'Không làm mới được — hiển thị dữ liệu đã tải lúc {time}.',
  noFilterMatch: 'Không có booking nào khớp từ khoá trong danh sách khách đến hôm nay.',
  scanDenied: 'Chưa cấp quyền camera. Bạn vẫn nhập mã booking vào ô tìm kiếm để tiếp tục.',
  scanUnavailable: 'Quét mã QR chưa khả dụng trên bản này. Nhập mã booking vào ô tìm kiếm.',
  scanInvalid: 'Mã QR không phải mã booking. Nhập mã vào ô tìm kiếm.',
  scanNoMatch:
    'Booking {code} không nằm trong danh sách khách đến hôm nay. Dùng Tra cứu để kiểm tra.',
  scanCancelled: 'Đã huỷ quét. Bạn vẫn nhập mã booking vào ô tìm kiếm được.',
  open: 'Mở nhận phòng {code}',
  guestsLine: '{rooms} phòng · {adults} người lớn · {children} trẻ em',
  moneyLine: 'Đã thu {paid} / cọc {deposit} · còn phải thu {balance}',
  penaltyLine: 'Phí phạt: {penalty}',
  checkInTitle: 'Nhận phòng {code}',
  totalLine: 'Tổng {total} · đã thu {paid}',
  balanceLine: 'Còn phải thu {balance}',
  balanceNote:
    'Còn phải thu. Điều kiện nhận phòng (nợ, ngày, phòng sẵn sàng) do máy chủ quyết định; nếu bị từ chối, thu số dư hoặc nhờ quản lý duyệt.',
  collect: 'Thu số dư',
  roomsLegend: 'Phòng gán cho khách (chọn đúng {count})',
  roomsHint: 'Đã chọn sẵn phòng gợi ý theo mã; đổi nếu cần. Máy chủ kiểm tra phòng sẵn sàng.',
  roomsEmpty: 'Chưa tải được phòng ACTIVE của loại phòng này.',
  roomIssue: 'Chọn đúng {count} phòng trước khi gửi.',
  roomOption: 'Phòng {code}',
  early: 'Nhận phòng sớm',
  earlyNote:
    'Phụ thu nhận sớm (nếu có) do máy chủ tính theo BR-FO-04 và hiện sau khi nhận phòng; màn hình không tự tính.',
  idNumber: 'Số giấy tờ tuỳ thân (tuỳ chọn)',
  note: 'Ghi chú (tuỳ chọn)',
  submit: 'Xác nhận nhận phòng',
  submitting: 'Đang gửi…',
  offlineBlock:
    'Cần kết nối mạng để xác nhận nhận phòng. Không có thao tác nào được gửi hoặc xếp hàng.',
  closeDetail: 'Về danh sách',
  done: 'Máy chủ đã xác nhận nhận phòng {code} lúc {time}.',
  roomsAssigned: 'Phòng đã gán: {rooms}',
  earlyFee: 'Phụ thu nhận sớm máy chủ trả: {amount}',
  rejected: 'Máy chủ từ chối nhận phòng',
  rejectedCode: 'Mã lỗi: {code}',
  rejectedReason: 'Lý do máy chủ trả: {reason}',
  conflict: 'Dữ liệu booking đã thay đổi. Bấm Làm mới danh sách rồi thử lại.',
  failForbidden: 'Bạn không có quyền nhận phòng cho booking này hoặc phiên đã hết hạn.',
  unknownOutcome:
    'Chưa xác định kết quả (mã tham chiếu: {reference}). Làm mới danh sách để đối soát; bấm xác nhận lại sẽ dùng cùng khoá nên không nhận phòng hai lần.',
  reconcile: 'Làm mới để đối soát',
} as const;

export const arrivalsText = makeTranslate(catalog);
