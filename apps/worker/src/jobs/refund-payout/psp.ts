/**
 * Cổng chi hoàn phía worker (HB-100; ADR-016).
 *
 * Chưa có adapter API hoàn tiền của VNPay/MoMo trong tài liệu, nên chế độ mặc định **không tự gửi**:
 * - `BANK_TRANSFER` (gồm khoản thu gốc là tiền mặt — BR-PAY-08): chuyển khoản thủ công có mã chứng từ
 *   ngân hàng và xác nhận kế toán, nên operation chỉ dừng ở UNKNOWN chờ đối soát tay.
 * - `VNPAY`/`MOMO`: nếu `REFUND_PAYOUT_SIMULATOR=true` (dev/test) dùng sổ mô phỏng bền
 *   `refund_payout_simulator_transfers`; ngược lại cũng dừng UNKNOWN — không giả vờ đã chi.
 *
 * Sổ mô phỏng ghi bằng **kết nối riêng** (không phải transaction nghiệp vụ), nên nó mô phỏng đúng ca
 * PSP đã chi rồi DB nghiệp vụ rollback: lần chạy sau phải `query` thấy SUCCEEDED và không gửi lần hai.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../../config/env.js';
import type { PayoutGateway, TransferResult } from './types.js';

const manualTransfer: PayoutGateway = {
  automatic: false,
  blockedCode: 'MANUAL_TRANSFER_AWAITING_CONFIRMATION',
  query: async () => ({ state: 'NOT_FOUND' }),
  submit: async () => ({ state: 'UNKNOWN' }),
};

function unavailablePayout(code: string): PayoutGateway {
  return {
    automatic: false,
    blockedCode: code,
    query: async () => ({ state: 'NOT_FOUND' }),
    submit: async () => ({ state: 'UNKNOWN' }),
  };
}

function resultOf(row: { status: string; provider_txn_id: string } | undefined): TransferResult {
  if (row === undefined) return { state: 'NOT_FOUND' };
  return row.status === 'SUCCEEDED'
    ? { state: 'SUCCEEDED', providerTxnId: row.provider_txn_id }
    : { state: 'FAILED' };
}

/** Sổ PSP mô phỏng: `psp_key` UNIQUE là idempotency thật của phía cổng. */
export function simulatedPayoutGateway(db: PrismaClient): PayoutGateway {
  return {
    automatic: true,
    async query(pspKey) {
      const rows = await db.$queryRaw<{ status: string; provider_txn_id: string }[]>`
        SELECT status, provider_txn_id FROM refund_payout_simulator_transfers
         WHERE psp_key = ${pspKey}`;
      return resultOf(rows[0]);
    },
    async submit(request) {
      const inserted = await db.$queryRaw<{ status: string; provider_txn_id: string }[]>`
        INSERT INTO refund_payout_simulator_transfers(psp_key, method, amount, status, provider_txn_id)
        VALUES(${request.pspKey}, ${request.method}, ${request.amount}, 'SUCCEEDED',
          ${'SIM-' + randomUUID()})
        ON CONFLICT (psp_key) DO NOTHING
        RETURNING status, provider_txn_id`;
      if (inserted[0]) return resultOf(inserted[0]);
      // Đã có giao dịch cùng khoá ⇒ trả bản ghi cũ, tuyệt đối không chi lần hai.
      const rows = await db.$queryRaw<{ status: string; provider_txn_id: string }[]>`
        SELECT status, provider_txn_id FROM refund_payout_simulator_transfers
         WHERE psp_key = ${request.pspKey}`;
      return resultOf(rows[0]);
    },
  };
}

export function payoutGatewayFor(
  db: PrismaClient,
  config: WorkerConfig,
  method: string,
): PayoutGateway {
  if (method === 'BANK_TRANSFER') return manualTransfer;
  if (config.REFUND_PAYOUT_SIMULATOR) return simulatedPayoutGateway(db);
  return unavailablePayout('PROVIDER_REFUND_API_NOT_CONFIGURED');
}
