/**
 * Cổng I/O của SCR-45/46: đọc ghép/điều chuyển/khoản chi bồi thường và gửi lệnh qua BFF
 * `/api/session/sys/**` bằng client HB-120 (`createOverbookingApi` đã nhận `idempotencyKey` + `etag`).
 * PIN đi qua `pin` (bộ nhớ, chỉ RAM) để `ApiClient` gắn cho lệnh `pinProtected`.
 */
import { createAuthApi, createOverbookingApi, type ApiClient } from '@pinehill/api-client';
import {
  compensationPaymentCreateRequestSchema,
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
  roomMoveApproveRequestSchema,
  userMeSchema,
  type CompensationPaymentsView,
  type RoomMergeView,
  type RoomMoveView,
  type UserMe,
} from '@pinehill/contracts';
import type { Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

/** Hộp chứa mã PIN một lần, chỉ trong RAM; `ApiClient` đọc qua `getPinToken`. */
export interface PinBox {
  current: string | null;
}

export interface Loaded<T> {
  view: T;
  etag: string | undefined;
}

export interface WalkOutPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  merge(id: string, idempotencyKey?: string): Promise<Loaded<RoomMergeView>>;
  move(id: string, idempotencyKey?: string): Promise<Loaded<RoomMoveView>>;
  compensations(moveId: string): Promise<CompensationPaymentsView>;
  /** Gửi một ý định; trả `mergeId` khi vừa lập ghép để màn hình mở đúng hồ sơ. */
  send(intent: Intent): Promise<{ mergeId?: string }>;
  verifyPin(pin: string, bookingId: string): Promise<void>;
  clearPin(): void;
}

export function createPorts(client: ApiClient, pin: PinBox): WalkOutPorts {
  const api = createOverbookingApi(client);
  const auth = createAuthApi(client);
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    merge: async (id, key) => {
      const response = await api.getMerge(
        id,
        key === undefined ? undefined : { idempotencyKey: key },
      );
      return { view: response.data, etag: response.etag };
    },
    move: async (id, key) => {
      const response = await api.getMove(
        id,
        key === undefined ? undefined : { idempotencyKey: key },
      );
      return { view: response.data, etag: response.etag };
    },
    compensations: async (moveId) => (await api.listCompensations(moveId)).data,
    send: async (intent) => {
      const options = { etag: intent.ifMatch ?? '', idempotencyKey: intent.key };
      switch (intent.kind) {
        case 'mergeCreate': {
          const merge = (
            await api.createMerge(roomMergeRequestSchema.parse(intent.body), {
              idempotencyKey: intent.key,
            })
          ).data;
          return { mergeId: merge.id };
        }
        case 'mergeConsent':
          await api.recordMergeConsent(
            intent.target,
            roomMergeConsentRequestSchema.parse(intent.body),
            options,
          );
          return {};
        case 'mergeApprove':
          await api.approveMerge(
            intent.target,
            roomMergeApproveRequestSchema.parse(intent.body),
            options,
          );
          return {};
        case 'mergeExecute':
          await api.executeMerge(intent.target, options);
          return {};
        case 'moveApprove':
          await api.approveMove(
            intent.target,
            roomMoveApproveRequestSchema.parse(intent.body),
            options,
          );
          return {};
        case 'moveExecute':
          await api.executeMove(intent.target, options);
          return {};
        case 'compensate':
          await api.createCompensation(
            intent.target,
            compensationPaymentCreateRequestSchema.parse(intent.body),
            options,
          );
          return {};
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
