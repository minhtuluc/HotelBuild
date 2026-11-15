/**
 * `GET /public/properties` qua BFF hành trình (HB-079): mã, tên, giờ nhận/trả của các cơ sở. Không gọi
 * tuyến nhân viên. Dùng chung cho khối tìm phòng (SCR-01) và bảng giờ ở trang ga (HB-310).
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import { listResponseSchema, propertyPublicSummarySchema } from '@pinehill/contracts';
import type { PropertyPublicSummary } from '@pinehill/contracts';

export async function fetchPublicProperties(
  baseUrl: string,
): Promise<readonly PropertyPublicSummary[]> {
  const client = createJourneyApiClient({
    baseUrl,
    session: { getAccessToken: () => null, onUnauthorized: async () => false },
  });
  const page = await client.request({
    method: 'GET',
    path: '/public/properties',
    decoder: listResponseSchema(propertyPublicSummarySchema),
  });
  return page.data.data;
}

/**
 * Cơ sở mặc định trên vé: `propertyId` của ngữ cảnh hành trình nếu có trong danh sách (HB-317), rồi cơ sở
 * có `slug` khớp trang ga (`?ga=`, HB-311), không có thì cơ sở đầu. Id ngoài danh sách bị bỏ qua.
 */
export function initialPropertyId(
  properties: readonly PropertyPublicSummary[],
  preferredSlug: string | undefined,
  preferredId?: string,
): string {
  const byId =
    preferredId === undefined ? undefined : properties.find((item) => item.id === preferredId);
  const preferred =
    byId ??
    (preferredSlug === undefined
      ? undefined
      : properties.find((property) => property.slug === preferredSlug));
  return (preferred ?? properties[0])?.id ?? '';
}
