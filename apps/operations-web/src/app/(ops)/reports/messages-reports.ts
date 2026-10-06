/**
 * Nhãn SCR-52/SCR-53 (báo cáo F8) — tách khỏi `lib/i18n.ts` (đã chạm trần 400 dòng) và gộp lại trong
 * `operationsCatalog`, nên `t('reports.…')` dùng như mọi khoá khác (NFR-LOC-01).
 */
export const reportsCatalog = {
  'ops.nav.reportsOccupancy': 'Công suất & ADR/RevPAR',
  'ops.nav.reportsRevenue': 'Doanh thu theo kênh',
  'reports.filters.property': 'Cơ sở',
  'reports.filters.from': 'Từ ngày',
  'reports.filters.to': 'Đến ngày',
  'reports.filters.groupBy': 'Gộp theo',
  'reports.filters.load': 'Xem báo cáo',
  'reports.groupBy.DAY': 'Ngày',
  'reports.groupBy.ROOM_TYPE': 'Loại phòng',
  'reports.groupBy.PROPERTY': 'Cơ sở',
  'reports.occupancy.title': 'Báo cáo công suất',
  'reports.occupancy.intro':
    'Số đơn vị bán và công suất theo kỳ đã chọn. Chỉ số lấy nguyên từ máy chủ (BR-REP-01); giao diện không tự định nghĩa lại.',
  'reports.occupancy.table': 'Công suất theo kỳ',
  'reports.occupancy.formula':
    'Công suất = phòng-đêm đã bán ÷ phòng-đêm khả dụng. Loại phòng DOR đếm theo đơn vị bán (giường), không theo phòng (BR-PROP-03).',
  'reports.adr.title': 'ADR & RevPAR',
  'reports.adr.table': 'ADR và RevPAR theo kỳ',
  'reports.adr.formula':
    'ADR = doanh thu thuần ÷ phòng-đêm đã bán. RevPAR = doanh thu thuần ÷ phòng-đêm khả dụng. Doanh thu thuần đã trừ hoa hồng (BR-RATE-08).',
  'reports.revenue.title': 'Doanh thu theo kênh',
  'reports.revenue.intro':
    'Doanh thu gộp, hoa hồng và doanh thu thuần theo từng kênh bán. Số đọc từ snapshot giá/hoa hồng lúc bán, không đọc cấu hình kênh hiện tại.',
  'reports.revenue.table': 'Doanh thu theo kênh trong kỳ',
  'reports.revenue.formula':
    'Doanh thu thuần = doanh thu gộp − hoa hồng phải trả. Tổng các kênh không giới hạn theo hạn mức (QĐ-05 mục 2).',
  'reports.revenue.total': 'Tổng cộng',
  'reports.col.key': 'Mốc gộp',
  'reports.col.soldUnits': 'Đơn vị đã bán',
  'reports.col.availableUnits': 'Đơn vị khả dụng',
  'reports.col.occupancyPct': 'Công suất (%)',
  'reports.col.roomNightsSold': 'Phòng-đêm đã bán',
  'reports.col.roomNightsAvailable': 'Phòng-đêm khả dụng',
  'reports.col.netRevenue': 'Doanh thu thuần',
  'reports.col.adr': 'ADR',
  'reports.col.revpar': 'RevPAR',
  'reports.col.channel': 'Kênh',
  'reports.col.gross': 'Gộp',
  'reports.col.commission': 'Hoa hồng',
  'reports.col.net': 'Thuần',
  'reports.col.bookings': 'Số booking',
  'reports.export.csv': 'Xuất CSV',
  'reports.export.xlsx': 'Xuất XLSX',
  'reports.export.status': 'Tác vụ xuất: {status}',
  'reports.op.PENDING': 'đang chờ',
  'reports.op.RUNNING': 'đang chạy',
  'reports.op.SUCCEEDED': 'xong',
  'reports.op.FAILED': 'lỗi',
  'reports.issue.REQUIRED': 'Bắt buộc.',
  'reports.issue.BEFORE_START': 'Ngày kết thúc phải sau ngày bắt đầu.',
} as const;
