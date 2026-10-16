import type { Prisma } from '@prisma/client';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';

/**
 * BR-CRM-05 + NFR-COMP-01/02 — **danh mục ẩn danh hoá**. Hồ sơ khách không bao giờ bị xoá cứng: các cột
 * định danh cá nhân được thay bằng hằng số ẩn danh, `anonymized_at` giữ mốc thời điểm, còn booking và
 * thanh toán giữ nguyên để đối soát (TC-CRM-05).
 *
 * Mọi hằng số ở đây là văn bản cố định **không suy ngược** được ra giá trị gốc — khác với kiểu che giữ
 * ký tự cuối của `AuditWriter`.
 */

/** Họ tên thay thế sau ẩn danh hoá. */
export const ANONYMIZED_NAME = 'Khách đã ẩn danh';

/**
 * SĐT thay thế: vẫn đúng dạng canonical `+84…` nhưng là dãy số 0, không thuộc dải số di động thật nên
 * không thể trùng một khách khác; chỉ mục `uq_guests_phone` chỉ áp cho hồ sơ `anonymized_at IS NULL`.
 */
export const ANONYMIZED_PHONE = '+84000000000';

/**
 * Lý do danh sách đen thay thế: trạng thái `blacklisted` giữ nguyên nên ràng buộc
 * `ck_guests_blacklist_reason` vẫn cần một giá trị — giá trị này không PII.
 */
export const ANONYMIZED_BLACKLIST_REASON = 'Hồ sơ đã ẩn danh hoá';

/** Nội dung ghi chú thay thế trong `guest_notes` (BR-CRM-05: ghi chú được ẩn danh hoá cùng hồ sơ). */
export const ANONYMIZED_NOTE = '[Ẩn danh hoá]';

/**
 * Các cột của `guests` bị thay khi ẩn danh hoá.
 *
 * - `fullName`, `phone`, `email`, `idNumber`, `dob`, `notes`, `blacklistReason`: danh mục PII bắt buộc.
 * - `nationality`, `gender`: dữ liệu cá nhân không cần cho đối soát → đưa về rỗng/`UNSPECIFIED`.
 * - `anonymizedAt`: do máy chủ đặt từ `Clock`, **không** nhận từ thân yêu cầu (`requestedAt` chỉ là dấu
 *   vết yêu cầu của khách, ghi trong nhật ký).
 *
 * **Giữ nguyên** (có lý do trong mã): `loyalty_tier`/`loyalty_points`/`total_stays` (không định danh,
 * cần cho đối soát điểm), `consent_marketing`/`consent_at`/`consent_version` (NFR-COMP-01: hồ sơ xử lý
 * yêu cầu chủ thể dữ liệu lưu ≥ 24 tháng), `blacklisted` (không tự gỡ danh sách đen trong lượt ẩn danh).
 */
export function anonymizeData(blacklisted: boolean, at: Date): Prisma.guestsUpdateInput {
  return {
    full_name: ANONYMIZED_NAME,
    phone: ANONYMIZED_PHONE,
    email: null,
    id_number: null,
    dob: null,
    nationality: null,
    gender: 'UNSPECIFIED',
    notes: null,
    blacklist_reason: blacklisted ? ANONYMIZED_BLACKLIST_REASON : null,
    anonymized_at: at,
  };
}

/**
 * BR-CRM-05 + NFR-COMP-01 — lý do tự do của yêu cầu ẩn danh hoá cũng là chỗ lọt PII. `maskOperationalText`
 * (quy ước NFR-SEC-03) chỉ che email/SĐT, nên ở đây thay thêm **chuỗi tên đã biết** của hồ sơ trước khi ẩn
 * danh; hồ sơ sau đó giữ `ANONYMIZED_NAME` nên nhật ký không còn tên gốc.
 *
 * Giới hạn đã biết: chỉ khớp đúng chuỗi `fullName` (không phân biệt hoa thường) — biến thể như tên gọi,
 * viết tắt hay tên không dấu không nhận ra được.
 */
export function maskAnonymizeReason(reason: string, fullName: string): string {
  const masked = maskOperationalText(reason);
  const name = fullName.trim();
  if (name.length === 0) return masked;
  const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu');
  return masked.replace(pattern, ANONYMIZED_NAME);
}
