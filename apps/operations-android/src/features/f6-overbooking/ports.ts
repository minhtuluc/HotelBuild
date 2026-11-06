/** Nối SCR-63/67 với tuyến đã phát hành (HB-120) qua client ghim phiên hiện tại; không thêm endpoint. */
import { createAuthApi, createOverbookingApi } from '@pinehill/api-client';
import {
  roomMoveApproveRequestSchema,
  roomMoveExecuteRequestSchema,
  roomMoveSchema,
  type BookingRelocationOptions,
  type OverbookingCaseDetail,
  type OverbookingCaseList,
  type OverbookingAlertsView,
  type RoomMove,
  type RoomMoveApproveRequest,
  type RoomMoveCreateRequest,
  type RoomMoveView,
} from '@pinehill/contracts';
import type { Session } from '../../session';

export interface Loaded<T> {
  readonly view: T;
  readonly etag: string | undefined;
}

export interface F6Ports {
  now(): Date;
  online(): Promise<boolean>;
  createId(): string;
  cases(propertyId: string | undefined): Promise<OverbookingCaseList>;
  alerts(propertyId: string | undefined): Promise<OverbookingAlertsView>;
  caseDetail(caseId: string): Promise<Loaded<OverbookingCaseDetail>>;
  options(bookingId: string, caseId: string, key?: string): Promise<BookingRelocationOptions>;
  move(moveId: string, key?: string): Promise<Loaded<RoomMoveView>>;
  create(body: RoomMoveCreateRequest, key: string): Promise<RoomMove>;
  approve(
    moveId: string,
    body: RoomMoveApproveRequest,
    pinToken: string,
    etag: string,
    key: string,
  ): Promise<RoomMove>;
  execute(moveId: string, pinToken: string, etag: string, key: string): Promise<RoomMove>;
  verifyPin(pin: string, bookingId: string): Promise<string>;
}

type Shared = Pick<F6Ports, 'online' | 'createId'>;

/**
 * Mọi lệnh dùng client ghim token/phiên hiện tại và đúng một lần gửi; `pinToken` nằm trong thân theo hợp đồng.
 * `pin/verify` cũng đi qua client một lần (client dùng chung sẽ refresh-và-phát-lại 401 của PIN sai và đếm
 * hai lần vào ngưỡng khoá).
 */
export function f6Ports(session: Session, shared: Shared): F6Ports {
  const api = () => createOverbookingApi(session.resourceClient());
  return {
    ...shared,
    now: () => new Date(),
    cases: async (propertyId) =>
      (await api().listCases({ limit: 50, ...(propertyId === undefined ? {} : { propertyId }) }))
        .data,
    alerts: async (propertyId) =>
      (await api().alerts({ limit: 50, ...(propertyId === undefined ? {} : { propertyId }) })).data,
    caseDetail: async (caseId) => {
      const response = await api().getCase(caseId, { includeCandidates: true });
      return { view: response.data, etag: response.etag };
    },
    options: async (bookingId, caseId, key) =>
      (
        await api().relocationOptions(bookingId, {
          overbookingCaseId: caseId,
          ...(key === undefined ? {} : { idempotencyKey: key }),
        })
      ).data,
    move: async (moveId, key) => {
      const response = await api().getMove(
        moveId,
        key === undefined ? undefined : { idempotencyKey: key },
      );
      return { view: response.data, etag: response.etag };
    },
    create: async (body, key) => (await api().createMove(body, { idempotencyKey: key })).data,
    approve: async (moveId, body, pinToken, etag, key) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: `/room-moves/${encodeURIComponent(moveId)}/approve`,
          body: roomMoveApproveRequestSchema.parse({ ...body, pinToken }),
          ifMatch: etag,
          idempotencyKey: key,
          decoder: roomMoveSchema,
        })
      ).data,
    execute: async (moveId, pinToken, etag, key) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: `/room-moves/${encodeURIComponent(moveId)}/execute`,
          body: roomMoveExecuteRequestSchema.parse({ pinToken }),
          ifMatch: etag,
          idempotencyKey: key,
          decoder: roomMoveSchema,
        })
      ).data,
    verifyPin: async (pin, bookingId) =>
      (await createAuthApi(session.resourceClient()).pinVerify(pin, bookingId)).data.pinToken,
  };
}
