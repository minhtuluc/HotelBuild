/**
 * Chính sách kênh của báo giá (api.md §1.4, §6.3): giá OTA/đại lý không được mở cho người dùng
 * thường, kênh quầy/điện thoại chỉ dành cho phiên nhân viên.
 *
 * | Chủ thể | `WEB` | `PHONE`/`WALKIN` | `AGENCY`/`OTA_*` |
 * |---|---|---|---|
 * | Ẩn danh (khách công khai) | ✔ | ✘ | ✘ |
 * | `GUEST` (phiên khách) | ✔ | ✘ | ✘ |
 * | `USER` (phiên nhân viên) | ✔ | ✔ | ✘ |
 * | `SYSTEM` (adapter/worker đã xác thực) | ✔ | ✔ | ✔ |
 *
 * Cột OTA chỉ mở cho **danh tính adapter** (`SYSTEM`, cấp bằng chữ ký HMAC ở `/integrations/**`, không
 * phải bearer): HB-074 chưa có đường phát hành danh tính đó nên mọi bearer hiện bị từ chối — từ chối
 * tường minh (403) thay vì trả giá OTA cho người dùng thường.
 */
import type { ChannelCode } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { Principal } from '../../../common/idempotency/request.js';

const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được báo giá theo kênh này.');

export function assertQuoteChannel(
  channelCode: ChannelCode,
  principal: Pick<Principal, 'type'>,
): void {
  if (channelCode === 'WEB' || principal.type === 'SYSTEM') return;
  if (principal.type === 'USER' && (channelCode === 'PHONE' || channelCode === 'WALKIN')) return;
  throw forbidden();
}
