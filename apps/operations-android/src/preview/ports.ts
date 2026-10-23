/** Nối số xem trước SCR-61/SCR-64 với hai tuyến máy chủ (HB-209) qua `@pinehill/api-client`; không thêm endpoint. */
import { createFrontOfficeApi } from '@pinehill/api-client';
import type { CheckOutPreview, CheckOutPreviewRequest, NoShowPreview } from '@pinehill/contracts';
import type { Session } from '../session';

/** Client ghim token/phiên hiện tại, một lần gửi; mất mạng ⇒ lỗi mạng trước khi gửi (không xếp hàng). */
export function noShowPreviewPort(session: Session): (bookingId: string) => Promise<NoShowPreview> {
  return async (bookingId) =>
    (await createFrontOfficeApi(session.resourceClient()).noShowPreview({ bookingId })).data;
}

export function checkOutPreviewPort(
  session: Session,
): (request: CheckOutPreviewRequest) => Promise<CheckOutPreview> {
  return async (request) =>
    (await createFrontOfficeApi(session.resourceClient()).checkOutPreview(request)).data;
}
