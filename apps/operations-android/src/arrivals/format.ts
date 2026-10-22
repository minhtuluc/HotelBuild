/** Định dạng hiển thị cho SCR-57/58. Chỉ trình bày: không suy ra luật nghiệp vụ từ đồng hồ thiết bị. */

const VN_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `HH:mm dd/MM/yyyy` theo giờ Việt Nam (NFR-LOC-02) từ mốc ISO UTC; chuỗi hỏng → `—`. */
export function formatVnDateTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    VN_PARTS.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('day')}/${part('month')}/${part('year')}`;
}
