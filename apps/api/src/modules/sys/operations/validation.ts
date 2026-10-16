import { z } from 'zod';
import { operationDownloadQuerySchema } from '@pinehill/contracts';
import { invalid, uuid } from '../../inv/allotments/validation.js';

/** Thân lệnh xuất báo cáo đã lưu trong `operations.payload_json` (server đã kiểm khi tạo). */
export const exportPayloadSchema = z.object({
  report: z.enum(['occupancy', 'adr-revpar', 'revenue-by-channel', 'cancellations']),
  format: z.enum(['CSV', 'XLSX']),
  params: z.record(z.string(), z.string()),
});

export function operationId(value: string): string {
  return uuid(value);
}

export function downloadQuery(value: unknown) {
  const result = operationDownloadQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
