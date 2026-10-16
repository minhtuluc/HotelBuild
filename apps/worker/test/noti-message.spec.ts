import { describe, expect, test } from 'vitest';
import { NOTIFICATION_CHANNELS, parseOutgoingMessage, renderMessage } from '../src/noti/message.js';
import type { NotificationMessage, OutgoingMessage } from '../src/noti/message.js';

/**
 * HB-168 — nội dung thông báo: tiêu đề theo mẫu, thân thư chỉ gồm các trường đã biết (không dump JSON,
 * không lộ trường thừa), và `payload_json` sai khuôn bị từ chối trước khi gửi.
 */
const TEMPLATE_SUBJECTS: Readonly<Record<string, string>> = {
  'booking-confirmed': 'Xác nhận đặt phòng',
  'booking-cancelled': 'Xác nhận huỷ đặt phòng',
  'refund-paid': 'Thông báo hoàn tiền',
  'room-moved': 'Thông báo đổi phòng',
  'payment-confirmed': 'Xác nhận thanh toán',
};

function outgoing(message: NotificationMessage, template = 'booking-confirmed'): OutgoingMessage {
  return { channel: 'EMAIL', recipient: 'guest@example.test', template, message };
}

describe('HB-168 · renderMessage', () => {
  test('đủ trường ⇒ thân thư theo đúng thứ tự, tiêu đề kèm mã đặt phòng', () => {
    const rendered = renderMessage(
      outgoing({
        guestName: 'Nguyễn Văn A',
        bookingCode: 'PH-261168',
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
        amountVnd: 1_250_000,
        reason: 'Khách yêu cầu đổi ngày',
      }),
    );
    expect(rendered.subject).toBe('Xác nhận đặt phòng [PH-261168] — Pine Hill');
    expect(rendered.body.split('\n')).toEqual([
      'Pine Hill —',
      'Kính gửi Nguyễn Văn A,',
      'Lưu trú: 2026-11-01 → 2026-11-03.',
      'Số tiền: 1.250.000 VND.',
      'Lý do: Khách yêu cầu đổi ngày.',
      'Mã đặt phòng: PH-261168.',
    ]);
  });

  test('không có trường nào ⇒ thân thư thay thế, tiêu đề không kèm mã', () => {
    const rendered = renderMessage(outgoing({}));
    expect(rendered.subject).toBe('Xác nhận đặt phòng — Pine Hill');
    expect(rendered.body.split('\n')).toEqual([
      'Pine Hill —',
      'Chi tiết thông báo đã ghi trong hệ thống Pine Hill.',
    ]);
  });

  test('thiếu ngày trả phòng ⇒ không có dòng lưu trú', () => {
    const rendered = renderMessage(outgoing({ checkIn: '2026-11-01' }));
    expect(rendered.body).not.toContain('Lưu trú:');
  });

  test('tiêu đề theo từng mẫu; mẫu lạ giữ nguyên tên', () => {
    for (const [template, label] of Object.entries(TEMPLATE_SUBJECTS)) {
      expect(renderMessage(outgoing({ bookingCode: 'PH-1' }, template)).subject).toBe(
        `${label} [PH-1] — Pine Hill`,
      );
    }
    expect(renderMessage(outgoing({}, 'mẫu-lạ')).subject).toBe('Thông báo từ Pine Hill (mẫu-lạ)');
  });

  test('tiền VND là số nguyên có dấu chấm phân cách, không phụ thuộc locale', () => {
    const amounts: readonly (readonly [number, string])[] = [
      [0, '0 VND'],
      [999, '999 VND'],
      [1_000, '1.000 VND'],
      [1_234_567_890, '1.234.567.890 VND'],
    ];
    for (const [amountVnd, expected] of amounts) {
      const rendered = renderMessage(outgoing({ amountVnd }));
      expect(rendered.body).toContain(`Số tiền: ${expected}.`);
    }
  });
});

describe('HB-168 · parseOutgoingMessage', () => {
  test('payload hợp lệ ⇒ giữ kênh/người nhận/mẫu và dữ kiện đã kiểm', () => {
    const parsed = parseOutgoingMessage('SMS', '+84900000168', 'booking-confirmed', {
      bookingCode: 'PH-261168',
      guestName: 'Khách HB-168',
    });
    expect(parsed).toEqual({
      channel: 'SMS',
      recipient: '+84900000168',
      template: 'booking-confirmed',
      message: { bookingCode: 'PH-261168', guestName: 'Khách HB-168' },
    });
    expect(
      parseOutgoingMessage('EMAIL', 'a@b.test', 'refund-paid', {
        amountVnd: 0,
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
      }).message,
    ).toEqual({ amountVnd: 0, checkIn: '2026-11-01', checkOut: '2026-11-03' });
  });

  test('payload sai khuôn (khoá lạ/kiểu sai/ngày sai) ⇒ NOTIFICATION_MESSAGE_INVALID', () => {
    const invalid: readonly unknown[] = [
      null,
      { bookingCode: 5 },
      { khoaLạ: 'x' },
      { checkIn: '01/11/2026' },
      { guestName: '' },
      { amountVnd: -1 },
    ];
    for (const payload of invalid) {
      expect(() => parseOutgoingMessage('EMAIL', 'a@b.test', 'booking-confirmed', payload)).toThrow(
        'NOTIFICATION_MESSAGE_INVALID',
      );
    }
  });

  test('danh mục kênh khớp enum hợp đồng HB-160', () => {
    expect(NOTIFICATION_CHANNELS).toEqual(['EMAIL', 'SMS', 'ZALO_OA', 'PUSH']);
  });
});
