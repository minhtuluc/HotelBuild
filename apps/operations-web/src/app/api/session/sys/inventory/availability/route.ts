import { createJourneyHandler } from '@pinehill/web-session/server';
import { availabilityQuerySchema, availabilitySchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';

/**
 * `GET /inventory/availability` qua phiên nhân viên (HB-201) — màn SCR-33/34 (tạo booking) tìm phòng
 * trống ở bước chọn phòng. Chỉ chuyển tiếp: hợp đồng truy vấn do `availabilityQuerySchema` chốt, còn
 * phòng/khoá chỗ do máy chủ quyết (BR-INV-07) nên không thêm kiểm tra nghiệp vụ ở BFF.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    routeResolver: (req) =>
      req.method === 'GET' &&
      new URL(req.url).pathname === '/api/session/sys/inventory/availability'
        ? {
            method: 'GET',
            path: '/inventory/availability',
            protected: true,
            decoder: availabilitySchema,
            query: (input) => availabilityQuerySchema.parse(input),
          }
        : undefined,
  })(request);
}
