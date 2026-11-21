import { describe, expect, it } from 'vitest';
import { pinFormIssue, setPinBody } from '../../src/app/(ops)/account/pin/pin-model';

describe('go-live: đặt PIN thao tác trên web vận hành', () => {
  it('PIN đúng 6 chữ số, nhập lại khớp, có mật khẩu hiện tại', () => {
    expect(pinFormIssue({ currentPassword: '', pin: '123456', confirm: '123456' })).toBe(
      'PASSWORD',
    );
    expect(pinFormIssue({ currentPassword: 'x', pin: '12345', confirm: '12345' })).toBe('PIN');
    expect(pinFormIssue({ currentPassword: 'x', pin: '12a456', confirm: '12a456' })).toBe('PIN');
    expect(pinFormIssue({ currentPassword: 'x', pin: '123456', confirm: '654321' })).toBe(
      'CONFIRM',
    );
    expect(pinFormIssue({ currentPassword: 'x', pin: '123456', confirm: '123456' })).toBeNull();
  });

  it('thân lệnh PUT /auth/pin chỉ gồm pin + currentPassword', () => {
    expect(setPinBody({ currentPassword: 'Mat-khau-1', pin: '246813', confirm: '246813' })).toEqual(
      {
        pin: '246813',
        currentPassword: 'Mat-khau-1',
      },
    );
  });
});
