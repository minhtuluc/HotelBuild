import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { StateSurface, type ScreenState } from '../src/states.js';
import { viCatalog } from '../src/messages.js';

afterEach(cleanup);

const confirmButton = <button type="button">XÁC NHẬN</button>;

describe('hợp đồng 9 trạng thái UI (§8.1)', () => {
  it('loading: báo bận, không hiện số 0 hay thành công giả, không render nội dung', () => {
    const { container } = render(
      <StateSurface state={{ kind: 'loading' }}>{confirmButton}</StateSurface>,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(viCatalog['state.loading']);
    expect(screen.queryByText('XÁC NHẬN')).toBeNull();
  });

  it('refreshing: giữ dữ liệu cũ, có mốc cập nhật giờ VN và dấu hiệu dữ liệu cũ', () => {
    render(
      <StateSurface
        state={{ kind: 'refreshing', updatedAt: '2026-11-12T07:00:00.000Z', stale: true }}
      >
        {confirmButton}
      </StateSurface>,
    );
    expect(screen.getByRole('status').textContent).toContain('12/11/2026 14:00 (giờ VN)');
    expect(screen.getByRole('note').textContent).toContain(viCatalog['state.refreshing.stale']);
    expect(screen.getByText('XÁC NHẬN')).toBeDefined();
  });

  it('empty: phân biệt ba lý do và chỉ hiện CTA khi có quyền', () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <StateSurface state={{ kind: 'empty', reason: 'filtered', canCreate: false }}>
        {confirmButton}
      </StateSurface>,
    );
    expect(screen.getByRole('status').textContent).toBe(viCatalog['state.empty.filtered']);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <StateSurface state={{ kind: 'empty', reason: 'noData', canCreate: true, onCreate }}>
        {confirmButton}
      </StateSurface>,
    );
    fireEvent.click(screen.getByRole('button', { name: viCatalog['state.empty.create'] }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('empty hết phòng dùng câu chữ riêng', () => {
    render(<StateSurface state={{ kind: 'empty', reason: 'soldOut', canCreate: false }} />);
    expect(screen.getByRole('status').textContent).toBe(viCatalog['state.empty.soldOut']);
  });

  it('validationError: giữ bản nhập, liệt kê lỗi theo trường và đưa tiêu điểm về trường lỗi', () => {
    render(
      <StateSurface
        state={{ kind: 'validationError', details: [{ field: 'adults', issue: 'OUT_OF_RANGE' }] }}
      >
        <input name="adults" defaultValue="9" />
      </StateSurface>,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      viCatalog['state.validation'].replace('{count}', '1'),
    );
    expect(screen.getByRole('textbox')).toHaveProperty('value', '9');
    fireEvent.click(screen.getByRole('button', { name: /adults/ }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('forbidden: không lộ chi tiết đối tượng ngoài phạm vi', () => {
    render(
      <StateSurface state={{ kind: 'forbidden' }}>
        {<p>CS-01 · Phòng 201 · khách Nguyễn Văn A</p>}
      </StateSurface>,
    );
    expect(screen.getByRole('alert').textContent).toBe(viCatalog['state.forbidden']);
    expect(screen.queryByText(/Nguyễn Văn A/)).toBeNull();
  });

  it('conflict: hiện cả hai phiên bản và buộc đối chiếu, không ghi đè im lặng', () => {
    const onReload = vi.fn();
    render(
      <StateSurface
        state={{ kind: 'conflict', currentVersion: '8', attemptedVersion: '7', onReload }}
      >
        {confirmButton}
      </StateSurface>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('8');
    expect(alert.textContent).toContain('7');
    expect(screen.queryByText('XÁC NHẬN')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: viCatalog['state.conflict.reload'] }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('expired: khoá xác nhận và nêu mốc hết hạn', () => {
    const onReload = vi.fn();
    render(
      <StateSurface state={{ kind: 'expired', expiresAt: '2026-11-12T07:00:00.000Z', onReload }}>
        {confirmButton}
      </StateSurface>,
    );
    expect(screen.getByRole('alert').textContent).toContain('12/11/2026 14:00 (giờ VN)');
    expect(screen.queryByText('XÁC NHẬN')).toBeNull();
  });

  it('unknownOutcome: nói chưa xác định kết quả chứ không kết luận thất bại', () => {
    const onLookup = vi.fn();
    render(
      <StateSurface state={{ kind: 'unknownOutcome', referenceId: 'trace-9', onLookup }}>
        {confirmButton}
      </StateSurface>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('trace-9');
    expect(alert.textContent?.toLowerCase()).not.toContain('thất bại');
    expect(screen.queryByText('XÁC NHẬN')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: viCatalog['state.unknownOutcome.lookup'] }));
    expect(onLookup).toHaveBeenCalledTimes(1);
  });

  it('success: chỉ báo khi máy chủ đã xác nhận', () => {
    render(<StateSurface state={{ kind: 'success' }}>{confirmButton}</StateSurface>);
    expect(screen.getByRole('status').textContent).toBe(viCatalog['state.success']);
    expect(screen.queryByText('XÁC NHẬN')).toBeNull();
  });
});

describe('accessibility của từng trạng thái', () => {
  const states: ScreenState[] = [
    { kind: 'ready' },
    { kind: 'loading' },
    { kind: 'refreshing', updatedAt: '2026-11-12T07:00:00.000Z', stale: false },
    { kind: 'empty', reason: 'noData', canCreate: true, onCreate: () => undefined },
    { kind: 'validationError', details: [{ field: 'adults', issue: 'OUT_OF_RANGE' }] },
    { kind: 'forbidden' },
    { kind: 'conflict', currentVersion: '8', attemptedVersion: '7', onReload: () => undefined },
    { kind: 'expired', expiresAt: '2026-11-12T07:00:00.000Z', onReload: () => undefined },
    { kind: 'unknownOutcome', referenceId: 'trace-9', onLookup: () => undefined },
    { kind: 'success' },
  ];

  it.each(states.map((state) => [state.kind, state] as const))(
    'axe không phát hiện vi phạm ở trạng thái %s',
    async (_kind, state) => {
      const { container } = render(
        <StateSurface state={state}>
          <label htmlFor="q">Tìm</label>
          <input id="q" name="adults" type="text" />
          <button type="button">Gửi</button>
        </StateSurface>,
      );
      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
    },
  );
});
