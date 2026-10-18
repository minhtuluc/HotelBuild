import { createJourneyHandler } from '@pinehill/web-session/server';
import { listResponseSchema, ratePlanPublicSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../config/session';
import { publicPlanQuery } from './query';

/**
 * `GET /rate-plans` qua phiên nhân viên (HB-201) — màn SCR-33/34 (tạo booking) đọc gói giá công khai
 * ở bước chọn phòng. Chỉ chuyển tiếp: bản công khai không lộ cấu hình nội bộ (BR-RATE ẩn cấu hình),
 * và không có logic nghiệp vụ nào được thêm ở BFF (HB-201 AC2).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' && new URL(req.url).pathname === '/api/session/sys/rate-plans'
        ? {
            method: 'GET',
            path: '/rate-plans',
            protected: true,
            decoder: listResponseSchema(ratePlanPublicSchema),
            query: (input) => publicPlanQuery.parse(input),
          }
        : undefined,
  })(request);
}
