import type { Prisma } from '@prisma/client';
import { AppError } from '../../../common/app-error.js';

/**
 * BR-CRM-04: khách trong danh sách đen **chặn** tạo booking walk-in (HB-151) và check-in (HB-144).
 * Hai ticket đó gọi hàm này trong transaction của mình để lỗi `403 E_BOOK_BLACKLISTED` phát ra cùng chỗ
 * với các kiểm tra nghiệp vụ khác, không kiểm ở tầng giao diện.
 */
export async function assertGuestNotBlacklisted(
  tx: Prisma.TransactionClient,
  guestId: string,
): Promise<void> {
  const guest = await tx.guests.findUnique({
    where: { id: guestId },
    select: { blacklisted: true },
  });
  if (guest?.blacklisted === true)
    throw new AppError(403, 'E_BOOK_BLACKLISTED', 'Khách đang trong danh sách đen.');
}
