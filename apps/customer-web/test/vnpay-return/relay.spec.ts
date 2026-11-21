import { describe, expect, it } from 'vitest';
import {
  vnpayIpnUrl,
  vnpayRelayPath,
} from '../../src/app/(guest)/booking/[bookingId]/pay/vnpay-return';

// Go-live: máy chủ chạy sau `localhost` nên VNPay không gọi IPN vào được. Chuỗi return đã ký được chuyển
// NGUYÊN BẢN sang endpoint IPN (máy chủ tự kiểm chữ ký, phát lại là idempotent) để giao dịch được ghi nhận.
describe('relay chuỗi return VNPay', () => {
  const raw =
    '?vnp_Amount=42900000&vnp_OrderInfo=Thanh+toan+DEPOSIT&vnp_ResponseCode=00&vnp_SecureHash=ab12';

  it('chỉ relay khi có chữ ký, giữ nguyên từng byte của chuỗi truy vấn', () => {
    expect(vnpayRelayPath(raw)).toBe(`/api/psp/vnpay-return${raw}`);
    expect(vnpayRelayPath('?paymentId=x')).toBeNull();
    expect(vnpayRelayPath('')).toBeNull();
  });

  it('URL IPN của API ghép đúng gốc API và chuỗi nguyên bản', () => {
    expect(vnpayIpnUrl('https://api.example/api/v1', raw)).toBe(
      `https://api.example/api/v1/integrations/psp/vnpay/callback${raw}`,
    );
    expect(vnpayIpnUrl('https://api.example/api/v1/', raw)).toBe(
      `https://api.example/api/v1/integrations/psp/vnpay/callback${raw}`,
    );
  });
});
