/**
 * Nhãn SCR-25 (allotment theo kênh) tách khỏi `i18n.ts` vì danh mục dùng chung đã chạm trần 400 dòng
 * (`max-lines`); khoá vẫn được gộp vào `operationsCatalog` nên `t('allotments.…')` không đổi.
 */
export const allotmentsCatalog = {
  'ops.nav.allotments': 'Hạn mức kênh',
  'allotments.title': 'Allotment theo kênh',
  'allotments.intro':
    'Hạn mức bán của một kênh × một loại phòng theo ngày. Hạn mức mỗi kênh không vượt số đơn vị bán đang hoạt động của loại phòng; tổng các kênh không bị giới hạn (BR-INV-05). Kênh trực tiếp không có hạn mức riêng (BR-CHAN-08).',
  'allotments.col.date': 'Ngày',
  'allotments.col.allotment': 'Hạn mức',
  'allotments.col.used': 'Đã dùng',
  'allotments.col.warnings': 'Cảnh báo',
  'allotments.caption': 'Hạn mức theo ngày · số đơn vị bán đang hoạt động: {units}',
  'allotments.captionNoUnits':
    'Hạn mức theo ngày · máy chủ chưa trả số đơn vị bán nên không cảnh báo vượt hạn mức',
  'allotments.unitsNote':
    'Loại phòng này có {units} đơn vị bán đang hoạt động: hạn mức từng ngày không nên vượt số đó.',
  'allotments.inputLabel': 'Hạn mức ngày {date}',
  'allotments.issue.OUT_OF_RANGE': 'Hạn mức phải là số nguyên không âm.',
  'allotments.issue.OVER_SELLING_UNITS': 'Vượt số đơn vị bán đang hoạt động (máy chủ sẽ chặn).',
  'allotments.issue.RANGE_INVALID': 'Khoảng ngày phải có ít nhất một ngày và không quá 31 ngày.',
  'allotments.issue.TOO_MANY_DAYS': 'Lô gửi tối đa 31 ngày.',
  'allotments.issue.BEFORE_START': 'Ngày kết thúc phải sau ngày bắt đầu.',
  'allotments.issue.MISSING_ETAG':
    'Chưa có phiên bản của lần đọc (ETag) nên chưa lưu được — tải lại rồi thử lại.',
  'allotments.issue.UNCHANGED': 'Chưa có ngày nào thay đổi.',
  'allotments.form.channel': 'Kênh',
  'allotments.form.property': 'Cơ sở',
  'allotments.form.roomType': 'Loại phòng',
  'allotments.form.from': 'Từ ngày',
  'allotments.form.to': 'Đến ngày',
  'allotments.form.load': 'Xem hạn mức',
  'allotments.save': 'Lưu lô',
  'allotments.saved': 'Đã lưu {count} ngày và đọc lại dữ liệu.',
} as const;
