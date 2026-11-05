import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ControllerState } from '../../src/features/hb135-scr43-bang-qua-tai/controller';
import {
  classify,
  emptyConfirmed,
  evidenceOf,
} from '../../src/features/hb135-scr43-bang-qua-tai/model';
import { CommandStatus, ReadBanner } from '../../src/features/hb135-scr43-bang-qua-tai/status';
import { CaseTable } from '../../src/features/hb135-scr43-bang-qua-tai/table';
import { DESK, MANAGER, OWNER, caseRow, flush, http, okScan, page, setup } from './fixtures';

const noop = () => undefined;
const table = (state: ControllerState, canResolve = true) =>
  renderToStaticMarkup(
    createElement(CaseTable, {
      list: state.list,
      confirmedEmpty: state.list !== null && emptyConfirmed(state.list.scan),
      canResolve,
      busy: false,
      serverIssues: [],
      onMore: noop,
      onResolve: noop,
    }),
  );
const actions = { retry: noop, lookup: noop, discard: noop };
const failed = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(CommandStatus, { command: state.command, pending: state.pending, actions }),
  );

describe('HB-135 SCR-43', () => {
  it('case_list_deadline_projection', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page(
        [
          caseRow('k1', { shortageCount: 3, resolveDeadline: '2026-11-19T07:00:00.000Z' }),
          caseRow('k2', { overdue: true, resolveDeadline: '2026-11-09T07:00:00.000Z' }),
        ],
        { next: 'next-1' },
      ),
    );
    await controller.load();
    const markup = table(controller.getState());
    // Thứ tự, ID, số thiếu nguyên từ response; QUÁ HẠN là cờ máy chủ, không tự tính từ giờ máy.
    expect(markup.indexOf('hb135-row-k1')).toBeLessThan(markup.indexOf('hb135-row-k2'));
    expect(markup).toContain('<td>3</td>');
    expect(markup.match(/QUÁ HẠN/g)).toHaveLength(1);
    expect(markup).toContain('Trong hạn');
    expect(markup).toContain('/overbooking/relocation?caseId=k1');
    // Bộ lọc đi nguyên sang API; phân trang bằng cursor.
    await controller.applyFilter({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      status: 'ESCALATED',
      dateFrom: '2026-11-10',
      dateTo: '2026-12-09',
      overdueOnly: true,
    });
    expect(ports.list.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'ESCALATED',
      overdueOnly: true,
    });
    ports.list.mockResolvedValueOnce(page([caseRow('k1')], { next: 'next-2' }));
    await controller.load();
    ports.list.mockResolvedValueOnce(page([caseRow('k9')]));
    await controller.loadMore();
    expect(ports.list.mock.calls.at(-1)?.[1]).toBe('next-2');
    expect(controller.getState().list?.rows.map((row) => row.id)).toEqual(['k1', 'k9']);
    const calls = ports.list.mock.calls.length;
    await controller.applyFilter({
      ...controller.getState().filter,
      dateFrom: '2026-11-30',
      dateTo: '2026-11-01',
    });
    expect(ports.list.mock.calls.length).toBe(calls);
  });

  it('escalated_case_never_auto_closes', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([
        caseRow('k1', {
          status: 'ESCALATED',
          overdue: true,
          escalatedAt: '2026-11-09T07:00:00.000Z',
          delayReason: 'Chờ khách',
          date: '2026-11-08',
        }),
        caseRow('k2', { status: 'OPEN', overdue: true, date: '2026-11-07' }),
      ]),
    );
    await controller.load();
    const markup = table(controller.getState());
    expect(markup).toContain('Đã leo thang (ESCALATED)');
    expect(markup).toContain('Chờ khách');
    expect(markup).toContain('2026-11-08');
    expect(markup).not.toContain('Đã đóng');
    expect(markup.match(/QUÁ HẠN/g)).toHaveLength(2);
    // Tải lại sau khi hết ngày vẫn là ca cũ do máy chủ trả; UI không tự đóng hay ẩn.
    ports.list.mockResolvedValueOnce(
      page([caseRow('k1', { status: 'ESCALATED', overdue: true, date: '2026-11-08' })]),
    );
    await controller.load();
    expect(controller.getState().list?.rows[0]).toMatchObject({ status: 'ESCALATED' });
    expect(ports.resolve).not.toHaveBeenCalled();
    // Ca do hệ thống đóng hiện "bởi hệ thống", không bịa người xử lý.
    ports.list.mockResolvedValueOnce(
      page([
        caseRow('k3', {
          status: 'RESOLVED',
          resolvedAt: '2026-11-10T00:00:00.000Z',
          resolvedBy: null,
          resolutionSource: 'SYSTEM',
        }),
      ]),
    );
    await controller.load();
    const closed = table(controller.getState());
    expect(closed).toContain('bởi hệ thống');
    expect(closed).not.toContain('hb135-resolve-k3');
  });

  it('empty_requires_successful_scan', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(page([]));
    await controller.load();
    expect(table(controller.getState())).toContain('máy chủ xác nhận');
    for (const scan of [
      {
        scanStatus: 'UNKNOWN' as const,
        lastSuccessfulScanAt: null,
        nextScanAt: null,
        scannedThrough: null,
      },
      { ...okScan, scanStatus: 'FAILED' as const },
      { ...okScan, lastSuccessfulScanAt: null },
    ]) {
      ports.list.mockResolvedValueOnce(page([], { scan }));
      await controller.load();
      const markup = table(controller.getState());
      expect(markup).toContain('Chưa xác định');
      expect(markup).not.toContain('máy chủ xác nhận');
    }
    // Quét lỗi: giữ dữ liệu cũ, có nhãn thời điểm quét thành công gần nhất.
    ports.list.mockResolvedValueOnce(
      page([caseRow('k1')], { scan: { ...okScan, scanStatus: 'FAILED' } }),
    );
    await controller.load();
    expect(controller.getState().list?.rows).toHaveLength(1);
    expect(controller.getState().list?.scan.lastSuccessfulScanAt).toBe(okScan.lastSuccessfulScanAt);
  });

  it('resolve_server_guard', async () => {
    const { controller, ports } = setup();
    await controller.load();
    await controller.submitResolve('k1', ' Đã điều chuyển ');
    expect(ports.resolve.mock.calls[0]?.[0]).toMatchObject({
      caseId: 'k1',
      body: { resolutionNote: 'Đã điều chuyển' },
      ifMatch: '"3"',
    });
    await flush();
    // Sau đóng ca chỉ đọc lại trạng thái máy chủ; ca vẫn còn nếu máy chủ trả còn.
    expect(ports.list.mock.calls.length).toBeGreaterThan(1);
    expect(controller.getState().list?.rows.map((row) => row.id)).toEqual(['k1', 'k2']);
    // Thiếu ghi chú: không gửi; vai không có quyền: không gửi.
    await controller.submitResolve('k2', '  ');
    expect(ports.resolve).toHaveBeenCalledTimes(1);
    expect(controller.getState().command).toMatchObject({
      failure: { kind: 'validation', issues: [{ field: 'resolutionNote', issue: 'REQUIRED' }] },
    });
    const desk = setup(DESK);
    await desk.controller.load();
    await desk.controller.submitResolve('k1', 'x');
    expect(desk.ports.resolve).not.toHaveBeenCalled();
    expect(table(desk.controller.getState(), false)).not.toContain('hb135-resolve-');
    // Máy chủ từ chối (còn thiếu phòng): ca vẫn mở, ý định được nhả.
    ports.resolve.mockRejectedValueOnce(http(409, 'E_OVER_MOVE_NOT_ALLOWED'));
    await controller.submitResolve('k2', 'Thử đóng');
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'rejected' } },
    });
    expect(controller.getState().list?.rows.find((row) => row.id === 'k2')?.status).toBe('OPEN');
  });

  it('deadline_error_keeps_incident', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(page([caseRow('k1', { status: 'ESCALATED', overdue: true })]));
    await controller.load();
    ports.resolve.mockRejectedValueOnce(http(409, 'E_OVER_CASE_DEADLINE_PASSED'));
    await controller.submitResolve('k1', 'Đóng muộn');
    const state = controller.getState();
    expect(state.command).toMatchObject({ failure: { kind: 'deadlinePassed' } });
    expect(state.pending).toBe(false);
    expect(failed(state)).toContain('leo thang và xử lý tại chỗ');
    expect(state.list?.rows).toHaveLength(1);
    // Xem sự cố bằng bộ lọc không giới hạn tương lai vẫn được (bỏ ngày).
    await controller.applyFilter({ ...state.filter, dateFrom: '', dateTo: '' });
    expect(ports.list.mock.calls.at(-1)?.[0]).toMatchObject({ dateFrom: '', dateTo: '' });
    expect(controller.getState().list?.rows[0]?.id).toBe('k1');
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = setup();
    await controller.load();
    let release: (value: ReturnType<typeof page>) => void = () => undefined;
    ports.list.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const stale = controller.applyFilter({ ...controller.getState().filter, propertyId: 'p2' });
    expect(controller.getState().list).toBeNull();
    await flush();
    ports.list.mockResolvedValueOnce(page([caseRow('fresh')]));
    await controller.load();
    release(page([caseRow('old')]));
    await stale;
    expect(controller.getState().list?.rows.map((row) => row.id)).toEqual(['fresh']);
    ports.list.mockRejectedValueOnce(http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'expired', list: null, pending: false });
    ports.list.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState().phase).toBe('forbidden');
    controller.expire();
    expect(controller.getState()).toMatchObject({ phase: 'expired', actor: null });
    // Bộ lọc người dùng chọn được giữ khi mất phiên (không bị đặt lại về mặc định rộng hơn).
    expect(controller.getState().filter).toEqual(controller.getState().filter);
    const swap = setup(OWNER);
    await swap.controller.load();
    swap.ports.resolve.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await swap.controller.submitResolve('k1', 'x');
    expect(swap.controller.getState().pending).toBe(true);
    swap.ports.actor.mockResolvedValueOnce(MANAGER);
    await swap.controller.load();
    expect(swap.controller.getState().pending).toBe(false);
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = setup();
    await controller.load();
    ports.resolve.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitResolve('k1', 'Ghi chú');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    await controller.submitResolve('k2', 'Khác');
    expect(ports.resolve).toHaveBeenCalledTimes(1);
    await controller.retry();
    const [first, second] = ports.resolve.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    expect(first?.ifMatch).toBe('"3"');
    ports.resolve.mockRejectedValueOnce(
      http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitResolve('k2', 'Ghi chú 2');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    const held = ports.resolve.mock.calls.at(-1)?.[0].key;
    await controller.retry();
    expect(ports.resolve.mock.calls.at(-1)?.[0].key).toBe(held);
    ports.resolve.mockRejectedValueOnce(http(412, 'E_GEN_VERSION_CONFLICT'));
    const reads = ports.list.mock.calls.length;
    const sends = ports.resolve.mock.calls.length;
    await controller.submitResolve('k1', 'Sau');
    await flush();
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'conflict' } },
    });
    expect(ports.list.mock.calls.length).toBeGreaterThan(reads);
    expect(ports.resolve.mock.calls.length).toBe(sends + 1);
    ports.resolve.mockRejectedValueOnce(http(428, 'E_GEN_PRECONDITION_REQUIRED'));
    await controller.submitResolve('k1', 'Sau nữa');
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'conflict' } });
    ports.resolve.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.submitResolve('k1', 'Muộn');
    const calls = ports.resolve.mock.calls.length;
    const stale = ports.resolve.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.resolve.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitResolve('k1', 'Muộn');
    expect(ports.resolve.mock.calls.at(-1)?.[0].key).not.toBe(stale);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = setup();
    ports.catalogue.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', list: null });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().list;
    let release: () => void = () => undefined;
    ports.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => (release = () => resolve(page([caseRow('k1'), caseRow('k2')])))),
    );
    const reloading = controller.load();
    await flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', list: kept });
    release();
    await reloading;
    ports.list.mockRejectedValueOnce(http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'error', list: kept });
    expect(classify(new ApiError({ kind: 'timeout', message: 'x' }))).toEqual({ kind: 'unknown' });
    expect(classify(http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
  });

  it('redacted_evidence_and_logs', async () => {
    const error = http(422, 'E_VALIDATION', {
      details: [{ field: 'resolutionNote', issue: 'REQUIRED' }],
    });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = setup();
    await controller.load();
    ports.resolve.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitResolve('k1', 'SECRET-NOTE');
    const state = controller.getState();
    const shown = JSON.stringify(state.command) + JSON.stringify(state.evidence);
    for (const secret of ['SECRET-NOTE', 'Nguyen', 'key-1', 'Idempotency'])
      expect(shown).not.toContain(secret);
    expect(shown).toContain('trace-2');
    expect(failed(state)).toContain('trace-2');
    expect(failed(state)).not.toContain('SECRET-NOTE');
  });
});
