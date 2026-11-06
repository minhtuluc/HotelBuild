import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ControllerState } from '../../src/features/hb133-scr41-giam-sat-dong-bo/controller';
import { classify, evidenceOf } from '../../src/features/hb133-scr41-giam-sat-dong-bo/model';
import { OutboxSection } from '../../src/features/hb133-scr41-giam-sat-dong-bo/outbox';
import { StatusPanel } from '../../src/features/hb133-scr41-giam-sat-dong-bo/panels';
import {
  CommandStatus,
  OperationPanel,
  ReadBanner,
} from '../../src/features/hb133-scr41-giam-sat-dong-bo/status';
import {
  DESK,
  MANAGER,
  OWNER,
  delivery,
  flush,
  http,
  page,
  ref,
  setup,
  statusView,
} from './fixtures';

const noop = () => undefined;
const render = (state: ControllerState) =>
  renderToStaticMarkup(
    createElement(OperationPanel, {
      operation: state.operation,
      onCheck: noop,
      onRetry: noop,
      canRetry: true,
    }),
  );

describe('HB-133 SCR-41', () => {
  it('degraded_channel_projection', () => {
    const degraded = statusView({
      syncStatus: 'DEGRADED',
      consecutiveFailures: 3,
      lastError: 'Synthetic timeout',
      history: [{ at: '2026-11-10T00:30:00.000Z', outcome: 'FAILURE', error: 'Synthetic timeout' }],
    });
    const markup = renderToStaticMarkup(createElement(StatusPanel, { status: degraded }));
    expect(markup).toContain('DEGRADED');
    expect(markup).toContain('(máy chủ đếm): 3');
    expect(markup).toContain('Lỗi gần nhất: Synthetic timeout');
    // Fixture có 3 lỗi nhưng máy chủ báo OK: UI không tự đếm hay tự đặt DEGRADED.
    const inconsistent = renderToStaticMarkup(
      createElement(StatusPanel, { status: statusView({ consecutiveFailures: 3 }) }),
    );
    expect(inconsistent).toContain('OK —');
    expect(inconsistent).not.toContain('DEGRADED');
    // Chưa từng đồng bộ không bị hiểu thành "vừa đồng bộ".
    const never = renderToStaticMarkup(
      createElement(StatusPanel, { status: statusView({ lastSyncAt: null, lastSuccessAt: null }) }),
    );
    expect(never).toContain('Lần đồng bộ gần nhất: chưa có');
  });

  it('outbox_scoped_replay', async () => {
    const { controller, ports } = setup(MANAGER);
    await controller.load();
    const props = {
      deliveries: controller.getState().deliveries,
      filter: null,
      busy: false,
      onFilter: noop,
      onMore: noop,
      onReplay: noop,
    };
    const manager = renderToStaticMarkup(
      createElement(OutboxSection, { ...props, canReplay: true }),
    );
    expect(manager).toContain('hb133-replay-d1');
    expect(manager).not.toContain('hb133-replay-d2');
    expect(manager).not.toContain('payload');
    const desk = renderToStaticMarkup(createElement(OutboxSection, { ...props, canReplay: false }));
    expect(desk).not.toContain('hb133-replay');
    await controller.submitRetry('d1');
    expect(ports.retry.mock.calls[0]?.[0]).toMatchObject({ channelId: 'c1', deliveryId: 'd1' });
    const front = setup(DESK);
    await front.controller.load();
    await front.controller.submitRetry('d1');
    expect(front.ports.retry).not.toHaveBeenCalled();
    expect(front.controller.getState().command).toMatchObject({ failure: { kind: 'forbidden' } });
    // Phân trang bằng cursor, giữ các dòng đã có.
    ports.deliveries.mockResolvedValueOnce(page([delivery('d1', 'DEAD_LETTER')], 'next-1'));
    await controller.load();
    ports.deliveries.mockResolvedValueOnce(page([delivery('d3', 'PENDING')]));
    await controller.loadMore();
    expect(ports.deliveries.mock.calls.at(-1)?.[1]).toMatchObject({ cursor: 'next-1' });
    expect(controller.getState().deliveries?.rows.map((row) => row.id)).toEqual(['d1', 'd3']);
  });

  it('sync_202_operation_lifecycle', async () => {
    const { controller, ports, tick } = setup();
    await controller.load();
    ports.operation
      .mockResolvedValueOnce({ operationId: 'op1', status: 'RUNNING' })
      .mockResolvedValueOnce({ operationId: 'op1', status: 'SUCCEEDED', resultRef: 'r1' });
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    const pending = render(controller.getState());
    expect(controller.getState().operation).toMatchObject({ id: 'op1', status: 'PENDING' });
    expect(pending).toContain('chưa phải đã đồng bộ');
    expect(pending).not.toContain('hoàn tất');
    const statusCalls = ports.status.mock.calls.length;
    await tick();
    expect(controller.getState().operation?.status).toBe('RUNNING');
    expect(render(controller.getState())).toContain('đang chạy tác vụ');
    await tick();
    expect(controller.getState().operation?.status).toBe('SUCCEEDED');
    expect(render(controller.getState())).toContain('hoàn tất');
    // Hết poll và đọc lại số liệu từ máy chủ.
    await flush();
    expect(ports.operation).toHaveBeenCalledTimes(2);
    expect(ports.status.mock.calls.length).toBeGreaterThan(statusCalls);
    // Mất quyền giữa chừng: dừng poll và xoá tác vụ.
    ports.operation.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    await tick();
    expect(controller.getState()).toMatchObject({ phase: 'forbidden', operation: null });
    const calls = ports.operation.mock.calls.length;
    await tick();
    expect(ports.operation).toHaveBeenCalledTimes(calls);
  });

  it('sync_failed_recovery', async () => {
    const { controller, ports, tick } = setup();
    await controller.load();
    ports.operation.mockResolvedValueOnce({
      operationId: 'op1',
      status: 'FAILED',
      errorCode: 'E_CHAN_SYNC_FAILED',
      errorMessage: 'Kênh từ chối',
    });
    await controller.submitSync({ scope: 'RANGE', from: '2026-11-10', to: '2026-11-12' });
    await tick();
    const failed = render(controller.getState());
    expect(failed).toContain('Tác vụ thất bại. Các kênh khác không bị ảnh hưởng.');
    expect(failed).toContain('E_CHAN_SYNC_FAILED');
    expect(failed).toContain('Thử lại đồng bộ');
    // Thử lại = ý định mới (khoá mới) với đúng phạm vi cũ, không đổi sang FULL.
    await controller.retryFailedSync();
    const [first, second] = ports.sync.mock.calls.map(([intent]) => intent);
    expect(second?.body).toEqual(first?.body);
    expect(second?.key).not.toBe(first?.key);
    // Từ chối đồng bộ ngay ở POST: có traceId, nhả ý định.
    ports.sync.mockRejectedValueOnce(http(502, 'E_CHAN_SYNC_FAILED'));
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    const state = controller.getState();
    expect(state.command).toMatchObject({
      failure: { kind: 'syncFailed' },
      evidence: { traceId: 'trace-1' },
    });
    expect(state.pending).toBe(false);
    expect(state.status?.channelId).toBe('c1');
  });

  it('unknown_sync_result_reconcile', async () => {
    const { controller, ports, tick } = setup();
    await controller.load();
    ports.sync.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    expect(controller.getState()).toMatchObject({ pending: true, operation: null });
    await controller.retry();
    const [first, second] = ports.sync.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    // Poll mất mạng: giữ ID, không tạo sync mới; tra lại cùng ID.
    ports.operation.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await tick();
    expect(controller.getState().operation).toMatchObject({ id: 'op1', lost: true });
    expect(render(controller.getState())).toContain('Chưa tra được kết quả tác vụ');
    ports.operation.mockResolvedValueOnce({ operationId: 'op1', status: 'SUCCEEDED' });
    const checking = controller.checkOperation();
    await tick();
    await checking;
    expect(controller.getState().operation).toMatchObject({ status: 'SUCCEEDED', lost: false });
    expect(ports.sync).toHaveBeenCalledTimes(2);
    expect(ports.operation.mock.calls.every(([id]) => id === 'op1')).toBe(true);
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = setup();
    await controller.load();
    let release: (value: Awaited<ReturnType<typeof ports.status>>) => void = () => undefined;
    ports.status.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const stale = controller.select('c2');
    expect(controller.getState()).toMatchObject({
      channelId: 'c2',
      status: null,
      deliveries: null,
    });
    await flush();
    await controller.load();
    release(statusView({ channelId: 'c1', consecutiveFailures: 9 }));
    await stale;
    expect(controller.getState().status?.consecutiveFailures).toBe(0);
    // 401 và 403 khác nhau; cả hai xoá dữ liệu, ý định và tác vụ.
    ports.sync.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    expect(controller.getState().pending).toBe(true);
    ports.status.mockRejectedValueOnce(http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'expired', status: null, pending: false });
    ports.status.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'forbidden', deliveries: null });
    // OWNER và MANAGER đều có quyền đồng bộ theo bảng; vai khác thì không có nút.
    for (const actor of [OWNER, MANAGER]) {
      const each = setup(actor);
      await each.controller.load();
      await each.controller.submitSync({ scope: 'FULL', from: '', to: '' });
      expect(each.ports.sync).toHaveBeenCalledTimes(1);
    }
    const desk = setup(DESK);
    await desk.controller.load();
    await desk.controller.submitSync({ scope: 'FULL', from: '', to: '' });
    expect(desk.ports.sync).not.toHaveBeenCalled();
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = setup();
    await controller.load();
    // Lệnh không có aggregate nên không có If-Match; khoá và thân phải ổn định khi gửi lại.
    ports.retry.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitRetry('d1');
    await controller.submitRetry('d9');
    expect(ports.retry).toHaveBeenCalledTimes(1);
    await controller.retry();
    const [first, second] = ports.retry.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    ports.sync.mockRejectedValueOnce(
      http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    const held = ports.sync.mock.calls.at(-1)?.[0].key;
    await controller.retry();
    expect(ports.sync.mock.calls.at(-1)?.[0].key).toBe(held);
    ports.sync.mockRejectedValueOnce(http(412, 'E_GEN_VERSION_CONFLICT'));
    await controller.submitSync({ scope: 'RANGE', from: '2026-11-10', to: '2026-11-11' });
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'conflict' } },
    });
    ports.sync.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    const calls = ports.sync.mock.calls.length;
    const stale = ports.sync.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.sync.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitSync({ scope: 'FULL', from: '', to: '' });
    expect(ports.sync.mock.calls.at(-1)?.[0].key).not.toBe(stale);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = setup();
    ports.channels.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', status: null, channels: [] });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().deliveries;
    let release: () => void = () => undefined;
    ports.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(statusView());
        }),
    );
    const reloading = controller.load();
    await flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', deliveries: kept });
    release();
    await reloading;
    ports.status.mockRejectedValueOnce(http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'error', deliveries: kept });
    expect(classify(new ApiError({ kind: 'timeout', message: 'x' }))).toEqual({ kind: 'unknown' });
    expect(classify(http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
    ports.deliveries.mockResolvedValueOnce(page([]));
    await controller.load();
    expect(
      renderToStaticMarkup(
        createElement(OutboxSection, {
          deliveries: controller.getState().deliveries,
          filter: null,
          canReplay: true,
          busy: false,
          onFilter: noop,
          onMore: noop,
          onReplay: noop,
        }),
      ),
    ).toContain('Chưa có bản tin nào');
  });

  it('redacted_evidence_and_logs', async () => {
    const error = http(422, 'E_VALIDATION', {
      details: [{ field: 'from', issue: 'INVALID_DATE' }],
    });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = setup();
    await controller.load();
    ports.sync.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitSync({ scope: 'RANGE', from: '2026-11-10', to: '2026-11-11' });
    const state = controller.getState();
    const shown = JSON.stringify(state.command) + JSON.stringify(state.evidence);
    for (const secret of ['2026-11-10', 'Nguyen', 'key-1', 'Idempotency'])
      expect(shown).not.toContain(secret);
    expect(shown).toContain('trace-2');
    const markup = renderToStaticMarkup(
      createElement(CommandStatus, {
        command: state.command,
        pending: state.pending,
        actions: { retry: noop, lookup: noop, discard: noop },
      }),
    );
    expect(markup).toContain('trace-2');
    expect(markup).not.toContain('Nguyen');
    expect(ref().statusUrl).not.toContain('token');
  });
});
