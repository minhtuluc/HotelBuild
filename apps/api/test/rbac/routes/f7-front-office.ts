import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/** F7 — tiền sảnh: no-show và xem trước. */
export function f7FrontOffice(keyed: Oracle): void {
  // HB-147 / api.md §2.9, §6.3: no-show thủ công là tuyến **FRONT_DESK**; thân oracle không hợp lệ ⇒ 400
  // sau khi qua quyền. Một dòng để giữ file dưới trần 400 dòng của ESLint (`max-lines`).
  // prettier-ignore
  keyed[`${RequestMethod.POST}:front-office/no-show`] = { roles: ['FRONT_DESK'], status: 400, method: RequestMethod.POST };
  // HB-209 / api.md §2.9: xem trước no-show dùng đúng quyền của lệnh ghi; thân oracle hỏng ⇒ 400.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:front-office/no-show/preview`] = { roles: ['FRONT_DESK'], status: 400, method: RequestMethod.POST };
}
