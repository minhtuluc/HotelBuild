import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/** F6 — điều chuyển/ghép phòng/bồi thường (api.md §3.10, §6.3; HB-120/HB-125, F6-D04/D06). */
export function f6Over(keyed: Oracle): void {
  // Lập phương án/đóng ca: tuyến tiền sảnh; thân oracle rỗng ⇒ 400 sau khi qua quyền.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:overbooking-cases/:id/relocation-plan`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:overbooking-cases/:id/resolve`] = { roles: ['MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };

  // Điều chuyển: tạo/thực thi ở quầy, duyệt chi phí ở MANAGER+.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-moves`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.GET}:room-moves/:id`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.GET };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-moves/:id/approve`] = { roles: ['MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-moves/:id/execute`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.POST };

  // F6-D06: chỉ ACCOUNTANT chi bồi thường; MANAGER/OWNER chỉ đọc trạng thái/chứng từ.
  // prettier-ignore
  keyed[`${RequestMethod.GET}:room-moves/:id/compensation-payments`] = { roles: ['ACCOUNTANT', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.GET };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-moves/:id/compensation-payments`] = { roles: ['ACCOUNTANT'], status: 400, method: RequestMethod.POST };

  // Ghép phòng: consent ở quầy; duyệt ngoại lệ khác giới ở MANAGER+.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-merges`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.GET}:room-merges/:id`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.GET };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-merges/:id/consent`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-merges/:id/approve`] = { roles: ['MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // prettier-ignore
  keyed[`${RequestMethod.POST}:room-merges/:id/execute`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.POST };

  // Phương án cho chính booking đang tra (AC14).
  // prettier-ignore
  keyed[`${RequestMethod.GET}:bookings/:id/relocation-options`] = { roles: ['FRONT_DESK', 'MANAGER', 'OWNER'], status: 404, method: RequestMethod.GET };
}
