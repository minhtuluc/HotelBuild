import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  classify,
  evidenceOf,
  evidenceIssues,
} from '../../src/features/hb137-scr45-46-ghep-walkout/model';
import { ReadBanner } from '../../src/features/hb137-scr45-46-ghep-walkout/status';
import * as fx from './fixtures';
import { failed, mergeMarkup, payMarkup, walkMarkup } from './render';

describe('HB-137 SCR-45/46', () => {
  it('merge_projection_preserves_revenue', async () => {
    const { controller, ports } = fx.setup(fx.DESK, { mergeId: 'mg1', moveId: '' });
    await controller.load();
    let markup = mergeMarkup(controller.getState());
    // Chiết khấu chỉ lấy từ response; doanh thu/giá gốc không có ô nhập hay phép tính ở UI.
    expect(markup).toContain('Chiết khấu 20% = 290800 VND');
    expect(markup).toContain('Ghép chung phòng (SHARE)');
    ports.merge.mockResolvedValue({
      view: fx.mergeView({
        moveType: 'MERGE_CONNECTING',
        secondaryBookingId: null,
        roomId: null,
        roomIdA: 'room-a',
        roomIdB: 'room-b',
        genderSame: null,
        discountPct: 10,
        discountAmount: 673200,
      }),
      etag: fx.tag('"2"'),
    });
    await controller.load();
    markup = mergeMarkup(controller.getState());
    expect(markup).toContain('room-a, room-b');
    expect(markup).toContain('CONNECTING không có bước đồng thuận');
    expect(markup).toContain('Chiết khấu 10% = 673200 VND');
    expect(markup).toContain('không áp dụng');
    ports.merge.mockResolvedValue({
      view: fx.mergeView({ status: 'ACTIVE', allowedActions: [] }),
      etag: fx.tag('"3"'),
    });
    await controller.load();
    expect(mergeMarkup(controller.getState())).toContain('Ghép đã có hiệu lực (ACTIVE)');
    const creator = fx.setup(fx.DESK, { mergeId: '', moveId: '' });
    await creator.controller.load();
    await creator.controller.submitMergeCreate({
      moveType: 'MERGE_SHARE',
      primaryBookingId: 'bk-1',
      secondaryBookingId: 'bk-2',
      roomId: 'room-1',
      bookingId: '',
      roomIdA: '',
      roomIdB: '',
    });
    expect(creator.ports.send.mock.calls[0]?.[0]).toMatchObject({
      kind: 'mergeCreate',
      body: {
        moveType: 'MERGE_SHARE',
        primaryBookingId: 'bk-1',
        secondaryBookingId: 'bk-2',
        roomId: 'room-1',
      },
    });
    expect(JSON.stringify(creator.ports.send.mock.calls[0]?.[0].body)).not.toContain('discountPct');
  });

  it('consent_gender_distinct_errors', async () => {
    const { controller, ports } = fx.setup(fx.DESK, { mergeId: 'mg1', moveId: '' });
    await controller.load();
    // Hai bên độc lập: mỗi lệnh một bên, một khoá; bằng chứng chỉ nhận mã tệp, không nhận URL.
    await controller.submitConsent(fx.CONSENT);
    await controller.submitConsent({ ...fx.CONSENT, side: 'SECONDARY' });
    const [one, two] = ports.send.mock.calls.map(([intent]) => intent);
    expect(one).toMatchObject({
      kind: 'mergeConsent',
      ifMatch: '"2"',
      body: { side: 'PRIMARY', consented: true },
    });
    expect(two).toMatchObject({ body: { side: 'SECONDARY' } });
    expect(one?.key).not.toBe(two?.key);
    await controller.submitConsent({ ...fx.CONSENT, evidence: 'https://example.com/x' });
    expect(ports.send).toHaveBeenCalledTimes(2);
    expect(evidenceIssues('evidence', 'https://example.com/x')).toEqual([
      { field: 'evidence', issue: 'EVIDENCE_SHAPE' },
    ]);
    // Ba mã lỗi khác nhau, mỗi mã một thông điệp riêng; không dùng mã cũ.
    const kinds = [
      [fx.http(409, 'E_OVER_NO_CONSENT'), 'noConsent', 'Thiếu đồng thuận'],
      [fx.http(409, 'E_OVER_MERGE_GENDER'), 'mergeGender', 'Khác giới hoặc chưa rõ giới tính'],
      [fx.http(409, 'E_INV_ROOM_TAKEN'), 'roomTaken', 'Phòng không còn trống'],
    ] as const;
    for (const [error, kind, words] of kinds) {
      ports.send.mockRejectedValueOnce(error);
      await controller.submitConsent(fx.CONSENT);
      expect(controller.getState().command).toMatchObject({ failure: { kind } });
      expect(failed(controller.getState())).toContain(words);
    }
    expect(classify(fx.http(409, 'TCOVER13'))).toEqual({ kind: 'rejected' });
  });

  it('merge_execute_atomic_failure_projection', async () => {
    const { controller, ports } = fx.setup(fx.DESK, { mergeId: 'mg1', moveId: '' });
    ports.merge.mockResolvedValue({
      view: fx.mergeView({ status: 'APPROVED', allowedActions: ['EXECUTE'] }),
      etag: fx.tag('"4"'),
    });
    await controller.load();
    const reads = ports.merge.mock.calls.length;
    ports.send.mockRejectedValueOnce(fx.http(409, 'E_OVER_NO_CONSENT'));
    await controller.submitMergeExecute();
    await fx.flush();
    const state = controller.getState();
    expect(state.command).toMatchObject({ failure: { kind: 'noConsent' } });
    // Giữ cả hai nguồn, đọc lại, không tự đổi sang ACTIVE.
    expect(state.merge?.view.status).toBe('APPROVED');
    expect(ports.merge.mock.calls.length).toBeGreaterThan(reads);
    expect(mergeMarkup(state)).not.toContain('Ghép đã có hiệu lực');
    expect(ports.send.mock.calls[0]?.[0]).toMatchObject({ kind: 'mergeExecute', ifMatch: '"4"' });
    ports.merge.mockResolvedValue({
      view: fx.mergeView({ status: 'ACTIVE', allowedActions: [] }),
      etag: fx.tag('"5"'),
    });
    await controller.submitMergeExecute();
    await fx.flush();
    expect(mergeMarkup(controller.getState())).toContain('Ghép đã có hiệu lực (ACTIVE)');
  });

  it('walkout_documents_and_server_amounts', async () => {
    const { controller } = fx.setup(fx.MANAGER, { mergeId: '', moveId: 'mv1' });
    await controller.load();
    const markup = walkMarkup(controller.getState());
    expect(markup).toContain('Chứng từ: WO-001');
    expect(markup).toContain('chữ ký khách sig-guest');
    expect(markup).toContain('Bồi thường 300000 · đưa đón 50000');
    expect(markup).toContain('Hồ sơ hoàn: rf-1');
    // Chưa có preview hoàn tiền trong hợp đồng: nói rõ, không tự hứa net = paid.
    expect(markup).toContain('Chưa có preview hoàn tiền');
    expect(markup).not.toMatch(/net\s*=\s*paid/i);
    const none = fx.setup(fx.MANAGER, { mergeId: '', moveId: 'mv1' });
    none.ports.move.mockResolvedValue({
      view: fx.moveView({ walkOut: null }),
      etag: fx.tag('"3"'),
    });
    await none.controller.load();
    expect(walkMarkup(none.controller.getState())).toContain('Chưa có chứng từ walk-out');
  });

  it.todo(
    'walkout_documents_and_server_amounts:preview — BLOCKED: HB-120 chưa có preview hoàn (gross/net/phí)',
  );

  it('walkout_payment_permission_separation', async () => {
    for (const [actor, buttons] of fx.STAGES) {
      const { controller, ports } = fx.setup(actor, { mergeId: '', moveId: 'mv1' });
      ports.move.mockResolvedValue({
        view: fx.moveView({ allowedActions: ['APPROVE', 'EXECUTE'] }),
        etag: fx.tag('"3"'),
      });
      await controller.load();
      const markup = walkMarkup(controller.getState());
      const expected = [...buttons, ...(actor === fx.DESK ? ['hb137-move-execute'] : [])];
      for (const id of ['hb137-move-approve', 'hb137-move-execute'])
        expect(markup.includes(`data-testid="${id}"`)).toBe(expected.some((item) => item === id));
    }
    // Duyệt rồi vẫn chưa "đã chi": chỉ ACCOUNTANT thấy nút chi, và chỉ khi đã duyệt, chưa có khoản chi nào chạy.
    const approved = fx.moveView({
      approvedBy: 'u2',
      status: 'APPROVED',
      allowedActions: ['EXECUTE'],
    });
    for (const [actor, payments, visible] of fx.PAY_CASES) {
      const { controller, ports } = fx.setup(actor, { mergeId: '', moveId: 'mv1' });
      ports.move.mockResolvedValue({ view: approved, etag: fx.tag('"4"') });
      ports.compensations.mockResolvedValue(payments);
      await controller.load();
      const markup = payMarkup(controller.getState());
      expect(markup.includes('data-testid="hb137-pay-submit"')).toBe(visible);
      expect(markup).toContain('quyền duyệt không phải quyền chi');
      if (payments.payments[0]?.state === 'UNKNOWN')
        expect(markup).toContain('tra lại theo mã tác vụ op-77');
    }
    const { controller, ports } = fx.setup(fx.ACCOUNTANT, { mergeId: '', moveId: 'mv1' });
    ports.move.mockResolvedValue({ view: approved, etag: fx.tag('"4"') });
    await controller.load();
    await controller.submitCompensate(fx.PAY, '123456');
    expect(ports.verifyPin).toHaveBeenCalledWith('123456', 'bk-3');
    const intent = ports.send.mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      kind: 'compensate',
      target: 'mv1',
      ifMatch: '"4"',
      body: { method: 'CASH' },
    });
    expect(JSON.stringify(intent?.body)).not.toContain('amount');
    // Timeout khi chi: giữ ý định, gửi lại đúng khoá, không mở payout mới.
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitCompensate(fx.PAY, '123456');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    await controller.submitCompensate(fx.PAY, '123456');
    const sent = ports.send.mock.calls.map(([item]) => item.key);
    expect(sent[2]).toBe(sent[1]);
    expect(ports.verifyPin).toHaveBeenCalledTimes(2);
  });

  it('merge_stale_preview_recovery', async () => {
    for (const [error, kind] of [
      [fx.http(412, 'E_GEN_VERSION_CONFLICT'), 'conflict'],
      [fx.http(409, 'E_INV_ROOM_TAKEN'), 'roomTaken'],
      [fx.http(409, 'E_OVER_NO_CONSENT'), 'noConsent'],
    ] as const) {
      const { controller, ports } = fx.setup(fx.DESK, { mergeId: 'mg1', moveId: '' });
      ports.merge.mockResolvedValue({
        view: fx.mergeView({ allowedActions: ['RECORD_CONSENT', 'EXECUTE'] }),
        etag: fx.tag('"2"'),
      });
      await controller.load();
      const reads = ports.merge.mock.calls.length;
      ports.send.mockRejectedValueOnce(error);
      await controller.submitMergeExecute();
      await fx.flush();
      const state = controller.getState();
      expect(state.command).toMatchObject({ failure: { kind } });
      expect(state.pending).toBe(false);
      expect(ports.merge.mock.calls.length).toBeGreaterThan(reads);
      expect(failed(state)).toContain('trace-1');
      expect(state.merge?.view.status).toBe('PENDING_CONSENT');
    }
    // Lỗi nghiệp vụ 403/401 không xoá dữ liệu như mất phiên.
    expect(classify(fx.http(403, 'E_OVER_APPROVAL_REQUIRED')).kind).toBe('approvalRequired');
    expect(classify(fx.http(401, 'E_AUTH_PIN_REQUIRED')).kind).toBe('pinRequired');
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = fx.setup(fx.DESK, fx.PARAMS);
    ports.move.mockResolvedValue({
      view: fx.moveView({ status: 'APPROVED', allowedActions: ['EXECUTE'] }),
      etag: fx.tag('"3"'),
    });
    await controller.load();
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitMoveExecute('123456');
    expect(controller.getState().pending).toBe(true);
    ports.actor.mockRejectedValueOnce(fx.http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({
      phase: 'expired',
      merge: null,
      move: null,
      pending: false,
    });
    expect(ports.clearPin).toHaveBeenCalled();
    ports.actor.mockRejectedValueOnce(fx.http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'forbidden', payments: null });
    controller.expire();
    expect(controller.getState()).toMatchObject({ phase: 'expired', actor: null });
    // Đổi người dùng: bỏ ý định chưa rõ. Quyền riêng: quản lý không lập/ghi đồng thuận/thực thi, lễ tân không duyệt.
    const swap = fx.setup(fx.DESK, fx.PARAMS);
    swap.ports.move.mockResolvedValue({
      view: fx.moveView({ status: 'APPROVED', allowedActions: ['EXECUTE'] }),
      etag: fx.tag('"3"'),
    });
    await swap.controller.load();
    swap.ports.send.mockRejectedValueOnce(fx.timeout());
    await swap.controller.submitMoveExecute('123456');
    swap.ports.actor.mockResolvedValueOnce(fx.OWNER);
    await swap.controller.load();
    expect(swap.controller.getState().pending).toBe(false);
    const manager = fx.setup(fx.MANAGER, fx.PARAMS);
    manager.ports.merge.mockResolvedValue({
      view: fx.mergeView({ allowedActions: ['RECORD_CONSENT', 'EXECUTE', 'APPROVE'] }),
      etag: fx.tag('"2"'),
    });
    await manager.controller.load();
    await manager.controller.submitConsent(fx.CONSENT);
    await manager.controller.submitMergeExecute();
    expect(manager.ports.send).not.toHaveBeenCalled();
    await manager.controller.submitMergeApprove('Cùng giới, đủ điều kiện');
    expect(manager.ports.send.mock.calls[0]?.[0]).toMatchObject({
      kind: 'mergeApprove',
      body: { reason: 'Cùng giới, đủ điều kiện' },
    });
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = fx.setup(fx.DESK, { mergeId: 'mg1', moveId: '' });
    ports.merge.mockResolvedValue({
      view: fx.mergeView({ allowedActions: ['RECORD_CONSENT', 'EXECUTE'] }),
      etag: fx.tag('"2"'),
    });
    await controller.load();
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitConsent(fx.CONSENT);
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    await controller.submitMergeExecute();
    expect(ports.send).toHaveBeenCalledTimes(1);
    await controller.retry();
    const [first, second] = ports.send.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    expect(first?.ifMatch).toBe('"2"');
    // Tra theo khoá: NOT_FOUND giữ ý định; SUCCEEDED nhả ý định.
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitConsent({ ...fx.CONSENT, consented: false });
    expect(controller.getState().pending).toBe(true);
    ports.merge.mockResolvedValueOnce({
      view: fx.mergeView({
        writeIntent: fx.writeIntentOf('NOT_FOUND'),
      }),
      etag: fx.tag('"2"'),
    });
    await controller.lookup();
    expect(ports.merge.mock.calls.at(-1)?.[1]).toBe('key-3');
    expect(controller.getState()).toMatchObject({ pending: true, intentState: 'NOT_FOUND' });
    ports.merge.mockResolvedValueOnce({
      view: fx.mergeView({
        writeIntent: fx.writeIntentOf('SUCCEEDED'),
      }),
      etag: fx.tag('"3"'),
    });
    await controller.lookup();
    expect(controller.getState().pending).toBe(false);
    ports.send.mockRejectedValueOnce(
      fx.http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitMergeExecute();
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    const calls = ports.send.mock.calls.length;
    const stale = ports.send.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.send.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitMergeExecute();
    expect(ports.send.mock.calls.at(-1)?.[0].key).not.toBe(stale);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = fx.setup(fx.DESK, fx.PARAMS);
    ports.merge.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', merge: null });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().merge;
    let release: () => void = () => undefined;
    ports.merge.mockImplementationOnce(
      () =>
        new Promise(
          (resolve) => (release = () => resolve({ view: fx.mergeView(), etag: fx.tag('"2"') })),
        ),
    );
    const reloading = controller.load();
    await fx.flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', merge: kept });
    release();
    await reloading;
    ports.merge.mockRejectedValueOnce(fx.http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().merge).not.toBeNull();
    expect(classify(fx.timeout())).toEqual({ kind: 'unknown' });
    expect(classify(fx.http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
  });

  it('redacted_evidence_and_logs', async () => {
    const error = fx.http(422, 'E_VALIDATION', {
      details: [{ field: 'reason', issue: 'REQUIRED' }],
    });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = fx.setup(fx.ACCOUNTANT, { mergeId: '', moveId: 'mv1' });
    ports.move.mockResolvedValue({
      view: fx.moveView({ approvedBy: 'u2', status: 'APPROVED' }),
      etag: fx.tag('"4"'),
    });
    await controller.load();
    ports.send.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitCompensate(
      { ...fx.PAY, note: 'SECRET-NOTE', bankReference: 'SECRET-BANK' },
      '654321',
    );
    const state = controller.getState();
    const shown = JSON.stringify(state);
    for (const secret of [
      '654321',
      'SECRET-NOTE',
      'SECRET-BANK',
      'key-1',
      'Idempotency',
      'pinToken',
    ])
      expect(shown).not.toContain(secret);
    expect(failed(state)).toContain('trace-2');
    ports.verifyPin.mockRejectedValueOnce(
      fx.http(403, 'E_AUTH_PIN_LOCKED', { traceId: 'trace-9' }),
    );
    controller.discardPending();
    await controller.submitCompensate(fx.PAY, '654321');
    expect(failed(controller.getState())).toContain('trace-9');
    expect(controller.getState().phase).toBe('ready');
    expect(JSON.stringify(controller.getState())).not.toContain('654321');
  });
});
