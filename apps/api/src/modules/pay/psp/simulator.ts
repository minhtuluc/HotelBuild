/**
 * Bộ **mô phỏng** phía cổng thanh toán (HB-094 AC4) — "sandbox chưa có" thì đây là phía còn lại của
 * hợp đồng: dựng sự kiện PSP đúng định dạng và **đúng thuật toán ký** của tài liệu provider, để
 * `PaymentGatewayAdapter.verify` (và HB-095 sau này) được kiểm bằng dữ liệu thật của giao thức.
 *
 * Bộ mô phỏng dùng chung `signatureString`/`momoIpnSignature` với adapter, nên nó không thể "ký một
 * đằng, xác minh một nẻo". Khi có sandbox, chỉ cần đổi `PspSettings` (khoá + URL) — bộ mô phỏng vẫn
 * dùng được cho test, còn cổng thật gửi về đúng dạng dữ liệu đó.
 */
import type { PspMethod } from './port.js';
import { hmacHex, signatureString, vnTimestamp } from './signing.js';
import { momoIpnSignature } from './momo.js';
import type { PspSettings } from './settings.js';

export interface SimulatedEvent {
  readonly method: PspMethod;
  readonly orderRef: string;
  readonly amount: bigint;
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  readonly providerTxnId: string;
  readonly at: Date;
}

export class PspSimulator {
  constructor(private readonly settings: PspSettings) {}

  /** Sự kiện cổng ở dạng **thô** đúng giao thức: query string (VNPay) hoặc JSON (MoMo). */
  event(event: SimulatedEvent): string {
    return event.method === 'VNPAY' ? this.vnpayEvent(event) : this.momoEvent(event);
  }

  private vnpayEvent(event: SimulatedEvent): string {
    const configured = this.settings.VNPAY;
    const params: Record<string, string> = {
      vnp_TmnCode: configured.merchantCode,
      vnp_TxnRef: event.orderRef,
      vnp_Amount: (event.amount * 100n).toString(),
      vnp_ResponseCode: event.outcome === 'SUCCEEDED' ? '00' : '24',
      vnp_TransactionStatus: event.outcome === 'SUCCEEDED' ? '00' : '02',
      vnp_TransactionNo: event.providerTxnId,
      vnp_PayDate: vnTimestamp(event.at),
      vnp_OrderInfo: `Thanh toan ${event.orderRef}`,
    };
    const signature = hmacHex('sha512', configured.secret, signatureString(params));
    const query = new URLSearchParams(params);
    query.set('vnp_SecureHashType', 'HmacSHA512');
    query.set('vnp_SecureHash', signature);
    return query.toString();
  }

  private momoEvent(event: SimulatedEvent): string {
    const configured = this.settings.MOMO;
    const values: Record<string, string> = {
      accessKey: configured.accessKey,
      amount: event.amount.toString(),
      extraData: '',
      message: event.outcome === 'SUCCEEDED' ? 'Successful.' : 'Failed.',
      orderId: event.orderRef,
      orderInfo: `Thanh toan ${event.orderRef}`,
      orderType: 'momo_wallet',
      partnerCode: configured.merchantCode,
      payType: 'qr',
      requestId: event.orderRef,
      responseTime: String(event.at.getTime()),
      resultCode: event.outcome === 'SUCCEEDED' ? '0' : '1006',
      transId: event.providerTxnId,
    };
    const signature = momoIpnSignature(values, configured.secret);
    // `accessKey` là khoá công khai phía đối tác, không nằm trong thân IPN của MoMo.
    delete values['accessKey'];
    return JSON.stringify({ ...values, signature });
  }
}
