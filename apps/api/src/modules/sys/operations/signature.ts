import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Link tải tệp xuất có hạn: HMAC-SHA256 trên `operationId:expires` bằng `JWT_ACCESS_SECRET`.
 * Dùng lại khoá ký sẵn có thay vì thêm biến môi trường mới cho một tính năng phụ (ghi rõ trong README);
 * link vẫn còn hai lớp bảo vệ khác: bearer token của **chính người yêu cầu** và hạn `result_expires_at`.
 */
export function downloadSignature(
  secret: string,
  operationId: string,
  expiresAtSeconds: number,
): string {
  return createHmac('sha256', secret).update(`${operationId}:${expiresAtSeconds}`).digest('hex');
}

export function signatureMatches(
  secret: string,
  operationId: string,
  expiresAtSeconds: number,
  provided: string,
): boolean {
  const expected = Buffer.from(downloadSignature(secret, operationId, expiresAtSeconds), 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
