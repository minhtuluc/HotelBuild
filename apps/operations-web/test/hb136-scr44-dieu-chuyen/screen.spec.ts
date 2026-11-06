import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CandidatesTable, Ladder } from '../../src/features/hb136-scr44-dieu-chuyen/candidates';
import { classify, evidenceOf } from '../../src/features/hb136-scr44-dieu-chuyen/model';
import { OptionsPanel } from '../../src/features/hb136-scr44-dieu-chuyen/options';
import { ReadBanner } from '../../src/features/hb136-scr44-dieu-chuyen/status';
import {
  ACCOUNTANT,
  DESK,
  MANAGER,
  OWNER,
  PARAMS,
  candidate,
  detail,
  flush,
  http,
  ladder,
  moveView,
  optionsView,
  roomMove,
  setup,
  timeout,
} from './fixtures';
import { failed, noop, panel } from './render';

const draft = { compensationAmount: '300000', transportCost: '50000', note: '' };
const desk = { ...PARAMS };

describe('HB-136 SCR-44', () => {
  it('complete_keep_score_table', async () => {
    const rows = [
      candidate(1, 'First*** A', 12),
      candidate(2, 'Second*** B', 80),
      candidate(3, 'Third*** C', 30),
      candidate(4, 'Fourth*** D', 99),
      candidate(5, 'Fifth*** E', 7),
    ];
    const markup = renderToStaticMarkup(createElement(CandidatesTable, { rows }));
    // Đủ 5 dòng đúng thứ tự máy chủ (không sắp lại theo điểm, không cắt top-N) và đủ cột phân rã.
    const order = rows.map((row) => markup.indexOf(row.guestNameMasked));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
    for (const heading of ['Nhóm ưu tiên', 'Tổng điểm', 'Hạng thành viên', 'Tạo lúc', 'Seq']) {
      expect(markup).toContain(heading);
    }
    expect(markup).toContain('WEAK');
    expect(markup).toContain('>101<');
    // Quản lý đọc ca đầy đủ; lễ tân không gọi đường đọc bảng xếp hạng và không giữ PII của booking khác.
    const manager = setup(MANAGER);
    await manager.controller.load();
    expect(manager.ports.caseDetail).toHaveBeenCalledTimes(1);
    expect(manager.controller.getState().detail?.candidates).toHaveLength(2);
    const front = setup(DESK);
    await front.controller.load();
    expect(front.ports.caseDetail).not.toHaveBeenCalled();
    expect(front.ports.options).toHaveBeenCalledWith('bk-1', 'k1');
    expect(front.controller.getState().detail).toBeNull();
    expect(front.controller.getState().options).not.toBeNull();
    expect(JSON.stringify(front.controller.getState())).not.toContain('A*** B');
  });

  it('server_ladder_unavailable_step_three', () => {
    const markup = renderToStaticMarkup(createElement(Ladder, { steps: ladder }));
    expect(markup.indexOf('hb136-step-1')).toBeLessThan(markup.indexOf('hb136-step-2'));
    expect(markup.indexOf('hb136-step-2')).toBeLessThan(markup.indexOf('hb136-step-3'));
    expect(markup.indexOf('hb136-step-3')).toBeLessThan(markup.indexOf('hb136-step-4'));
    const step3 = markup.slice(markup.indexOf('hb136-step-3'), markup.indexOf('hb136-step-4'));
    expect(step3).toContain('Không khả dụng: Cơ sở cách nhau 160–300 km');
    expect(step3).not.toContain('Khả dụng (');
    // Bậc 1/2/4 khả dụng đúng như máy chủ trả; UI không bật bậc 3.
    expect(markup.match(/Khả dụng \(/g)).toHaveLength(3);
  });

  it('impact_price_lock_projection', () => {
    const markup = renderToStaticMarkup(
      createElement(OptionsPanel, {
        options: optionsView(),
        bookingRoomId: 'br-1',
        serverIssues: [],
        busy: false,
        onCreate: noop,
      }),
    );
    expect(markup).toContain('>300000<');
    expect(markup).toContain('>50000<');
    expect(markup).toContain('Giữ giá đã chốt');
    expect(markup).not.toMatch(/chênh lệch|nâng hạng/i);
    expect(markup).toContain('room-9');
    expect(markup).toContain('Chưa có thông tin mất ban công');
  });

  it.todo(
    'impact_price_lock_projection:loss — BLOCKED: hợp đồng HB-120 chưa có trường mất ban công/phòng thông nhau/giảm sức chứa; chỉ hiện phòng nguồn/đích, giữ giá và số tiền',
  );

  it('checked_in_and_approval_permissions', async () => {
    const roles = [
      [MANAGER, ['hb136-approve']],
      [OWNER, ['hb136-approve']],
      [DESK, ['hb136-execute']],
      [ACCOUNTANT, []],
    ] as const;
    for (const [actor, buttons] of roles) {
      const { controller, ports } = setup(actor, { ...PARAMS, moveId: 'mv1' });
      ports.move.mockResolvedValue({
        view: moveView({ allowedActions: ['APPROVE', 'EXECUTE'] }),
        etag: '"3"',
      });
      await controller.load();
      const markup = panel(controller.getState());
      for (const id of ['hb136-approve', 'hb136-execute'])
        expect(markup.includes(`data-testid="${id}"`)).toBe(buttons.some((item) => item === id));
    }
    // Máy chủ không cho EXECUTE thì nút không hiện dù vai lễ tân.
    const { controller, ports } = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    ports.move.mockResolvedValue({ view: moveView({ allowedActions: [] }), etag: '"3"' });
    await controller.load();
    expect(panel(controller.getState())).not.toContain('data-testid="hb136-execute"');
    expect(panel(controller.getState())).toContain('không có');
    // CHECKED_IN bị chặn là từ chối của lệnh, không phải mất phiên: giữ dữ liệu, nhả ý định.
    ports.create.mockRejectedValueOnce(http(409, 'E_OVER_MOVE_NOT_ALLOWED'));
    await controller.load();
    await controller.submitCreate({
      optionIndex: 0,
      reason: 'Khách đang ở',
      granted: true,
      channel: 'PHONE',
      walkOutDocNo: '',
      guestSignatureRef: '',
      staffSignatureRef: '',
    });
    expect(controller.getState()).toMatchObject({
      phase: 'ready',
      pending: false,
      command: { failure: { kind: 'moveNotAllowed' } },
    });
    expect(failed(controller.getState())).toContain('E_OVER_MOVE_NOT_ALLOWED');
    // 403 nghiệp vụ (cần duyệt) khác 403 mất quyền.
    expect(classify(http(403, 'E_OVER_APPROVAL_REQUIRED'))).toEqual({ kind: 'approvalRequired' });
    expect(classify(http(403, 'E_RBAC_FORBIDDEN'))).toEqual({ kind: 'forbidden' });
    expect(classify(http(401, 'E_AUTH_PIN_REQUIRED'))).toEqual({ kind: 'pinRequired' });
  });

  it('move_approval_execute_idempotency', async () => {
    const approver = setup(MANAGER, { ...PARAMS, moveId: 'mv1' });
    await approver.controller.load();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    approver.ports.approve.mockImplementationOnce(async () => {
      await gate;
      return roomMove();
    });
    const first = approver.controller.submitApprove(draft, '123456');
    await flush();
    await approver.controller.submitApprove(draft, '123456');
    release();
    await first;
    expect(approver.ports.approve).toHaveBeenCalledTimes(1);
    expect(approver.ports.verifyPin).toHaveBeenCalledWith('123456', 'bk-1');
    expect(approver.ports.approve.mock.calls[0]?.[0]).toMatchObject({
      moveId: 'mv1',
      ifMatch: '"3"',
      body: { compensationAmount: 300000, transportCost: 50000 },
    });
    expect(approver.ports.clearPin).toHaveBeenCalled();
    // Thực hiện: timeout giữ khoá, không đổi PIN lại, gửi lại đúng ý định; chỉ EXECUTED mới hoàn tất.
    const { controller, ports } = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    ports.move.mockResolvedValue({
      view: moveView({ status: 'APPROVED', allowedActions: ['EXECUTE'] }),
      etag: '"4"',
    });
    await controller.load();
    ports.execute.mockRejectedValueOnce(timeout());
    await controller.submitExecute('123456');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    await controller.submitExecute('123456');
    const [one, two] = ports.execute.mock.calls.map(([intent]) => intent);
    expect(two).toEqual(one);
    expect(one?.ifMatch).toBe('"4"');
    expect(ports.verifyPin).toHaveBeenCalledTimes(1);
    expect(panel(controller.getState())).toContain('Chưa hoàn tất');
    ports.move.mockResolvedValue({
      view: moveView({ status: 'EXECUTED', allowedActions: [] }),
      etag: '"5"',
    });
    await controller.load();
    expect(panel(controller.getState())).toContain('Điều chuyển đã thực hiện');
    // PIN sai hình dạng không gọi mạng.
    const bad = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    bad.ports.move.mockResolvedValue({
      view: moveView({ allowedActions: ['EXECUTE'] }),
      etag: '"3"',
    });
    await bad.controller.load();
    await bad.controller.submitExecute('12');
    expect(bad.ports.verifyPin).not.toHaveBeenCalled();
    expect(bad.controller.getState().command).toMatchObject({ failure: { kind: 'validation' } });
  });

  it('execute_conflict_keeps_source', async () => {
    for (const rejection of [
      [http(409, 'E_INV_ROOM_TAKEN'), 'roomTaken'],
      [http(409, 'E_OVER_NO_CONSENT'), 'noConsent'],
      [http(412, 'E_GEN_VERSION_CONFLICT'), 'conflict'],
    ] as const) {
      const { controller, ports } = setup(DESK, { ...PARAMS, moveId: 'mv1' });
      ports.move.mockResolvedValue({
        view: moveView({ allowedActions: ['EXECUTE'] }),
        etag: '"3"',
      });
      await controller.load();
      const before = controller.getState().options;
      const reads = ports.options.mock.calls.length;
      ports.execute.mockRejectedValueOnce(rejection[0]);
      await controller.submitExecute('123456');
      await flush();
      const state = controller.getState();
      expect(state.command).toMatchObject({ failure: { kind: rejection[1] } });
      expect(state.pending).toBe(false);
      // Phòng nguồn/ca còn nguyên, phương án được đọc lại, không tự thử bậc sau (không có lệnh create/plan mới).
      expect(state.move?.view.fromRoomId).toBe('room-1');
      expect(state.options).toEqual(before);
      expect(ports.options.mock.calls.length).toBeGreaterThan(reads);
      expect(ports.create).not.toHaveBeenCalled();
      expect(ports.execute).toHaveBeenCalledTimes(1);
    }
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    ports.move.mockResolvedValue({ view: moveView({ allowedActions: ['EXECUTE'] }), etag: '"3"' });
    await controller.load();
    ports.execute.mockRejectedValueOnce(timeout());
    await controller.submitExecute('123456');
    expect(controller.getState().pending).toBe(true);
    ports.actor.mockRejectedValueOnce(http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({
      phase: 'expired',
      move: null,
      options: null,
      pending: false,
    });
    expect(ports.clearPin).toHaveBeenCalled();
    ports.actor.mockRejectedValueOnce(http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'forbidden', detail: null });
    controller.expire();
    expect(controller.getState()).toMatchObject({ phase: 'expired', actor: null });
    // Đổi người dùng giữa chừng: bỏ ý định chưa rõ và PIN của người trước.
    const swap = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    swap.ports.move.mockResolvedValue({
      view: moveView({ allowedActions: ['EXECUTE'] }),
      etag: '"3"',
    });
    await swap.controller.load();
    swap.ports.execute.mockRejectedValueOnce(timeout());
    await swap.controller.submitExecute('123456');
    swap.ports.actor.mockResolvedValueOnce(OWNER);
    await swap.controller.load();
    expect(swap.controller.getState().pending).toBe(false);
    // Tạo điều chuyển cần đúng quyền riêng: quản lý không lập, lễ tân không duyệt.
    const manager = setup(MANAGER);
    await manager.controller.load();
    await manager.controller.submitCreate({
      optionIndex: 0,
      reason: 'x',
      granted: true,
      channel: 'PHONE',
      walkOutDocNo: '',
      guestSignatureRef: '',
      staffSignatureRef: '',
    });
    expect(manager.ports.create).not.toHaveBeenCalled();
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = setup(DESK, desk);
    await controller.load();
    const create = {
      optionIndex: 0,
      reason: 'Quá tải',
      granted: true,
      channel: 'PHONE' as const,
      walkOutDocNo: '',
      guestSignatureRef: '',
      staffSignatureRef: '',
    };
    ports.create.mockRejectedValueOnce(timeout());
    await controller.submitCreate(create);
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    // Tra theo khoá: NOT_FOUND giữ ý định (gửi lại cùng khoá an toàn); SUCCEEDED nhả ý định.
    ports.options.mockResolvedValueOnce({
      ...optionsView(),
      writeIntent: {
        idempotencyKey: randomUUID(),
        state: 'NOT_FOUND',
        resourceType: 'ROOM_MOVE',
        resourceId: null,
        operationId: null,
        recordedAt: null,
      },
    });
    await controller.lookup();
    expect(ports.options.mock.calls.at(-1)?.[2]).toBe('key-1');
    expect(controller.getState()).toMatchObject({ pending: true, intentState: 'NOT_FOUND' });
    await controller.retry();
    const [first, second] = ports.create.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    expect(controller.getState().pending).toBe(false);
    ports.create.mockRejectedValueOnce(timeout());
    await controller.submitCreate({ ...create, reason: 'Lần hai' });
    ports.options.mockResolvedValueOnce({
      ...optionsView(),
      writeIntent: {
        idempotencyKey: randomUUID(),
        state: 'SUCCEEDED',
        resourceType: 'ROOM_MOVE',
        resourceId: 'mv1',
        operationId: null,
        recordedAt: '2026-11-10T00:00:00.000Z',
      },
    });
    await controller.lookup();
    expect(controller.getState().pending).toBe(false);
    // Ý định khác khi còn lệnh chưa rõ bị chặn.
    ports.create.mockRejectedValueOnce(timeout());
    await controller.submitCreate({ ...create, reason: 'Lần ba' });
    await controller.submitCreate({ ...create, reason: 'Khác hẳn' });
    expect(ports.create.mock.calls.length).toBe(4);
    // 409 đang xử lý giữ khoá; quá 24 giờ không gửi lại mù.
    const staleKey = ports.create.mock.calls.at(-1)?.[0].key;
    const calls = ports.create.mock.calls.length;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.create.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitCreate({ ...create, reason: 'Lần ba' });
    expect(ports.create.mock.calls.at(-1)?.[0].key).not.toBe(staleKey);
    const moveReader = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    moveReader.ports.move.mockResolvedValue({
      view: moveView({ allowedActions: ['EXECUTE'] }),
      etag: '"3"',
    });
    await moveReader.controller.load();
    moveReader.ports.execute.mockRejectedValueOnce(
      http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await moveReader.controller.submitExecute('123456');
    expect(moveReader.controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    await moveReader.controller.lookup();
    expect(moveReader.ports.move.mock.calls.at(-1)?.[1]).toBe('key-1');
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = setup();
    ports.caseDetail.mockRejectedValueOnce(
      new (await import('@pinehill/api-client')).ApiError({ kind: 'network', message: 'offline' }),
    );
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', detail: null });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().detail;
    let release: () => void = () => undefined;
    ports.caseDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => (release = () => resolve({ detail: detail([]), etag: '"3"' }))),
    );
    const reloading = controller.load();
    await flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', detail: kept });
    release();
    await reloading;
    ports.caseDetail.mockRejectedValueOnce(http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().detail).not.toBeNull();
    expect(classify(timeout())).toEqual({ kind: 'unknown' });
    expect(classify(http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
  });

  it('redacted_evidence_and_logs', async () => {
    const error = http(422, 'E_VALIDATION', { details: [{ field: 'reason', issue: 'REQUIRED' }] });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = setup(DESK, { ...PARAMS, moveId: 'mv1' });
    ports.move.mockResolvedValue({ view: moveView({ allowedActions: ['EXECUTE'] }), etag: '"3"' });
    await controller.load();
    ports.execute.mockRejectedValueOnce(timeout());
    await controller.submitExecute('654321');
    const state = controller.getState();
    const shown = JSON.stringify(state);
    for (const secret of ['654321', 'key-1', 'Idempotency', 'pinToken'])
      expect(shown).not.toContain(secret);
    expect(failed(state)).not.toContain('654321');
    ports.verifyPin.mockRejectedValueOnce(http(403, 'E_AUTH_PIN_LOCKED', { traceId: 'trace-9' }));
    controller.discardPending();
    await controller.submitExecute('654321');
    expect(failed(controller.getState())).toContain('trace-9');
    expect(controller.getState().phase).toBe('ready');
    expect(JSON.stringify(controller.getState())).not.toContain('654321');
  });
});
