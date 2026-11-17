import { expect, test } from 'vitest';
import { pinSetupRequest } from '../src/pin-setup-model';

// HB-247: màn Đặt PIN tự hỏi mật khẩu hiện tại. Trước đây mật khẩu được truyền từ index.tsx,
// nên đăng nhập thẳng (không buộc đổi mật khẩu) hay khôi phục phiên gửi chuỗi rỗng, còn sau khi
// đổi mật khẩu lại gửi mật khẩu cũ — cả hai đều không đặt được PIN trên máy thật.

test('two matching PINs and the typed current password become the PUT /auth/pin body', () => {
  expect(
    pinSetupRequest({ first: '246813', second: '246813', currentPassword: 'PineHill@Dev2026' }),
  ).toEqual({
    ok: true,
    request: { pin: '246813', currentPassword: 'PineHill@Dev2026' },
  });
});

test('mismatched PINs are rejected before the password is checked', () => {
  expect(pinSetupRequest({ first: '246813', second: '246814', currentPassword: '' })).toEqual({
    ok: false,
    error: 'pin.setup.mismatch',
  });
});

test('an empty current password is a local validation message, not an UNKNOWN failure', () => {
  expect(pinSetupRequest({ first: '246813', second: '246813', currentPassword: '' })).toEqual({
    ok: false,
    error: 'pin.setup.passwordRequired',
  });
});
