import { createJourneyHandler } from '@pinehill/web-session/server';
import {
  rateCalendarOverrideRequestSchema,
  rateCalendarQuerySchema,
  rateCalendarSchema,
} from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../../config/session';
import { decodedId } from '../../../route-id';
export const dynamic = 'force-dynamic';
async function handler(request: Request): Promise<Response> {
  // Máy chủ báo lỗi từng dòng theo `items[i].date`/`items[i].price` (HB-054), nên allowlist phải
  // mở rộng theo chỉ số của thân lệnh đã qua kiểm — cùng cách channel-allotments làm với ngày.
  const fields = ['items', 'channelCode', 'priority', 'reason', 'confirmOwnerOverride'];
  const body = {
    parse(value: unknown) {
      const parsed = rateCalendarOverrideRequestSchema.parse(value);
      for (const [index] of parsed.items.entries())
        fields.push(`items[${index}].date`, `items[${index}].price`);
      return parsed;
    },
  };
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: fields,
    routeResolver: (req) => {
      const raw = /^\/api\/session\/sys\/room-types\/([^/]+)\/rate-calendar$/.exec(
        new URL(req.url).pathname,
      )?.[1];
      const id = raw === undefined ? undefined : decodedId(raw);
      if (id === undefined) return undefined;
      const path = '/room-types/' + encodeURIComponent(id) + '/rate-calendar';
      if (req.method === 'GET')
        return {
          method: 'GET',
          path,
          protected: true,
          decoder: rateCalendarSchema,
          query: (input) => rateCalendarQuerySchema.parse(input),
        };
      if (req.method === 'PUT')
        return { method: 'PUT', path, protected: true, decoder: rateCalendarSchema, body };
      return undefined;
    },
  })(request);
}
export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
export async function PUT(request: Request): Promise<Response> {
  return handler(request);
}
