import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type {
  CancelPreview,
  CancelPreviewRequest,
  CancelRequest,
  CancelResponse,
} from '@pinehill/contracts';
import {
  CANCEL_REASON_KEYS,
  actionStates,
  cancelRequestFor,
  confirmCancel,
  formatHoursBeforeCheckIn,
  loadPreview,
  refundRows,
  type CancelApi,
} from '../src/cancel';

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const BREAKDOWN: CancelPreview['cancellation'] = {
  policyId: 'pol-1',
  appliedTierId: 'tier-48h',
  hoursBeforeCheckIn: 30.5,
  refundPercent: 80,
  paidAmount: 2_000_000,
  requestedAmount: 1_600_000,
  penaltyAmount: 400_000,
  refundFee: 0,
};

function previewOf(cancellation: CancelPreview['cancellation'] = BREAKDOWN): CancelPreview {
  return { bookingId: 'b1', currency: 'VND', cancellation };
}

const RESPONSE: CancelResponse = {
  bookingId: 'b1',
  status: 'CANCELLED',
  cancelledAt: '2026-12-20T03:00:00.000Z',
  cancelReason: 'GUEST_REQUEST',
  releasedAssignmentCount: 1,
  cancellation: BREAKDOWN,
  refundRequest: { id: 'r1', status: 'PENDING', approvedAmount: null },
};

function stubApi(result: CancelPreview = previewOf()) {
  const preview = vi.fn(async (_bookingId: string, _request: CancelPreviewRequest) => result);
  const cancel = vi.fn(async (_bookingId: string, _request: CancelRequest) => RESPONSE);
  const api: CancelApi = { preview, cancel };
  return { api, preview, cancel };
}

describe('SCR-81 huỷ đặt phòng trên Android (HB-114)', () => {
  it('luôn xem trước rồi mới cho xác nhận; offline khoá cả hai nút (AC1, QĐ-03 quyết định 6)', () => {
    expect(actionStates('idle', true)).toEqual({ previewDisabled: false, confirmDisabled: true });
    expect(actionStates('computing', true)).toEqual({
      previewDisabled: true,
      confirmDisabled: true,
    });
    expect(actionStates('previewed', true)).toEqual({
      previewDisabled: false,
      confirmDisabled: false,
    });
    expect(actionStates('submitting', true)).toEqual({
      previewDisabled: true,
      confirmDisabled: true,
    });
    expect(actionStates('previewed', false)).toEqual({
      previewDisabled: true,
      confirmDisabled: true,
    });
  });

  it('lý do bất khả kháng gửi cờ tương ứng, lý do khách thì không', () => {
    expect(cancelRequestFor('FORCE_MAJEURE')).toEqual({
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
    });
    expect(cancelRequestFor('GUEST_REQUEST')).toEqual({
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
    });
    expect(Object.keys(CANCEL_REASON_KEYS)).toEqual(['GUEST_REQUEST', 'FORCE_MAJEURE']);
  });

  it('offline: không gọi máy chủ, trả trạng thái offline để màn hình khoá xác nhận', async () => {
    const { api, preview } = stubApi();
    expect(
      await loadPreview({ api, net: offline }, 'b1', cancelRequestFor('GUEST_REQUEST')),
    ).toEqual({ kind: 'offline' });
    expect(preview).not.toHaveBeenCalled();
  });

  it('giữ nguyên văn số liệu máy chủ trả, không tự tính lại (ADR-018)', async () => {
    const { api } = stubApi();
    const outcome = await loadPreview(
      { api, net: online },
      'b1',
      cancelRequestFor('GUEST_REQUEST'),
    );
    expect(outcome).toEqual({ kind: 'preview', preview: previewOf() });
    expect(refundRows(BREAKDOWN)).toEqual([
      { key: 'paid', amount: 2_000_000 },
      { key: 'requested', amount: 1_600_000 },
      { key: 'penalty', amount: 400_000 },
      { key: 'fee', amount: 0 },
    ]);
    expect(formatHoursBeforeCheckIn(30.5)).toBe('30,5');
  });

  it('lỗi máy chủ thì trả mã để màn hình dịch theo danh mục', async () => {
    const preview = vi.fn(async (_bookingId: string, _request: CancelPreviewRequest) => {
      throw new ApiError({
        kind: 'http',
        message: 'Trạng thái không cho huỷ',
        status: 409,
        code: 'E_BOOK_INVALID_STATUS',
      });
    });
    const api: CancelApi = { preview, cancel: vi.fn() };
    expect(
      await loadPreview({ api, net: online }, 'b1', cancelRequestFor('GUEST_REQUEST')),
    ).toEqual({ kind: 'failed', code: 'E_BOOK_INVALID_STATUS' });
  });

  it('xác nhận: đối chiếu lại, số liệu đổi thì chưa huỷ và trả bản mới', async () => {
    const fresh = previewOf({
      ...BREAKDOWN,
      refundPercent: 50,
      requestedAmount: 1_000_000,
      penaltyAmount: 1_000_000,
    });
    const { api, cancel } = stubApi(fresh);
    expect(
      await confirmCancel(
        { api, net: online },
        'b1',
        cancelRequestFor('GUEST_REQUEST'),
        previewOf(),
        '  ',
      ),
    ).toEqual({ kind: 'stale', preview: fresh });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('xác nhận: số liệu không đổi thì huỷ, ghi chú được cắt khoảng trắng', async () => {
    const { api, cancel } = stubApi();
    const outcome = await confirmCancel(
      { api, net: online },
      'b1',
      cancelRequestFor('GUEST_REQUEST'),
      previewOf(),
      '  khách bận  ',
    );
    expect(outcome).toEqual({ kind: 'cancelled', result: RESPONSE });
    expect(cancel).toHaveBeenCalledWith('b1', {
      reason: 'GUEST_REQUEST',
      isForceMajeure: false,
      note: 'khách bận',
    });
  });

  it('xác nhận: ghi chú rỗng thì không gửi trường note', async () => {
    const { api, cancel } = stubApi();
    await confirmCancel(
      { api, net: online },
      'b1',
      cancelRequestFor('FORCE_MAJEURE'),
      previewOf(),
      '   ',
    );
    expect(cancel).toHaveBeenCalledWith('b1', {
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
    });
  });

  it('xác nhận offline: dừng trước khi gọi máy chủ', async () => {
    const { api, preview, cancel } = stubApi();
    expect(
      await confirmCancel(
        { api, net: offline },
        'b1',
        cancelRequestFor('GUEST_REQUEST'),
        previewOf(),
        '',
      ),
    ).toEqual({ kind: 'offline' });
    expect(preview).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('xác nhận: lỗi máy chủ trả mã, không coi là đã huỷ', async () => {
    const preview = vi.fn(async (_bookingId: string, _request: CancelPreviewRequest) =>
      previewOf(),
    );
    const cancel = vi.fn(async (_bookingId: string, _request: CancelRequest) => {
      throw new ApiError({
        kind: 'timeout',
        message: 'Chưa xác định kết quả',
        code: 'E_PAY_PROVIDER_TIMEOUT',
      });
    });
    const api: CancelApi = { preview, cancel };
    expect(
      await confirmCancel(
        { api, net: online },
        'b1',
        cancelRequestFor('GUEST_REQUEST'),
        previewOf(),
        '',
      ),
    ).toEqual({ kind: 'failed', code: 'E_PAY_PROVIDER_TIMEOUT' });
  });
});
