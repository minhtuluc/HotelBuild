/**
 * Cổng I/O của SCR-44: đọc ca/phương án/điều chuyển và gửi lệnh qua BFF `/api/session/sys/**` bằng client
 * HB-120 (`createOverbookingApi` đã nhận `idempotencyKey` + `etag`). PIN đi qua `pin` (bộ nhớ, chỉ RAM)
 * để `ApiClient` gắn cho lệnh `pinProtected`; không ghi vào state hay log.
 */
import { createAuthApi, createOverbookingApi, type ApiClient } from '@pinehill/api-client';
import {
  userMeSchema,
  type BookingRelocationOptions,
  type OverbookingCaseDetail,
  type RelocationPlan,
  type RoomMove,
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

export type PlanIntent = Extract<Intent, { kind: 'plan' }>;
export type CreateIntent = Extract<Intent, { kind: 'create' }>;
export type ApproveIntent = Extract<Intent, { kind: 'approve' }>;
export type ExecuteIntent = Extract<Intent, { kind: 'execute' }>;

export interface RelocationPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  caseDetail(caseId: string): Promise<{ detail: OverbookingCaseDetail; etag: string | undefined }>;
  options(
    bookingId: string,
    caseId: string,
    idempotencyKey?: string,
  ): Promise<BookingRelocationOptions>;
  move(
    moveId: string,
    idempotencyKey?: string,
  ): Promise<{ view: RoomMoveView; etag: string | undefined }>;
  plan(intent: PlanIntent): Promise<RelocationPlan>;
  create(intent: CreateIntent): Promise<RoomMove>;
  approve(intent: ApproveIntent): Promise<RoomMove>;
  execute(intent: ExecuteIntent): Promise<RoomMove>;
  verifyPin(pin: string, bookingId: string): Promise<void>;
  clearPin(): void;
}

export function createPorts(client: ApiClient, pin: PinBox): RelocationPorts {
  const api = createOverbookingApi(client);
  const auth = createAuthApi(client);
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    caseDetail: async (caseId) => {
      const response = await api.getCase(caseId, { includeCandidates: true });
      return { detail: response.data, etag: response.etag };
    },
    options: async (bookingId, caseId, idempotencyKey) =>
      (
        await api.relocationOptions(bookingId, {
          overbookingCaseId: caseId,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        })
      ).data,
    move: async (moveId, idempotencyKey) => {
      const response = await api.getMove(
        moveId,
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      );
      return { view: response.data, etag: response.etag };
    },
    plan: async (intent) =>
      (
        await api.planRelocation(intent.caseId, intent.body, {
          etag: intent.ifMatch,
          idempotencyKey: intent.key,
        })
      ).data,
    create: async (intent) =>
      (await api.createMove(intent.body, { idempotencyKey: intent.key })).data,
    approve: async (intent) =>
      (
        await api.approveMove(intent.moveId, intent.body, {
          etag: intent.ifMatch,
          idempotencyKey: intent.key,
        })
      ).data,
    execute: async (intent) =>
      (await api.executeMove(intent.moveId, { etag: intent.ifMatch, idempotencyKey: intent.key }))
        .data,
    verifyPin: async (code, bookingId) => {
      pin.current = (await auth.pinVerify(code, bookingId)).data.pinToken;
    },
    clearPin: () => {
      pin.current = null;
    },
  };
}
