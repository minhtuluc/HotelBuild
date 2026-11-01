import { RequestMethod } from '@nestjs/common';
import { readMissing, type Oracle } from './types.js';

/** F5 — hoàn tiền, đối soát ngày, xuất báo cáo và thao tác nền. */
export function f5Pay(keyed: Oracle): void {
  // HB-163: xuất báo cáo trả 202; theo dõi/tải thao tác kiểm quyền người tạo trong service.
  keyed[`${RequestMethod.POST}:reports/export`] = {
    roles: ['ACCOUNTANT', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.GET}:operations/:operationId`] = readMissing(['ACCOUNTANT', 'OWNER']);
  keyed[`${RequestMethod.GET}:operations/:operationId/download`] = readMissing([
    'ACCOUNTANT',
    'OWNER',
  ]);
  // HB-099 / api.md §3.6-3.7 + §6.3: hoàn tiền — lập cho quầy/điều phối, quyết định cho MANAGER+,
  // rút cho người tạo/MANAGER+. Thân oracle không hợp lệ → 400 trước khi tra tài nguyên.
  keyed[`${RequestMethod.POST}:refund-requests`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  for (const action of ['approve', 'reject']) {
    keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/${action}`] = {
      roles: ['MANAGER', 'OWNER'],
      status: 400,
      method: RequestMethod.POST,
    };
  }
  keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/cancel`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-100 / api.md §2.6, §6.1: chi hoàn là tuyến **ACCOUNTANT**, đúng cơ sở, chỉ hồ sơ APPROVED;
  // thân oracle thiếu `method` ⇒ 400 trước khi chạm tài nguyên.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/pay`] = { roles: ['ACCOUNTANT'], status: 400, method: RequestMethod.POST };
  // HB-215 / api.md §2.6, §6.1: xác nhận chuyển khoản tay cũng là tuyến **ACCOUNTANT**, đúng cơ sở;
  // thân oracle thiếu `bankReference` ⇒ 400 sau khi qua quyền, trước khi chạm tài nguyên.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/confirm-transfer`] = { roles: ['ACCOUNTANT'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:reconciliation/daily/close`] = { roles: ['ACCOUNTANT'], status: 400, method: RequestMethod.POST };
  // HB-213 / api.md §2.6, §6.3: danh sách hồ sơ hoàn cho quầy/điều phối/MANAGER/OWNER + ACCOUNTANT đối soát.
  // prettier-ignore
  keyed[`${RequestMethod.GET}:refund-requests`] = { roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'], status: 200, method: RequestMethod.GET };
}
