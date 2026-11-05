/**
 * Cổng I/O của SCR-47: đọc cơ sở/hồ sơ hoàn tiền và gửi lệnh lập/duyệt/từ chối qua BFF `/api/session/sys/**`.
 * Lệnh ghi đi thẳng `client.request` vì `createRefundApi` sinh khoá mới mỗi lần gọi (không truyền được
 * `Idempotency-Key` của lần trước, trái api.md §1.6). PIN đi qua `pin` (RAM) cho lệnh `pinProtected`.
 */
import { createAuthApi, type ApiClient } from '@pinehill/api-client';
import {
  listResponseSchema,
  propertySummarySchema,
  refundApproveRequestSchema,
  refundDecisionSchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  refundRequestSchema,
  userMeSchema,
  type ListPage,
  type PropertySummary,
  type RefundRequest,
  type UserMe,
} from '@pinehill/contracts';
import { completeCatalogue } from '../../app/(ops)/admin-commands/catalogue';
import type { Filter, Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

/** Hộp chứa mã PIN một lần, chỉ trong RAM; `ApiClient` đọc qua `getPinToken`. */
export interface PinBox {
  current: string | null;
}

export interface ExceptionPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  properties(signal: AbortSignal): Promise<PropertySummary[]>;
  list(
    filter: Filter,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<ListPage<RefundRequest>>;
  send(intent: Intent): Promise<void>;
  verifyPin(pin: string, bookingId: string): Promise<void>;
  clearPin(): void;
}

const PAGE = 20;
const enc = encodeURIComponent;

export function listQuery(filter: Filter, cursor: string | undefined) {
  return {
    limit: PAGE,
    ...(cursor === undefined ? {} : { cursor }),
    ...(filter.propertyId === '' ? {} : { propertyId: filter.propertyId }),
    ...(filter.status === null ? {} : { status: filter.status }),
    ...(filter.bookingId.trim() === '' ? {} : { bookingId: filter.bookingId.trim() }),
  };
}

export function createPorts(client: ApiClient, pin: PinBox): ExceptionPorts {
  const auth = createAuthApi(client);
  const post = (path: string, intent: Intent, body: unknown, pinProtected: boolean) =>
    client.request({
      method: 'POST',
      path,
      body,
      idempotencyKey: intent.key,
      ...(pinProtected ? { pinProtected: true } : {}),
      decoder: refundDecisionOrRequest,
    });
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    properties: (signal) =>
      completeCatalogue(client, '/properties', listResponseSchema(propertySummarySchema), signal),
    list: async (filter, cursor, signal) =>
      (
        await client.request({
          method: 'GET',
          path: '/refund-requests',
          query: listQuery(filter, cursor),
          decoder: listResponseSchema(refundRequestSchema),
          signal,
          maxAttempts: 1,
        })
      ).data,
    send: async (intent) => {
      if (intent.kind === 'create') {
        await post(
          '/refund-requests',
          intent,
          refundRequestCreateRequestSchema.parse(intent.body),
          false,
        );
      } else if (intent.kind === 'approve') {
        await post(
          `/refund-requests/${enc(intent.target)}/approve`,
          intent,
          refundApproveRequestSchema.parse(intent.body),
          true,
        );
      } else {
        await post(
          `/refund-requests/${enc(intent.target)}/reject`,
          intent,
          refundRejectRequestSchema.parse(intent.body),
          true,
        );
      }
    },
    verifyPin: async (code, bookingId) => {
      pin.current = (await auth.pinVerify(code, bookingId)).data.pinToken;
    },
    clearPin: () => {
      pin.current = null;
    },
  };
}

/** Phản hồi của ba lệnh có hai hình (hồ sơ hoặc quyết định); kết quả hiển thị luôn lấy từ lần đọc lại. */
const refundDecisionOrRequest = {
  parse: (value: unknown): unknown =>
    refundDecisionSchema.safeParse(value).success ? value : refundRequestSchema.parse(value),
};
