/**
 * Smoke tích hợp F0-08 cho shell Android: gọi API qua `ApiClient` dùng chung.
 * Tách khỏi React để chạy được trong kiểm thử node (không cần thiết bị).
 */
import { isApiError, type ApiClient } from '@pinehill/api-client';

export type ProbeOutcome =
  | { kind: 'ok' }
  | { kind: 'forbidden' }
  | { kind: 'failed'; code: string; reference: string | undefined };

export async function probeHealth(client: ApiClient): Promise<ProbeOutcome> {
  try {
    await client.requestVoid({ method: 'GET', path: '/system/health' });
    return { kind: 'ok' };
  } catch (error) {
    // Chỉ nuốt lỗi đã chuẩn hoá; lỗi khác (lập trình) phải nổi lên biên lỗi.
    if (!isApiError(error)) throw error;
    if (error.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'failed',
      code: error.knownCode ?? error.kind,
      reference: error.traceId ?? error.correlationId,
    };
  }
}
