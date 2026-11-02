import { RequestMethod } from '@nestjs/common';
import { readMissing, type Oracle } from './types.js';

/** F6 OVER — đường đọc ca quá tải và cảnh báo lễ tân (HB-126, HB-120 AC12). */
export function f6OverDetection(keyed: Oracle): void {
  // api.md §3.9: danh sách ca chỉ MANAGER/OWNER, lọc/scope phía server. Không có ca trong scope ⇒ 200.
  keyed[`${RequestMethod.GET}:overbooking-cases`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  // Id giả hợp lệ nhưng không tồn tại ⇒ 404 trước khi chạm dữ liệu.
  keyed[`${RequestMethod.GET}:overbooking-cases/:id`] = readMissing(['MANAGER', 'OWNER']);
  // `GET /overbooking-alerts` là projection tối giản, chỉ FRONT_DESK có scope.
  keyed[`${RequestMethod.GET}:overbooking-alerts`] = {
    roles: ['FRONT_DESK'],
    status: 200,
    method: RequestMethod.GET,
  };
}
