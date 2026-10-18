/**
 * Sổ đăng ký adapter theo cổng (HB-094): nơi duy nhất ánh xạ `method` → `PaymentGatewayAdapter`.
 * `POST /payments/online` và webhook PSP (HB-095) dùng chung sổ này, nên hai bên không thể lệch thuật
 * toán ký/chế độ cấu hình. Bộ mô phỏng (`PspSimulator`) dựng từ **cùng** `PspSettings`.
 */
import type { PaymentGatewayAdapter, PspMethod, PspResult } from './port.js';
import { VnpayAdapter } from './vnpay.js';
import { MomoAdapter } from './momo.js';
import type { PspSettings } from './settings.js';

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

export class PaymentGateways {
  private readonly adapters: Readonly<Record<PspMethod, PaymentGatewayAdapter>>;

  constructor(readonly settings: PspSettings) {
    this.adapters = {
      VNPAY: new VnpayAdapter(settings.VNPAY),
      MOMO: new MomoAdapter(settings.MOMO),
    };
  }

  for(method: PspMethod): PaymentGatewayAdapter {
    return this.adapters[method];
  }

  /** Xác minh sự kiện PSP thô; `null` ⇒ không được ghi tiền (BR-PAY-03, §5.2). */
  verify(method: PspMethod, raw: string): PspResult | null {
    return this.adapters[method].verify(raw);
  }
}
