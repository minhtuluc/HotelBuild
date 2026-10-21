/**
 * Chính sách lấy mẫu trace (NFR-OBS-03) — **một** chỗ quyết định ở phía ứng dụng.
 *
 * Ứng dụng **luôn xuất đủ span** cho collector; việc bỏ mẫu (và giữ 100% trace lỗi/thanh toán) do
 * `tail_sampling` của OTel Collector quyết định — xem `infra/observability/otel-collector.yml`. Tỉ lệ ở đây
 * chỉ dùng để đặt **cờ sampled của W3C** (`traceparent`) cho dịch vụ nhận, không dùng để bỏ span cục bộ;
 * đặt mẫu ở hai nơi sẽ làm số liệu SLO sai (lưu lượng lành bị nhân đôi tỉ lệ, lỗi bị khuếch đại).
 */
export const DEFAULT_SAMPLE_RATIO = 0.1;

/** Thuộc tính đánh dấu trace quan trọng — collector giữ 100% trace mang giá trị này. */
export const CRITICAL_ATTRIBUTE = 'pinehill.sampling.critical';
export const CRITICAL_PAYMENT = 'PAYMENT';

/** Đường dẫn tiền tệ của API (sau tiền tố `/api/v1`): thanh toán, webhook PSP, hoàn tiền. */
export const PAYMENT_PATHS: readonly string[] = [
  '/payments',
  '/integrations/psp',
  '/refund-requests',
];

export function isPaymentPath(url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/^\/api\/v1/, '');
  return PAYMENT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Quyết định theo `traceId` nên hai lần gọi trên cùng một trace luôn cho cùng kết quả. */
export function traceIdSamples(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  const bucket = Number.parseInt(traceId.slice(-8), 16);
  return Number.isFinite(bucket) && bucket / 0x1_0000_0000 < ratio;
}
