import { businessDateSchema, roomTypeSummarySchema } from '@pinehill/contracts';
import { propertyCatalogueQuery } from '../catalogue-query';

/**
 * `GET /rate-plans` (bản công khai) qua phiên nhân viên (HB-201): màn SCR-33/34 đọc điều khoản gói
 * giá ở bước chọn phòng. Chỉ nhận phân trang, cơ sở và kỳ lưu trú — khoá lạ bị từ chối ở BFF thay vì
 * chuyển tiếp mù sang API (cùng nguyên tắc `bookings/query.ts`).
 */
export const publicPlanQuery = propertyCatalogueQuery.extend({
  propertyId: roomTypeSummarySchema.shape.propertyId.optional(),
  checkIn: businessDateSchema.optional(),
  checkOut: businessDateSchema.optional(),
});
