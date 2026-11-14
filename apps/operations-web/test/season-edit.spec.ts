import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { SeasonSummary } from '@pinehill/contracts';
import { editFailure, ifMatchOf, reasonIssues } from '../src/lib/config-edit';
import {
  seasonEditDraftOf,
  seasonStatus,
  toSeasonToggle,
  toSeasonUpdate,
  validateSeasonEdit,
} from '../src/lib/seasons';

const season: SeasonSummary = {
  id: 's1',
  propertyId: 'p1',
  name: 'Hè 2026',
  startDate: '2026-06-01',
  endDate: '2026-08-31',
  multiplier: 1.4,
  priority: 2,
  weekendSurchargeEnabled: true,
  status: 'ACTIVE',
  version: 7,
};

describe('HB-310 sửa / ngừng mùa', () => {
  it('bản nháp lấy nguyên bản đang xem, hệ số dấu phẩy 2 chữ số, lý do rỗng', () => {
    expect(seasonEditDraftOf(season)).toMatchObject({
      multiplier: '1,40',
      priority: '2',
      reason: '',
    });
  });

  it('chỉ gửi trường đổi kèm lý do; không đổi gì thì không có thân lệnh', () => {
    const draft = { ...seasonEditDraftOf(season), reason: '  Lễ 2/9  ' };
    expect(toSeasonUpdate(season, draft)).toBeNull();
    expect(toSeasonUpdate(season, { ...draft, multiplier: '1,5', endDate: '2026-09-02' })).toEqual({
      multiplier: 1.5,
      endDate: '2026-09-02',
      reason: 'Lễ 2/9',
    });
    expect(toSeasonUpdate(season, { ...draft, multiplier: '1.40' })).toBeNull();
  });

  it('bắt buộc lý do và kiểm khoảng ngày, hệ số như lúc tạo', () => {
    const draft = { ...seasonEditDraftOf(season), endDate: '2026-05-01', multiplier: '9' };
    expect(validateSeasonEdit(draft)).toEqual([
      { field: 'endDate', issue: 'BEFORE_START' },
      { field: 'multiplier', issue: 'OUT_OF_RANGE' },
      { field: 'reason', issue: 'REQUIRED' },
    ]);
    expect(reasonIssues('x'.repeat(501))).toEqual([{ field: 'reason', issue: 'TOO_LONG' }]);
  });

  it('ngừng mùa đang áp dụng, bật lại mùa đã ngừng; phản hồi cũ thiếu status coi là đang áp dụng', () => {
    expect(toSeasonToggle(season, ' hết mùa ')).toEqual({ status: 'INACTIVE', reason: 'hết mùa' });
    expect(toSeasonToggle({ ...season, status: 'INACTIVE' }, 'mở lại')).toEqual({
      status: 'ACTIVE',
      reason: 'mở lại',
    });
    const { status, ...legacy } = season;
    expect(status).toBe('ACTIVE');
    expect(seasonStatus(legacy)).toBe('ACTIVE');
  });

  it('If-Match theo phiên bản và phân loại lỗi ghi', () => {
    expect(ifMatchOf(7)).toBe('"7"');
    const error = (status: number, code?: string) =>
      new ApiError({ kind: 'http', status, message: 'x', ...(code ? { code } : {}) });
    expect(editFailure(error(403))).toEqual({ kind: 'forbidden' });
    expect(editFailure(error(412))).toEqual({ kind: 'conflict' });
    expect(editFailure(error(409, 'E_GEN_VERSION_CONFLICT'))).toEqual({ kind: 'conflict' });
    expect(editFailure(error(422, 'E_GEN_VALIDATION_FAILED')).kind).toBe('invalid');
    expect(editFailure(error(500)).kind).toBe('unknown');
    expect(editFailure(new Error('decode'))).toEqual({ kind: 'unknown', reference: undefined });
  });
});
