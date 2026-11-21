/** Cổng gọi API của SCR-68 (HB-263): đọc tổng theo người thu, chốt quỹ có PIN + khoá chống trùng. */
import { createAuthApi, createFrontOfficeApi } from '@pinehill/api-client';
import {
  reconciliationCloseRequestSchema,
  reconciliationCloseResponseSchema,
} from '@pinehill/contracts';
import type { ReconciliationCloseResponse, ReconciliationDaily } from '@pinehill/contracts';
import type { Session } from '../session';
import type { PinnedPorts } from '../stay/writer';
import { closeMatches, type CloseBody } from './model';

export function loadDaily(
  session: Session,
  propertyId: string,
  businessDate: string,
): Promise<ReconciliationDaily> {
  return createFrontOfficeApi(session.resourceClient())
    .dailyReconciliation({ propertyId, businessDate })
    .then((response) => response.data);
}

export function closePorts(
  session: Session,
  shared: Pick<PinnedPorts<CloseBody, ReconciliationCloseResponse>, 'online' | 'createId'>,
): PinnedPorts<CloseBody, ReconciliationCloseResponse> {
  return {
    ...shared,
    // PIN thao tác tiền không gắn booking (`purpose = FINANCIAL`, `bookingId = null`).
    verifyPin: async (pin) =>
      (await createAuthApi(session.resourceClient()).pinVerify(pin)).data.pinToken,
    send: async (body, pinToken, idempotencyKey) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: '/reconciliation/daily/close',
          body: reconciliationCloseRequestSchema.parse({ ...body, pinToken }),
          idempotencyKey,
          decoder: reconciliationCloseResponseSchema,
        })
      ).data,
    matches: closeMatches,
  };
}
