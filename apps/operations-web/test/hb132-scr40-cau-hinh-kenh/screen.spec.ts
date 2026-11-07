import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ChannelSummary, SalesClosureRow } from '@pinehill/contracts';
import { mappingKey } from '../../src/features/hb132-scr40-cau-hinh-kenh/controller';
import {
  classify,
  evidenceOf,
  mappingIssues,
} from '../../src/features/hb132-scr40-cau-hinh-kenh/model';
import { ClosureTable } from '../../src/features/hb132-scr40-cau-hinh-kenh/parts';
import type { ConfigData } from '../../src/features/hb132-scr40-cau-hinh-kenh/port';
import { Projection } from '../../src/features/hb132-scr40-cau-hinh-kenh/screen';
import { CommandStatus, ReadBanner } from '../../src/features/hb132-scr40-cau-hinh-kenh/status';
import { DESK, DRAFT, MANAGER, OWNER, SELECTION, dataWith, http, setup } from './fixtures';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HB-132 SCR-40', () => {
  it('server_configuration_projection', async () => {
    const { controller } = setup();
    await controller.load();
    const markup = renderToStaticMarkup(
      createElement(Projection, { state: controller.getState() }),
    );
    expect(markup).toContain('5%');
    expect(markup).toContain('Đơn vị bán đang hoạt động: 6');
    for (const row of controller.getState().data?.rows ?? []) {
      expect(markup).toContain(`>${row.allotment}<`);
      expect(markup).toContain(`>${row.used}<`);
    }
    // Không cộng allotment, không tự tính trần/tồn: 3 + 4 không xuất hiện như một số được tính.
    expect(markup).not.toContain('>7<');
    const unknown = setup(OWNER, dataWith({ units: undefined }));
    await unknown.controller.load();
    expect(
      renderToStaticMarkup(createElement(Projection, { state: unknown.controller.getState() })),
    ).toContain('chưa trả số đơn vị bán');
  });

  it('mapping_and_scoped_commands', async () => {
    const owner = setup();
    await owner.controller.load();
    await owner.controller.submitMapping({ ...DRAFT, allotmentPct: '140' });
    expect(owner.ports.putMapping).not.toHaveBeenCalled();
    expect(owner.controller.getState().command).toMatchObject({ failure: { kind: 'validation' } });
    expect(mappingIssues({ ...DRAFT, providerRoomTypeCode: '  ' })).toEqual([
      { field: 'providerRoomTypeCode', issue: 'REQUIRED' },
    ]);
    await owner.controller.submitMapping(DRAFT);
    await flush();
    expect(owner.ports.putMapping.mock.calls[0]?.[0]).toMatchObject({
      channelId: 'c1',
      body: {
        roomTypeId: 'rt1',
        providerRoomTypeCode: 'OTA-DORM',
        allotmentPct: 40,
        status: 'ACTIVE',
      },
      ifMatch: undefined,
    });
    expect(owner.controller.getState().confirmed[mappingKey('c1', 'rt1')]?.mapping.version).toBe(2);
    // Lỗi validation từ máy chủ gắn đúng trường và nhả ý định (không giữ khoá).
    owner.ports.putMapping.mockRejectedValueOnce(
      http(422, 'E_VALIDATION', {
        details: [{ field: 'providerRoomTypeCode', issue: 'DUPLICATE' }],
      }),
    );
    await owner.controller.submitMapping(DRAFT);
    expect(owner.controller.getState()).toMatchObject({
      pending: false,
      command: {
        failure: {
          kind: 'validation',
          issues: [{ field: 'providerRoomTypeCode', issue: 'DUPLICATE' }],
        },
      },
    });
    // MANAGER đóng bán được nhưng không cấu hình ánh xạ; FRONT_DESK không có lệnh nào.
    const manager = setup(MANAGER);
    await manager.controller.load();
    await manager.controller.submitMapping(DRAFT);
    expect(manager.ports.putMapping).not.toHaveBeenCalled();
    await manager.controller.submitClosure({
      roomTypeId: 'rt1',
      from: '2026-11-10',
      to: '2026-11-11',
      reason: 'Bảo trì',
      closed: true,
    });
    expect(manager.ports.closeSales.mock.calls[0]?.[0].body).toEqual({
      roomTypeId: 'rt1',
      from: '2026-11-10',
      to: '2026-11-11',
      reason: 'Bảo trì',
      closed: true,
    });
    const desk = setup(DESK);
    await desk.controller.load();
    await desk.controller.submitClosure({
      roomTypeId: 'rt1',
      from: '2026-11-10',
      to: '2026-11-10',
      reason: 'x',
      closed: true,
    });
    expect(desk.ports.closeSales).not.toHaveBeenCalled();
    expect(desk.controller.getState().command).toMatchObject({ failure: { kind: 'forbidden' } });
  });

  it('overbook_limit_error', async () => {
    const { controller, ports } = setup(OWNER, dataWith({ pct: 0 }));
    await controller.load();
    expect(
      renderToStaticMarkup(createElement(Projection, { state: controller.getState() })),
    ).toContain('0%');
    ports.putMapping.mockRejectedValueOnce(http(409, 'E_OVER_LIMIT_EXCEEDED'));
    const before = controller.getState().data;
    await controller.submitMapping(DRAFT);
    const state = controller.getState();
    expect(state.command).toMatchObject({ kind: 'failed', failure: { kind: 'overLimit' } });
    expect(state.data).toBe(before);
    expect(
      renderToStaticMarkup(
        createElement(CommandStatus, {
          command: state.command,
          pending: state.pending,
          actions: { retry: () => undefined, lookup: () => undefined, discard: () => undefined },
        }),
      ),
    ).toContain('Vượt trần bán vượt của cơ sở');
  });

  it('server_sales_closure_states', async () => {
    const cell = (closed: boolean, reopenedAt: string | null, closedAt: string | null) => ({
      closed,
      reason: closed ? 'Lý do máy chủ' : null,
      closedAt,
      reopenedAt,
    });
    const rows: SalesClosureRow[] = [
      {
        roomTypeId: 'rt1',
        date: '2026-11-10',
        closed: true,
        closureSource: 'MANUAL',
        manual: cell(true, null, '2026-11-09T01:00:00.000Z'),
        automatic: cell(false, null, null),
      },
      {
        roomTypeId: 'rt1',
        date: '2026-11-11',
        closed: true,
        closureSource: 'AUTOMATIC',
        manual: cell(false, null, null),
        automatic: cell(true, null, '2026-11-09T02:00:00.000Z'),
      },
      {
        roomTypeId: 'rt1',
        date: '2026-11-12',
        closed: true,
        closureSource: 'AUTOMATIC',
        manual: cell(false, '2026-11-09T03:00:00.000Z', null),
        automatic: cell(true, null, '2026-11-09T02:00:00.000Z'),
      },
    ];
    const markup = renderToStaticMarkup(createElement(ClosureTable, { rows }));
    expect(markup).toContain('(MANUAL)');
    expect(markup).toContain('(AUTOMATIC)');
    // Mở lại thủ công không làm hàng tự động mở: hiệu lực vẫn là đóng, ghi riêng "mở lại".
    const reopened = markup.split('<tr>').at(-1) ?? '';
    expect(reopened).toContain('mở lại');
    expect(reopened).toContain('Đóng (AUTOMATIC)');
    const { controller, ports } = setup(MANAGER);
    await controller.load();
    ports.closeSales.mockResolvedValueOnce({ channelId: 'c1', rows });
    await controller.submitClosure({
      roomTypeId: 'rt1',
      from: '2026-11-10',
      to: '2026-11-12',
      reason: 'Mở lại',
      closed: false,
    });
    expect(controller.getState().closure?.rows).toEqual(rows);
    expect(ports.closeSales.mock.calls[0]?.[0].body.closed).toBe(false);
  });

  it('server_rate_warning', async () => {
    const withChannel = (extra: Partial<ChannelSummary>): ConfigData => {
      const base = dataWith();
      return { ...base, channels: base.channels.map((row) => ({ ...row, ...extra })) };
    };
    const show = async (data: ConfigData): Promise<string> => {
      const { controller } = setup(OWNER, data);
      await controller.load();
      return renderToStaticMarkup(createElement(Projection, { state: controller.getState() }));
    };
    const warned: NonNullable<ChannelSummary['rateWarnings']> = [
      'E_RATE_CHANNEL_PARITY',
      'E_RATE_DIRECT_BELOW_BASE',
    ];
    const markup = await show(withChannel({ rateWarnings: warned }));
    expect(markup).toContain('data-testid="hb132-rate-warning"');
    expect(markup).toContain('BR-RATE-09');
    expect(markup).toContain('dưới 1,00');
    // Nói rõ phạm vi để không bị đọc nhầm thành kết quả theo từng ngày.
    expect(markup).toContain('chưa gồm ghi đè theo cơ sở và bước kẹp sàn/trần');
    // Không có cảnh báo (rỗng hoặc vắng) thì không dựng khối cảnh báo.
    expect(await show(withChannel({ rateWarnings: [] }))).not.toContain('hb132-rate-warning');
    // Giao diện không tự so hệ số/hoa hồng: số liệu "xấu" mà máy chủ không báo thì không có cảnh báo.
    const unflagged = await show(withChannel({ multiplier: 0.5, commissionPct: 30 }));
    expect(unflagged).not.toContain('hb132-rate-warning');
    expect(unflagged).not.toContain('BR-RATE-09');
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = setup();
    await controller.load();
    let release: (value: ConfigData) => void = () => undefined;
    ports.load.mockImplementationOnce(
      (_selection, _signal) => new Promise<ConfigData>((resolve) => (release = resolve)),
    );
    const stale = controller.select({ propertyId: 'p2' });
    expect(controller.getState().data).toBeNull();
    await flush();
    const signal = ports.load.mock.calls.at(-1)?.[1];
    ports.load.mockResolvedValueOnce(dataWith({ pct: 9 }));
    await controller.load();
    expect(signal?.aborted).toBe(true);
    release(dataWith({ pct: 1 }));
    await stale;
    expect(controller.getState().data?.properties[0]?.overbookLimitPct).toBe(9);
    // 401 và 403 là hai trạng thái khác nhau, cả hai xoá dữ liệu và ý định.
    ports.load.mockRejectedValueOnce(http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'expired', data: null, pending: false });
    ports.load.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'forbidden', data: null });
    // Đổi người dùng giữa chừng: không dùng lại dữ liệu/ý định của người trước.
    const swap = setup();
    await swap.controller.load();
    swap.ports.putMapping.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'timeout' }),
    );
    await swap.controller.submitMapping(DRAFT);
    expect(swap.controller.getState().pending).toBe(true);
    swap.ports.actor.mockResolvedValueOnce(MANAGER);
    await swap.controller.load();
    expect(swap.controller.getState()).toMatchObject({ pending: false, confirmed: {} });
    swap.controller.expire();
    expect(swap.controller.getState()).toMatchObject({ phase: 'expired', data: null, actor: null });
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = setup();
    await controller.load();
    ports.putMapping.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitMapping(DRAFT);
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    // Lệnh khác khi còn lệnh chưa rõ kết quả bị chặn, không gửi gì ra mạng.
    await controller.submitMapping({ ...DRAFT, allotmentPct: '50' });
    expect(ports.putMapping).toHaveBeenCalledTimes(1);
    await controller.retry();
    await flush();
    const [first, second] = ports.putMapping.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    expect(controller.getState().pending).toBe(false);
    // Lần sửa kế tiếp mang If-Match đã đọc từ ETag của máy chủ và dùng khoá mới.
    await controller.submitMapping({ ...DRAFT, allotmentPct: '50' });
    expect(ports.putMapping.mock.calls[2]?.[0]).toMatchObject({ ifMatch: '"2"' });
    expect(ports.putMapping.mock.calls[2]?.[0].key).not.toBe(first?.key);
    // 409 đang xử lý: giữ khoá, gửi lại đúng ý định; 412: nhả ý định và đọc lại.
    ports.putMapping.mockRejectedValueOnce(
      http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitMapping({ ...DRAFT, allotmentPct: '60' });
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    const loads = ports.load.mock.calls.length;
    const heldKey = ports.putMapping.mock.calls.at(-1)?.[0].key;
    await controller.retry();
    await flush();
    expect(ports.putMapping.mock.calls.at(-1)?.[0].key).toBe(heldKey);
    ports.putMapping.mockRejectedValueOnce(http(412, 'E_GEN_VERSION_CONFLICT'));
    await controller.submitMapping({ ...DRAFT, allotmentPct: '70' });
    await flush();
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'conflict' } },
    });
    expect(ports.load.mock.calls.length).toBeGreaterThan(loads);
    // Quá 24 giờ: không gửi lại mù; chỉ sau khi bỏ có chủ đích mới được tạo khoá mới.
    ports.putMapping.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.submitMapping({ ...DRAFT, allotmentPct: '80' });
    const calls = ports.putMapping.mock.calls.length;
    const staleKey = ports.putMapping.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.putMapping.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitMapping({ ...DRAFT, allotmentPct: '80' });
    expect(ports.putMapping.mock.calls.at(-1)?.[0].key).not.toBe(staleKey);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = setup();
    ports.load.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    // Lỗi đọc đầu tiên không phải danh sách rỗng: không có dữ liệu và có băng lỗi.
    expect(controller.getState()).toMatchObject({ phase: 'offline', data: null });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    expect(controller.getState().phase).toBe('ready');
    const kept = controller.getState().data;
    let release: (value: ConfigData) => void = () => undefined;
    ports.load.mockImplementationOnce(
      () => new Promise<ConfigData>((resolve) => (release = resolve)),
    );
    const reloading = controller.load();
    await flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', data: kept });
    release(dataWith());
    await reloading;
    ports.load.mockRejectedValueOnce(http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'error', data: kept });
    // Kết quả ghi không rõ không phải thất bại chắc chắn.
    expect(classify(new ApiError({ kind: 'timeout', message: 'x' }))).toEqual({ kind: 'unknown' });
    expect(classify(http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
    // Danh mục rỗng: có dữ liệu nhưng chưa chọn được kênh/loại phòng.
    const empty = setup(OWNER, {
      ...dataWith(),
      channels: [],
      selection: { ...SELECTION, propertyId: 'p1' },
      rows: [],
    });
    await empty.controller.load();
    expect(empty.controller.getState().data?.selection.channelId).toBeNull();
  });

  it('redacted_evidence_and_logs', async () => {
    const error = http(422, 'E_VALIDATION', {
      details: [{ field: 'providerRoomTypeCode', issue: 'DUPLICATE' }],
    });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = setup();
    await controller.load();
    ports.putMapping.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitMapping({
      ...DRAFT,
      providerRoomTypeCode: 'SECRET-CODE',
      externalRatePlanCode: 'SECRET-RATE',
    });
    const shown =
      JSON.stringify(controller.getState().command) +
      JSON.stringify(controller.getState().evidence);
    for (const secret of ['SECRET-CODE', 'SECRET-RATE', 'Nguyen', 'Idempotency'])
      expect(shown).not.toContain(secret);
    expect(shown).toContain('trace-2');
  });
});
