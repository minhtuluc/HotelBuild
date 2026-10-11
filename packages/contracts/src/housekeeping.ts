/**
 * Hợp đồng buồng phòng — api.md §2.9; HB-140.
 *
 * **Projection tối thiểu (BR-RBAC-03):** DTO chỉ có dữ liệu *nhiệm vụ* — phòng, ngày nghiệp vụ, trạng
 * thái, người được giao, ghi chú, phiên bản. **Không** có trường booking, khách hay tiền; test hợp đồng
 * khẳng định điều này để HOUSEKEEPING không thấy dữ liệu ngoài phạm vi.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import { housekeepingStatusSchema } from './enums.js';

/** Mã phòng để hiển thị nhiệm vụ; không kèm loại phòng/giá. */
export const housekeepingTaskSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  roomCode: z.string().min(1),
  businessDate: businessDateSchema,
  status: housekeepingStatusSchema,
  assignedTo: z.string().min(1).nullable(),
  note: z.string().max(500).nullable(),
  completedAt: isoUtcTimestampSchema.nullable(),
  version: z.number().int().min(0),
});

export const housekeepingTaskQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  businessDate: businessDateSchema,
  status: housekeepingStatusSchema.optional(),
  assignedTo: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/**
 * `PATCH /housekeeping/tasks/{taskId}` — HOUSEKEEPING cập nhật việc của mình; `assignedTo` chỉ
 * FRONT_DESK/MANAGER được đổi (kiểm ở tầng nghiệp vụ, hợp đồng chỉ khai trường). Có `If-Match` theo version.
 */
export const housekeepingTaskUpdateRequestSchema = z.strictObject({
  status: housekeepingStatusSchema.optional(),
  note: z.string().max(500).optional(),
  assignedTo: z.string().min(1).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export type HousekeepingTask = z.infer<typeof housekeepingTaskSchema>;
export type HousekeepingTaskQuery = z.infer<typeof housekeepingTaskQuerySchema>;
export type HousekeepingTaskUpdateRequest = z.infer<typeof housekeepingTaskUpdateRequestSchema>;
