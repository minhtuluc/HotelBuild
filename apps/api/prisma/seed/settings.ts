/**
 * Tham số hệ thống tối thiểu — HB-018.
 * Nguồn: BR-SYS-02; ngưỡng công suất theo BR-RATE-01; phí hoàn BR-CANCEL-11 (= 0); lý do bất khả kháng BR-CANCEL-13.
 */
export interface SystemSettingSeed {
  key: string;
  value: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  description: string;
}

/** BR-SYS-02 (khoá tối thiểu) + ngưỡng công suất của BR-RATE-01. */
export const SYSTEM_SETTINGS: readonly SystemSettingSeed[] = [
  {
    key: 'refund.feeAmount',
    value: '0',
    valueType: 'NUMBER',
    description: 'Phí xử lý hoàn tiền (BR-CANCEL-11)',
  },
  {
    key: 'job.hold.releaseIntervalSeconds',
    value: '30',
    valueType: 'NUMBER',
    description: 'Chu kỳ giải phóng hold hết hạn (BR-INV-04)',
  },
  {
    key: 'job.holdReconcile.intervalSeconds',
    value: '900',
    valueType: 'NUMBER',
    description: 'Đối chiếu hold giữa Redis và DB (NFR-REL-02)',
  },
  {
    key: 'job.channelSync.intervalSeconds',
    value: '300',
    valueType: 'NUMBER',
    description: 'Chu kỳ đồng bộ kênh (BR-CHAN-02)',
  },
  {
    key: 'job.overbooking.scanIntervalMinutes',
    value: '60',
    valueType: 'NUMBER',
    description: 'Chu kỳ quét quá tải (BR-OVER-05)',
  },
  {
    key: 'job.occupancy.snapshotIntervalSeconds',
    value: '300',
    valueType: 'NUMBER',
    description: 'Chu kỳ chụp công suất (BR-RATE §4.3)',
  },
  {
    key: 'job.noShow.markTime',
    value: '23:59',
    valueType: 'STRING',
    description: 'Mốc đánh dấu no-show theo giờ VN (BR-CANCEL-10)',
  },
  {
    key: 'deal.threshold.minor',
    value: '5000000',
    valueType: 'NUMBER',
    description: 'Ngưỡng hai cấp phê duyệt hoàn (BR-CANCEL-15)',
  },
  {
    key: 'deal.threshold.checkInDebt',
    value: '5000000',
    valueType: 'NUMBER',
    description: 'Ngưỡng nợ cho phép check-in (BR-FO-01)',
  },
  {
    key: 'deal.threshold.checkInDebtPct',
    value: '50',
    valueType: 'NUMBER',
    description: 'Ngưỡng nợ theo phần trăm (BR-FO-01)',
  },
  {
    key: 'channel.lowInventoryThreshold',
    value: '2',
    valueType: 'NUMBER',
    description: 'Ngưỡng tồn thấp để đóng bán OTA (BR-CHAN-05)',
  },
  {
    key: 'pricing.weekendMultiplier',
    value: '1.20',
    valueType: 'NUMBER',
    description: 'Hệ số cuối tuần T6/T7 (BR-RATE-06)',
  },
  {
    key: 'pricing.maxDiscountPct',
    value: '30',
    valueType: 'NUMBER',
    description: 'Trần tổng giảm giá (BR-RATE-11)',
  },
  {
    key: 'pricing.occupancyMidPct',
    value: '80',
    valueType: 'NUMBER',
    description: 'Ngưỡng công suất trung bình (BR-RATE-01 bước 4)',
  },
  {
    key: 'pricing.occupancyHighPct',
    value: '95',
    valueType: 'NUMBER',
    description: 'Ngưỡng công suất cao (BR-RATE-01 bước 4)',
  },
  {
    key: 'cancel.forceMajeure.minReasonLength',
    value: '20',
    valueType: 'NUMBER',
    description: 'Độ dài tối thiểu của lý do bất khả kháng (BR-CANCEL-13)',
  },
  {
    key: 'overbooking.transportSupportCap',
    value: '500000',
    valueType: 'NUMBER',
    description: 'Trần hỗ trợ đưa đón khi điều chuyển (BR-OVER-06)',
  },
];
