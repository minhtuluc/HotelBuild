/**
 * HB-278 — tên cơ sở đang làm việc cho thanh ngữ cảnh. `/auth/me` chỉ trả id; tên lấy từ danh sách công khai
 * `GET /public/properties`. Tạo client ở từng lần gọi để dùng token hiện tại (HB-264).
 */
import { listResponseSchema, propertyPublicSummarySchema } from '@pinehill/contracts';
import type { Session } from './session';

export function workingPropertyName(session: Session): () => Promise<string | null> {
  return async () => {
    const id = session.selectedProperty();
    if (id === null) return null;
    const response = await session.resourceClient().request({
      method: 'GET',
      path: '/public/properties',
      decoder: listResponseSchema(propertyPublicSummarySchema),
    });
    return response.data.data.find((property) => property.id === id)?.name ?? null;
  };
}
