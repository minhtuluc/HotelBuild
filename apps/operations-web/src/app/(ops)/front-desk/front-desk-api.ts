/**
 * Đọc/ghi SCR-48 qua `@pinehill/api-client` và `@pinehill/contracts`.
 *
 * `GET /bookings` chỉ có bộ lọc ngày đến (`from`/`to`, xem F5 README); vì vậy danh sách đang ở/đi hôm nay
 * lấy bằng `status=CHECKED_IN` rồi chia theo `checkOut` ở `front-desk-model.ts`. Không có endpoint
 * bảng tiền sảnh riêng; không tự tính công nợ hay phụ thu.
 */
import {
  ApiError,
  createAuthApi,
  createBookingApi,
  createFrontOfficeApi,
  createPropertyApi,
  type ApiClient,
  type ApiResponse,
} from '@pinehill/api-client';
import {
  listResponseSchema,
  roomSummarySchema,
  roomTypeSummarySchema,
  walkInRequestSchema,
  walkInResultSchema,
  type CheckInRequest,
  type CheckInResponse,
  type CheckOutRequest,
  type CheckOutResponse,
  type ListPage,
  type NoShowRequest,
  type NoShowResponse,
  paymentCreateRequestSchema,
  paymentSchema,
  type Payment,
  type PaymentCreateRequest,
  type PinToken,
  type RoomSummary,
  type RoomTypeSummary,
  type WalkInRequest,
  type WalkInResult,
} from '@pinehill/contracts';
import { splitDesk, type DeskLists } from './front-desk-model';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export interface DeskProperty {
  readonly id: string;
  readonly name: string;
}

export interface DeskLoad extends DeskLists {
  readonly propertyId: string;
  readonly properties: readonly DeskProperty[];
  readonly roomTypes: readonly RoomTypeSummary[];
  readonly rooms: readonly RoomSummary[];
  /** Mốc trình duyệt nhận phản hồi thành công — nhãn "cập nhật lúc", không phải thời gian nghiệp vụ. */
  readonly capturedAt: string;
  /** Máy chủ còn trang sau giới hạn đọc của màn hình. */
  readonly truncated: boolean;
}

async function collectPages<T>(
  load: (cursor: string | undefined) => Promise<ApiResponse<ListPage<T>>>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const loaded = (await load(cursor)).data;
    rows.push(...loaded.data);
    cursor = loaded.meta.hasMore ? (loaded.meta.nextCursor ?? undefined) : undefined;
    if (cursor === undefined) return { rows, truncated: loaded.meta.hasMore };
  }
  return { rows, truncated: true };
}

export interface DeskApi {
  load(propertyId: string, date: string): Promise<DeskLoad>;
  checkIn(input: CheckInRequest): Promise<ApiResponse<CheckInResponse>>;
  checkOut(input: CheckOutRequest): Promise<ApiResponse<CheckOutResponse>>;
  noShow(input: NoShowRequest): Promise<ApiResponse<NoShowResponse>>;
  pinVerify(pin: string, bookingId: string): Promise<ApiResponse<PinToken>>;
  /** 🔒 Thu cọc; `idempotencyKey` giữ nguyên khi thử lại để không ghi hai khoản (api.md §1.3). */
  createPayment(
    input: PaymentCreateRequest,
    idempotencyKey?: string,
  ): Promise<ApiResponse<Payment>>;
  /** `idempotencyKey` giữ nguyên khi thử lại để máy chủ phát lại booking thay vì tạo mới. */
  walkIn(input: WalkInRequest, idempotencyKey?: string): Promise<ApiResponse<WalkInResult>>;
}

export function createDeskApi(client: ApiClient): DeskApi {
  const properties = createPropertyApi(client);
  const bookings = createBookingApi(client);
  const frontOffice = createFrontOfficeApi(client);
  const auth = createAuthApi(client);
  return {
    async load(propertyId, date): Promise<DeskLoad> {
      const propertyPage = await properties.list();
      if (propertyPage.data.meta.hasMore) throw new Error('Incomplete property projection');
      const available = propertyPage.data.data.map(({ id, name }) => ({ id, name }));
      const selected = propertyId === '' ? (available[0]?.id ?? '') : propertyId;
      if (selected === '')
        return {
          propertyId: '',
          properties: available,
          roomTypes: [],
          rooms: [],
          arrivals: [],
          inHouse: [],
          departures: [],
          capturedAt: new Date().toISOString(),
          truncated: false,
        };
      if (!available.some((property) => property.id === selected))
        throw new ApiError({
          kind: 'http',
          status: 403,
          code: 'E_AUTH_OUT_OF_SCOPE',
          message: 'Cơ sở ngoài phạm vi',
        });
      const [types, rooms, arrivals, checkedIn] = await Promise.all([
        collectPages((cursor) =>
          client.request({
            method: 'GET',
            path: '/room-types',
            query: {
              propertyId: selected,
              limit: PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
            decoder: listResponseSchema(roomTypeSummarySchema),
          }),
        ),
        collectPages((cursor) =>
          client.request({
            method: 'GET',
            path: '/rooms',
            query: {
              propertyId: selected,
              status: 'ACTIVE',
              limit: PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
            decoder: listResponseSchema(roomSummarySchema),
          }),
        ),
        collectPages((cursor) =>
          bookings.list({
            propertyId: selected,
            from: date,
            to: date,
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
        collectPages((cursor) =>
          bookings.list({
            propertyId: selected,
            status: 'CHECKED_IN',
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      ]);
      return {
        propertyId: selected,
        properties: available,
        roomTypes: types.rows,
        rooms: rooms.rows,
        ...splitDesk(arrivals.rows, checkedIn.rows, date),
        capturedAt: new Date().toISOString(),
        truncated: arrivals.truncated || checkedIn.truncated || types.truncated || rooms.truncated,
      };
    },
    checkIn: (input) => frontOffice.checkIn(input),
    checkOut: (input) => frontOffice.checkOut(input),
    noShow: (input) => frontOffice.noShow(input),
    pinVerify: (pin, bookingId) => auth.pinVerify(pin, bookingId),
    createPayment: (input, idempotencyKey) =>
      client.request({
        method: 'POST',
        path: '/payments',
        body: paymentCreateRequestSchema.parse(input),
        pinProtected: true,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        decoder: paymentSchema,
      }),
    walkIn: (input, idempotencyKey) =>
      client.request({
        method: 'POST',
        path: '/walk-in',
        body: walkInRequestSchema.parse(input),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        decoder: walkInResultSchema,
      }),
  };
}
