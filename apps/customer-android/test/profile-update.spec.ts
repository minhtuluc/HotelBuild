import { describe, expect, it, vi } from 'vitest';
import type { GuestSummary } from '@pinehill/contracts';
import { ApiError } from '@pinehill/api-client';
import {
  CONSENT_VERSION,
  draftOf,
  saveProfile,
  updateRequestFor,
  type ProfileApi,
} from '../src/profile';

// HB-260: SCR-83 "Cập nhật hồ sơ" — trước đây tab Tài khoản chỉ xem, ghi chú "chờ tuyến PATCH /guests/me".
const GUEST: GuestSummary = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912345678',
  email: 'an@example.com',
  loyaltyTier: 'MEMBER',
  loyaltyPoints: 0,
  totalStays: 0,
  blacklisted: false,
  consentMarketing: false,
  createdAt: '2026-09-19T03:14:02.000Z',
};

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

describe('HB-260 sửa hồ sơ khách (SCR-83)', () => {
  it('chỉ gửi trường đã đổi; bật nhận tin kèm phiên bản điều khoản; email trống ⇒ xoá', () => {
    const draft = { ...draftOf(GUEST), fullName: '  Nguyễn Văn Bình ', email: '', consent: true };
    expect(updateRequestFor(draft, GUEST)).toEqual({
      ok: true,
      request: {
        fullName: 'Nguyễn Văn Bình',
        email: null,
        consentMarketing: true,
        consentVersion: CONSENT_VERSION,
      },
    });
    expect(updateRequestFor({ ...draftOf(GUEST), email: ' moi@example.com ' }, GUEST)).toEqual({
      ok: true,
      request: { email: 'moi@example.com' },
    });
  });

  it('kiểm tại chỗ: tên trống, email sai dạng, không đổi gì đều không gọi máy chủ', () => {
    expect(updateRequestFor({ ...draftOf(GUEST), fullName: '  ' }, GUEST)).toEqual({
      ok: false,
      issue: 'name',
    });
    expect(updateRequestFor({ ...draftOf(GUEST), email: 'an@' }, GUEST)).toEqual({
      ok: false,
      issue: 'email',
    });
    expect(updateRequestFor(draftOf(GUEST), GUEST)).toEqual({ ok: false, issue: 'unchanged' });
    // Máy thật: bộ gõ biến `example` thành `ẽample` — regex sơ bộ cho qua, schema hợp đồng thì không.
    expect(updateRequestFor({ ...draftOf(GUEST), email: 'khach@ẽample.com' }, GUEST)).toEqual({
      ok: false,
      issue: 'email',
    });
  });

  it('lưu: offline không gọi máy chủ; thành công trả hồ sơ máy chủ; lỗi trả mã', async () => {
    const update = vi.fn(async () => ({ ...GUEST, fullName: 'Bình' }));
    const api: ProfileApi = { me: vi.fn(), loyalty: vi.fn(), update };
    expect(await saveProfile({ api, net: offline }, { fullName: 'Bình' })).toEqual({
      kind: 'offline',
    });
    expect(update).not.toHaveBeenCalled();
    expect(await saveProfile({ api, net: online }, { fullName: 'Bình' })).toEqual({
      kind: 'saved',
      profile: { ...GUEST, fullName: 'Bình' },
    });
    const failing: ProfileApi = {
      ...api,
      update: async () => {
        throw new ApiError({
          kind: 'http',
          message: 'x',
          status: 400,
          code: 'E_GEN_VALIDATION_FAILED',
        });
      },
    };
    expect(await saveProfile({ api: failing, net: online }, { fullName: 'Bình' })).toEqual({
      kind: 'failed',
      code: 'E_GEN_VALIDATION_FAILED',
    });
  });
});
