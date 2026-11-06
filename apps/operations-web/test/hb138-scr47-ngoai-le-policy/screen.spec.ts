import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  charCount,
  classify,
  createIssues,
  evidenceOf,
  emptyFilter,
} from '../../src/features/hb138-scr47-ngoai-le-policy/model';
import { ReadBanner } from '../../src/features/hb138-scr47-ngoai-le-policy/status';
import * as fx from './fixtures';
import { failed, tableMarkup } from './render';

describe('HB-138 SCR-47', () => {
  it('exception_server_preview', async () => {
    const { controller, ports } = fx.setup();
    ports.list.mockResolvedValueOnce(
      fx.page([
        fx.row('r1', {
          requestedAmount: 500000,
          refundFee: 0,
          netRefund: 500000,
          refundPercent: 100,
        }),
        fx.row('r2', {
          isForceMajeure: false,
          refundPercent: 50,
          refundFee: 20000,
          netRefund: 230000,
          requestedAmount: 250000,
        }),
      ]),
    );
    await controller.load();
    const markup = tableMarkup(controller.getState());
    // Số tiền, bậc, phí đều lấy nguyên từ máy chủ; mặc định chỉ hiện ngoại lệ bất khả kháng.
    expect(markup).toContain('hoàn 100%');
    expect(markup).toContain('Yêu cầu 500000');
    expect(markup).not.toContain('hb138-row-r2');
    const all = tableMarkup(controller.getState(), { ...emptyFilter, forceOnly: false });
    expect(all).toContain('phí 20000');
    expect(all).toContain('thực nhận 230000');
    expect(all).toContain('Hoàn thường');
    // Không có ô sửa số tiền; số tiền duyệt gửi đi chính là số máy chủ yêu cầu.
    expect(markup).not.toContain('name="approvedAmount"');
    await controller.submitApprove('r1', '', '123456');
    expect(ports.send.mock.calls[0]?.[0]).toMatchObject({
      kind: 'approve',
      target: 'r1',
      body: { approvedAmount: 500000 },
    });
    // Bộ lọc đi nguyên sang API.
    await controller.applyFilter({
      propertyId: 'p1',
      status: 'PENDING',
      bookingId: 'bk-r1',
      forceOnly: true,
    });
    expect(ports.list.mock.calls.at(-1)?.[0]).toMatchObject({
      propertyId: 'p1',
      status: 'PENDING',
      bookingId: 'bk-r1',
    });
  });

  it('reason_twenty_character_boundary', async () => {
    const nineteen = 'a'.repeat(19);
    const twenty = 'a'.repeat(20);
    expect(createIssues({ ...fx.DRAFT, note: nineteen })).toEqual([
      { field: 'note', issue: 'TOO_SHORT' },
    ]);
    expect(createIssues({ ...fx.DRAFT, note: twenty })).toEqual([]);
    // Đếm theo ký tự Unicode, bỏ khoảng trắng đầu/cuối.
    expect(charCount(`  ${'đ'.repeat(20)}  `)).toBe(20);
    expect(createIssues({ ...fx.DRAFT, note: `😀${'a'.repeat(18)}` })).toEqual([
      { field: 'note', issue: 'TOO_SHORT' },
    ]);
    expect(createIssues({ ...fx.DRAFT, evidence: '' })).toEqual([
      { field: 'evidence', issue: 'NO_EVIDENCE' },
    ]);
    const { controller, ports } = fx.setup();
    await controller.load();
    await controller.submitCreate({ ...fx.DRAFT, note: nineteen });
    expect(ports.send).not.toHaveBeenCalled();
    expect(controller.getState().command).toMatchObject({
      failure: { kind: 'validation', issues: [{ field: 'note', issue: 'TOO_SHORT' }] },
    });
    await controller.submitCreate({ ...fx.DRAFT, note: twenty });
    expect(ports.send.mock.calls[0]?.[0]).toMatchObject({
      kind: 'create',
      body: {
        isForceMajeure: true,
        reason: 'FORCE_MAJEURE',
        evidenceRefs: ['file-aaaa', 'file-bbbb'],
        note: twenty,
      },
    });
    // API vẫn kiểm: lỗi trường của máy chủ gắn đúng trường, bản nhập không bị mất (ý định nhả).
    ports.send.mockRejectedValueOnce(
      fx.http(422, 'E_GEN_VALIDATION_FAILED', { details: [{ field: 'note', issue: 'POLICY' }] }),
    );
    await controller.submitCreate({ ...fx.DRAFT, note: twenty });
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'validation', issues: [{ field: 'note', issue: 'POLICY' }] } },
    });
  });

  it('private_evidence_access', async () => {
    const { controller } = fx.setup();
    await controller.load();
    const markup = tableMarkup(controller.getState());
    // Minh chứng chỉ là mã tệp (văn bản), không phải liên kết tuỳ ý; không có URL ký nào bị đưa vào trang.
    expect(markup).toContain('file-aaaa');
    expect(markup).not.toMatch(/href="https?:/);
    expect(markup).toContain('chưa có đường tải tệp riêng tư');
    for (const url of ['https://example.com/x', 'file://etc/passwd', 'a b']) {
      expect(createIssues({ ...fx.DRAFT, evidence: url })).toEqual([
        { field: 'evidence', issue: 'EVIDENCE_SHAPE' },
      ]);
    }
  });

  it.todo(
    'private_evidence_access:download — BLOCKED: hợp đồng HB-120/F5 chưa có đường tải minh chứng riêng tư (URL ký hết hạn, ngoài scope)',
  );

  it('exception_separation_of_duties', async () => {
    for (const actor of [fx.MANAGER, fx.OWNER]) {
      const { controller, ports } = fx.setup(actor);
      await controller.load();
      const markup = tableMarkup(controller.getState());
      // Hồ sơ do người khác lập: có nút; hồ sơ do chính mình lập: không nút, lệnh bị chặn tại chỗ.
      expect(markup).toContain('data-testid="hb138-approve-r1"');
      expect(markup).not.toContain('data-testid="hb138-approve-r2"');
      await controller.submitApprove('r2', '', '123456');
      expect(ports.send).not.toHaveBeenCalled();
      expect(ports.verifyPin).not.toHaveBeenCalled();
      expect(controller.getState().command).toMatchObject({ failure: { kind: 'forbidden' } });
    }
    // FRONT_DESK/ACCOUNTANT không được tải hồ sơ: không có request đọc nào, trạng thái từ chối.
    for (const actor of [fx.DESK, fx.ACCOUNTANT]) {
      const { controller, ports } = fx.setup(actor);
      await controller.load();
      expect(ports.list).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({ phase: 'forbidden', list: null });
      expect(JSON.stringify(controller.getState())).not.toContain('bk-r1');
    }
    // Máy chủ từ chối tự duyệt/ngoài scope: không xoá dữ liệu như mất phiên.
    const { controller, ports } = fx.setup(fx.MANAGER);
    await controller.load();
    ports.send.mockRejectedValueOnce(fx.http(403, 'E_PAY_SELF_APPROVAL'));
    await controller.submitApprove('r1', '', '123456');
    expect(controller.getState()).toMatchObject({
      phase: 'ready',
      pending: false,
      command: { failure: { kind: 'selfApproval' } },
    });
    expect(failed(controller.getState())).toContain('E_PAY_SELF_APPROVAL');
  });

  it('exception_version_idempotent_decision', async () => {
    const { controller, ports } = fx.setup();
    await controller.load();
    // Từ chối bắt buộc lý do; duyệt/từ chối bắt buộc PIN đúng hình dạng và không vào thân lệnh.
    await controller.submitReject('r1', '  ', '123456');
    await controller.submitApprove('r1', '', '12');
    expect(ports.send).not.toHaveBeenCalled();
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitReject('r1', 'Không đủ minh chứng', '123456');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    // Timeout giữ khoá cũ; không đổi PIN lần nữa; nhãn chưa đổi vì chưa có phản hồi cuối.
    await controller.submitReject('r1', 'Không đủ minh chứng', '123456');
    const [one, two] = ports.send.mock.calls.map(([intent]) => intent);
    expect(two).toEqual(one);
    expect(ports.verifyPin).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(one?.body)).not.toContain('123456');
    expect(tableMarkup(controller.getState())).toContain('Chờ duyệt (PENDING)');
    // Hồ sơ đổi (đã được xử lý): 409 nhả ý định và đọc lại, không tự gửi lại.
    const reads = ports.list.mock.calls.length;
    ports.send.mockRejectedValueOnce(fx.http(409, 'E_PAY_REFUND_NOT_PENDING'));
    await controller.submitApprove('r1', '', '123456');
    await fx.flush();
    expect(controller.getState()).toMatchObject({
      pending: false,
      command: { failure: { kind: 'conflict' } },
    });
    expect(ports.list.mock.calls.length).toBeGreaterThan(reads);
    // Nhãn chỉ đổi theo bản đọc lại của máy chủ.
    ports.list.mockResolvedValueOnce(
      fx.page([fx.row('r1', { status: 'APPROVED', approvedBy: 'u-mgr', approvedAmount: 500000 })]),
    );
    await controller.load();
    expect(tableMarkup(controller.getState())).toContain('Đã duyệt (APPROVED)');
  });

  it('exception_payout_status_projection', async () => {
    const { controller, ports } = fx.setup();
    ports.list.mockResolvedValueOnce(
      fx.page([
        fx.row('r1', { status: 'APPROVED', approvedBy: 'u-x', approvedAmount: 500000 }),
        fx.row('r2', { status: 'APPROVED', approvedBy: 'u-x', awaitingTransferConfirmation: true }),
        fx.row('r3', { status: 'PAID', paidAt: '2026-11-11T01:00:00.000Z', approvedBy: 'u-x' }),
      ]),
    );
    await controller.load();
    const markup = tableMarkup(controller.getState());
    // Duyệt ≠ đã chi: hiển thị đúng ba trạng thái từ máy chủ, kèm liên kết sang luồng kế toán; UI không có lệnh chi.
    expect(markup).toContain('Chưa chi (duyệt không đồng nghĩa đã chi)');
    expect(markup).toContain('Chờ kế toán xác nhận chuyển khoản');
    expect(markup).toContain('Đã chi lúc');
    expect(markup).toContain('/bookings/bk-r1/refunds');
    expect(Object.keys(ports)).not.toContain('pay');
    expect(markup).not.toContain('hb138-approve-r1');
  });

  it('current_scope_permission_fail_closed', async () => {
    const { controller, ports } = fx.setup();
    await controller.load();
    let release: (value: ReturnType<typeof fx.page>) => void = () => undefined;
    ports.list.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const stale = controller.applyFilter({ ...emptyFilter, propertyId: 'p2' });
    expect(controller.getState().list).toBeNull();
    await fx.flush();
    ports.list.mockResolvedValueOnce(fx.page([fx.row('fresh')]));
    await controller.load();
    release(fx.page([fx.row('old')]));
    await stale;
    expect(controller.getState().list?.rows.map((item) => item.id)).toEqual(['fresh']);
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitApprove('fresh', '', '123456');
    expect(controller.getState().pending).toBe(true);
    ports.list.mockRejectedValueOnce(fx.http(401, 'E_AUTH_TOKEN_EXPIRED'));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'expired', list: null, pending: false });
    expect(ports.clearPin).toHaveBeenCalled();
    ports.list.mockRejectedValueOnce(fx.http(403, 'E_RBAC_FORBIDDEN'));
    await controller.load();
    expect(controller.getState().phase).toBe('forbidden');
    controller.expire();
    expect(controller.getState()).toMatchObject({ phase: 'expired', actor: null });
    const swap = fx.setup(fx.MANAGER);
    await swap.controller.load();
    swap.ports.send.mockRejectedValueOnce(fx.timeout());
    await swap.controller.submitApprove('r1', '', '123456');
    swap.ports.actor.mockResolvedValueOnce(fx.OWNER);
    await swap.controller.load();
    expect(swap.controller.getState().pending).toBe(false);
  });

  it('etag_stable_retry_reconcile', async () => {
    const { controller, ports, advance } = fx.setup();
    await controller.load();
    ports.send.mockRejectedValueOnce(fx.timeout());
    await controller.submitCreate(fx.DRAFT);
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'unknown' } },
    });
    await controller.submitCreate({ ...fx.DRAFT, bookingId: 'bk-khac' });
    expect(ports.send).toHaveBeenCalledTimes(1);
    await controller.retry();
    const [first, second] = ports.send.mock.calls.map(([intent]) => intent);
    expect(second).toEqual(first);
    ports.send.mockRejectedValueOnce(
      fx.http(409, 'E_SYS_REQUEST_IN_PROGRESS', { retryAfterSeconds: 3 }),
    );
    await controller.submitApprove('r1', '', '123456');
    expect(controller.getState()).toMatchObject({
      pending: true,
      command: { failure: { kind: 'inProgress', retryAfterSeconds: 3 } },
    });
    // Đối soát bằng đọc lại: hồ sơ đã APPROVED trên máy chủ thì nhả ý định.
    ports.list.mockResolvedValueOnce(
      fx.page([fx.row('r1', { status: 'APPROVED', approvedBy: 'u-mgr' })]),
    );
    await controller.lookup();
    expect(controller.getState()).toMatchObject({ pending: false, intentState: 'APPROVED' });
    ports.send.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.submitCreate(fx.DRAFT);
    const calls = ports.send.mock.calls.length;
    const stale = ports.send.mock.calls.at(-1)?.[0].key;
    advance(24 * 60 * 60 * 1000);
    await controller.retry();
    expect(ports.send.mock.calls.length).toBe(calls);
    expect(controller.getState().command).toMatchObject({ failure: { kind: 'ttl' } });
    controller.discardPending();
    await controller.submitCreate(fx.DRAFT);
    expect(ports.send.mock.calls.at(-1)?.[0].key).not.toBe(stale);
  });

  it('screen_states_network_failure', async () => {
    const { controller, ports } = fx.setup();
    ports.properties.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await controller.load();
    expect(controller.getState()).toMatchObject({ phase: 'offline', list: null });
    expect(
      renderToStaticMarkup(createElement(ReadBanner, { state: controller.getState() })),
    ).toContain('role="alert"');
    await controller.load();
    const kept = controller.getState().list;
    let release: () => void = () => undefined;
    ports.list.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(fx.page([fx.row('r1')])))),
    );
    const reloading = controller.load();
    await fx.flush();
    expect(controller.getState()).toMatchObject({ phase: 'refreshing', list: kept });
    release();
    await reloading;
    ports.list.mockRejectedValueOnce(fx.http(500, 'E_SYS_INTERNAL'));
    await controller.load();
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().list).not.toBeNull();
    expect(classify(fx.timeout())).toEqual({ kind: 'unknown' });
    expect(classify(fx.http(503, 'E_SYS_UNAVAILABLE'))).toEqual({ kind: 'unknown' });
    expect(classify(new Error('schema'))).toEqual({ kind: 'unknown' });
    ports.list.mockResolvedValueOnce(fx.page([]));
    await controller.load();
    expect(tableMarkup(controller.getState())).toContain('Không có hồ sơ nào');
  });

  it('redacted_evidence_and_logs', async () => {
    const error = fx.http(422, 'E_VALIDATION', { details: [{ field: 'note', issue: 'REQUIRED' }] });
    expect(evidenceOf(error)).toEqual({ code: 'E_VALIDATION', status: 422, traceId: 'trace-1' });
    expect(evidenceOf(new Error('Nguyen Van A'))).toEqual({});
    const { controller, ports } = fx.setup();
    await controller.load();
    ports.send.mockRejectedValueOnce(
      new ApiError({ kind: 'timeout', message: 'PII Nguyen Van A', traceId: 'trace-2' }),
    );
    await controller.submitCreate({
      ...fx.DRAFT,
      note: 'SECRET-REASON-ABCDEFGHIJ',
      evidence: 'file-secret1',
    });
    const state = controller.getState();
    const shown = JSON.stringify(state.command) + JSON.stringify(state.evidence);
    for (const secret of ['SECRET-REASON', 'file-secret1', 'Nguyen', 'key-1', 'Idempotency'])
      expect(shown).not.toContain(secret);
    expect(failed(state)).toContain('trace-2');
    ports.verifyPin.mockRejectedValueOnce(
      fx.http(403, 'E_AUTH_PIN_LOCKED', { traceId: 'trace-9' }),
    );
    controller.discardPending();
    await controller.submitApprove('r1', '', '654321');
    expect(failed(controller.getState())).toContain('trace-9');
    expect(controller.getState().phase).toBe('ready');
    expect(JSON.stringify(controller.getState())).not.toContain('654321');
  });
});
