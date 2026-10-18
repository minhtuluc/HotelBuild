/**
 * Module số dư booking (HB-096, UC-PAY-03): `GET /bookings/{bookingId}/balance`.
 * Đọc từ projection sổ cái HB-093 (không đọc cột `balance_due` có thể lệch — TD-18).
 */
import { Module } from '@nestjs/common';
import { BookingBalanceService } from './service.js';
import { BalanceController } from './controller.js';
import { balancePermissions } from './permissions.js';

@Module({
  controllers: [BalanceController],
  providers: [BookingBalanceService, balancePermissions],
})
export class PayBalanceModule {}
