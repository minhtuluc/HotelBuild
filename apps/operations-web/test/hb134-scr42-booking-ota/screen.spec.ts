import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { formatMoney } from '@pinehill/ui-web';
import type { ControllerState } from '../../src/features/hb134-scr42-booking-ota/controller';
import { classify, evidenceOf } from '../../src/features/hb134-scr42-booking-ota/model';
import { CommandStatus, ReadBanner } from '../../src/features/hb134-scr42-booking-ota/status';
import { OtaTable } from '../../src/features/hb134-scr42-booking-ota/table';
import { ACCOUNTANT, MANAGER, OWNER, booking, flush, http, page, setup } from './fixtures';

const noop = () => undefined;
const table = (state: ControllerState, canFlag = true) =>
  renderToStaticMarkup(
    createElement(OtaTable, {
      list: state.list,
      canFlag,
      busy: false,
      serverIssues: [],
      onMore: noop,
      onFlag: noop,
    }),
  );
const reason = { flagged: true, reason: ' Trùng mã ' };

describe('HB-134 SCR-42', () => {
  it('ota_intake_list_projection', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page(
        [
          booking('b1', { status: 'PENDING', bookingId: null }),
          booking('b2', { status: 'PROCESSED' }),
          booking('b3', { duplicate: true, flagged: true, flagReason: 'Trùng khách' }),
        ],
        'next-1',
      ),
    );
    await controller.load();
    const markup = table(controller.getState());
    // Đang tiếp nhận tách khỏi đã xử lý; booking chưa gắn hiện rõ là chưa gắn.
    expect(markup).toContain('Đang tiếp nhận (PENDING)');
    expect(markup).toContain('Đã xử lý (PROCESSED)');
    expect(markup).toContain('Chưa gắn booking');
    expect(markup).toContain('Trùng hash (máy chủ đối chiếu)');
    expect(markup).toContain('Đã gắn cờ nghi trùng: Trùng khách');
    expect(markup).toContain('Tải thêm');
    // Bộ lọc đi nguyên sang API; phân trang bằng cursor và giữ các dòng đã có.
    await controller.applyFilter({
      status: 'FAILED',
      q: ' OTA-9 ',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(ports.list.mock.calls.at(-1)?.[1]).toEqual({
      status: 'FAILED',
      q: ' OTA-9 ',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    ports.list.mockResolvedValueOnce(page([booking('b1')], 'next-2'));
    await controller.load();
    ports.list.mockResolvedValueOnce(page([booking('b9')]));
    await controller.loadMore();
    expect(ports.list.mock.calls.at(-1)?.[2]).toBe('next-2');
    expect(controller.getState().list?.rows.map((row) => row.id)).toEqual(['b1', 'b9']);
    // Bộ lọc sai hình dạng không gửi request.
    const calls = ports.list.mock.calls.length;
    await controller.applyFilter({ status: null, q: '', from: '2026-11-10', to: '2026-11-01' });
    expect(ports.list.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'validation' } });
  });

  it('ota_intake_list_projection:paymentMethod', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([
        booking('b1', { paymentMethod: 'OTA_COLLECT', collectedAmount: 500_000 }),
        booking('b2', { paymentMethod: null, collectedAmount: null }),
        // Máy chủ cũ chưa có hai trường: vẫn hiển thị được, không vỡ bảng.
        booking('b3'),
      ]),
    );
    await controller.load();
    const markup = table(controller.getState());
    expect(markup).toContain('OTA thu hộ');
    expect(markup).toContain(`Đã ghi sổ: ${formatMoney(500_000)}`);
    // Chỉ đúng một dòng có khoản thu; số tiền là số máy chủ trả, không phép tính nào ở giao diện.
    expect(markup.match(/Đã ghi sổ/g)).toHaveLength(1);
    expect(markup).not.toContain('undefined');
    expect(Object.keys(ports)).not.toContain('payment');
  });

  it('confirmed_ota_oversell_case_link', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([booking('b1', { oversold: true, status: 'PROCESSED' }), booking('b2')]),
    );
    await controller.load();
    const markup = table(controller.getState());
    // Vượt tồn vẫn nhận, chỉ cảnh báo đối soát: không có nút từ chối, không tự mở case.
    expect(markup).toContain('Vượt tồn (oversold): cảnh báo đối soát, vẫn nhận');
    expect(markup).not.toContain('Từ chối');
    expect(ports.flag).not.toHaveBeenCalled();
    expect(markup.match(/Vượt tồn/g)).toHaveLength(1);
  });

  it('confirmed_ota_oversell_case_link:caseLink', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([
        booking('b1', { oversold: true, overbookingCaseId: 'case-9' }),
        booking('b2', { oversold: true, overbookingCaseId: null }),
        booking('b3'),
      ]),
    );
    await controller.load();
    const markup = table(controller.getState());
    // Liên kết đi tới đúng case do máy chủ chỉ ra (cùng đích với SCR-43); không tự mở case, không gọi lệnh nào.
    expect(markup).toContain('href="/overbooking/relocation?caseId=case-9"');
    expect(markup.match(/Mở case để điều chuyển/g)).toHaveLength(1);
    expect(ports.flag).not.toHaveBeenCalled();
  });

  it('ota_cancellation_policy_projection', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([booking('b1', { eventType: 'booking.cancelled', errorCode: 'E_CHAN_POLICY' })]),
    );
    await controller.load();
    const markup = table(controller.getState());
    expect(markup).toContain('Huỷ (OTA)');
    expect(markup).toContain('E_CHAN_POLICY');
    // Không có bảng BR-CANCEL và không có lệnh hoàn tiền nào phát sinh từ UI.
    expect(markup).not.toMatch(/hoàn tiền|refund/i);
    expect(Object.keys(ports)).not.toContain('refund');
  });

  it('ota_cancellation_policy_projection:channelPolicyCode', async () => {
    const { controller, ports } = setup();
    ports.list.mockResolvedValueOnce(
      page([
        booking('b1', { eventType: 'booking.cancelled', channelPolicyCode: 'OTA_CHANNEL' }),
        // Booking chưa có sự kiện inbox khớp: không bịa loại sự kiện.
        booking('b2', { eventType: null, providerEventId: null }),
      ]),
    );
    await controller.load();
    const markup = table(controller.getState());
    expect(markup).toContain('OTA_CHANNEL');
    expect(markup).toContain('Chính sách huỷ (kênh)');
    expect(markup).not.toContain('null');
    expect(markup).not.toMatch(/hoàn tiền|refund/i);
    expect(Object.keys(ports)).not.toContain('refund');
  });

  it('suspected_duplicate_contract_gate', async () => {
    const { controller, ports } = setup();
    await controller.load();
    await controller.submitFlag('b1', reason);
    const intent = ports.flag.mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      channelId: 'c1',
      bookingId: 'b1',
      body: { flagged: true, reason: 'Trùng mã' },
      ifMatch: '"4"',
    });
    // Chỉ thay đúng dòng bằng bản máy chủ xác nhận; không có lệnh nào khác (không booking/tiền mới).
    expect(controller.getState().list?.rows.find((row) => row.id === 'b1')).toMatchObject({
      flagged: true,
      flagReason: 'Trùng mã',
    });
    expect(ports.flag).toHaveBeenCalledTimes(1);
    expect(Object.keys(intent?.body ?? {}).sort()).toEqual(['flagged', 'reason']);
    // Lý do bắt buộc; không gửi request khi thiếu.
    await controller.submitFlag('b2', { flagged: true, reason: '  ' });
    expect(ports.flag).toHaveBeenCalledTimes(1);
    expect(controller.getState().command).toMatchObject({
      failure: { kind: 'validation', issues: [{ field: 'reason', issue: 'REQUIRED' }] },
    });
    // Dòng không còn trong danh sách đã đọc: không đoán If-Match.
    await controller.submitFlag('b-missing', reason);
    expect(ports.flag).toHaveBeenCalledTimes(1);
  });

  it('ota_booking_scope_denied', async () => {
    const { controller, ports } = setup(ACCOUNTANT);
    await controller.load();
    // ACCOUNTANT không kế thừa quyền hàng đợi: không nút gắn cờ, lệnh bị chặn tại chỗ.
    expect(table(controller.getState(), false)).not.toContain('hb134-flag-');
    await controller.submitFlag('b1', reason);
    expect(ports.flag).not.toHaveBeenCalled();
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'forbidden' } });
    // 403 từ máy chủ: không còn tên/mã nào trên màn hình.
    const owner = setup(OWNER);
    await owner.controller.load();
    expect(table(owner.controller.getState())).toContain('N*** V*** A');
    owner.ports.list.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await owner.controller.load();
    const state = owner.controller.getState();
    expect(state).toMatchObject({ phase: 'forbidden', list: null, channels: [] });
    expect(table(state)).not.toContain('N*** V*** A');
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = setup();
    await controller.load();
    let release: (value: ReturnType<typeof page>) => void = () => undefined;
    ports.list.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const stale = controller.select('c2');
    expect(controller.getState()).toMatchObject({ channelId: 'c2', list: null });
    await flush();
    ports.list.mockResolvedValueOnce(page([booking('fresh')]));
    await controller.load();
    release(page([booking('old')]));
    await stale;
    expect(controller.getState().list?.rows.map((row) => row.id)).toEqual(['fresh']);
    ports.flag.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitFlag('fresh', reason).catch(noop);
    ports.list.mockRejectedValueOnce(http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'expired', list: null, pending: false });
    ports.list.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState().phase).toBe('forbidden');
    controller.expire();
    expect(controller.getState()).toMatchObject({ phase: 'expired', actor: null });
    // Đổi người dùng giữa chừng: bỏ ý định chưa rõ của người trước.
    const swap = setup(OWNER);
    await swap.controller.load();
    swap.ports.flag.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await swap.controller.submitFlag('b1', reason);
    expect(swap.controller.getState().pending).toBe(true);
    swap.ports.actor.mockResolvedValueOnce(MANAGER);
    await swap.controller.load();
    expect(swap.controller.getState().pending).toBe(false);
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = setup();
    await controller.load();
    ports.flag.mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'timeout' }));
    await controller.submitFlag('b1', reason);
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    // Ý định khác khi còn lệnh chưa rõ kết quả bị chặn, không gửi gì ra mạng.
    await controller.submitFlag('b2', reason);
    expect(ports.flag).toHaveBeenCalledTimes(1);
    await controller.retry();
    const [first, second] = ports.flag.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    expect(first?.ifMatch).toBe('"4"');
    // 409 đang xử lý: giữ khoá, gửi lại đúng ý định.
    ports.flag.mockRejectedValueOnce(
      http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitFlag('b2', { flagged: true, reason: 'Khác' });
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    const held = ports.flag.mock.calls.at(-1)?.[0].key;
    await controller.retry();
    expect(ports.flag.mock.calls.at(-1)?.[0].key).toBe(held);
    // 412/428: nhả ý định và đọc lại danh sách, không tự gửi lại với phiên bản mới.
    ports.flag.mockRejectedValueOnce(http(412, 'E_GEN_VERSION_CONFLICT'));
    const reads = ports.list.mock.calls.length;
    const sends = ports.flag.mock.calls.length;
    await controller.submitFlag('b1', { flagged: true, reason: 'Sau' });
    await flush();
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'conflict' } },
    });
    expect(ports.list.mock.calls.length).toBeGreaterThan(reads);
    expect(ports.flag.mock.calls.length).toBe(sends + 1);
    ports.flag.mockRejectedValueOnce(http(428, 'E_GEN_PRECONDITION_REQUIRED'));
    await controller.submitFlag('b1', { flagged: true, reason: 'Sau nữa' });
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'conflict' } });
    // Quá 24 giờ: không gửi lại mù; bỏ có chủ đích mới được tạo khoá mới.
    ports.flag.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.submitFlag('b1', { flagged: true, reason: 'Muộn' });
    const calls = ports.flag.mock.calls.length;
    const stale = ports.flag.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.flag.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitFlag('b1', { flagged: true, reason: 'Muộn' });
    expect(ports.flag.mock.calls.at(-1)?.[0].key).not.toBe(stale);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = setup();
    ports.channels.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', list: null, channels: [] });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().list;
    let release: () => void = () => undefined;
    ports.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => (release = () => resolve(page([booking('b1'), booking('b2')])))),
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
    ports.list.mockResolvedValueOnce(page([]));
    await controller.load();
    expect(table(controller.getState())).toContain('Không có booking OTA nào');
  });

  it('redacted_evidence_and_logs', async () => {
    const error = http(422, 'E_VALIDATION', { details: [{ field: 'reason', issue: 'REQUIRED' }] });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = setup();
    await controller.load();
    ports.flag.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitFlag('b1', { flagged: true, reason: 'SECRET-REASON' });
    const state = controller.getState();
    const shown = JSON.stringify(state.command) + JSON.stringify(state.evidence);
    for (const secret of ['SECRET-REASON', 'Nguyen', 'key-1', 'Idempotency'])
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
    expect(markup).not.toContain('SECRET-REASON');
  });
});
