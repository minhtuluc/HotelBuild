/**
 * HB-244 — ảnh công khai của cơ sở và loại phòng. `replace` thay **cả** danh sách: gửi `ifMatch` = `etag`
 * vừa đọc từ `list`; danh sách đã đổi ⇒ 412, thiếu ⇒ 428. `publicRoomType` không cần đăng nhập.
 */
import {
  photoListSchema,
  photoReplaceRequestSchema,
  roomTypePublicSchema,
  type PhotoList,
  type PhotoReplaceRequest,
  type RoomTypePublic,
} from '@pinehill/contracts';
import type { ApiClient, ApiResponse } from './client.js';

export type PhotoOwner = 'properties' | 'room-types';

export interface PhotoApi {
  list(owner: PhotoOwner, id: string): Promise<ApiResponse<PhotoList>>;
  replace(
    owner: PhotoOwner,
    id: string,
    input: PhotoReplaceRequest,
    ifMatch: string,
  ): Promise<ApiResponse<undefined>>;
  publicRoomType(roomTypeId: string): Promise<ApiResponse<RoomTypePublic>>;
}

export function createPhotoApi(client: ApiClient): PhotoApi {
  const path = (owner: PhotoOwner, id: string) => `/${owner}/${encodeURIComponent(id)}/photos`;
  return {
    list: (owner, id) =>
      client.request({ method: 'GET', path: path(owner, id), decoder: photoListSchema }),
    replace: (owner, id, input, ifMatch) =>
      client.requestVoid({
        method: 'PUT',
        path: path(owner, id),
        body: photoReplaceRequestSchema.parse(input),
        ifMatch,
      }),
    publicRoomType: (roomTypeId) =>
      client.request({
        method: 'GET',
        path: `/public/room-types/${encodeURIComponent(roomTypeId)}`,
        decoder: roomTypePublicSchema,
      }),
  };
}
