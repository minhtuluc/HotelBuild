/**
 * HB-090: hợp đồng F5 khớp ví dụ api.md §3.3/§3.5/§3.6/§3.7, không có dữ liệu thẻ (§2.14),
 * callback PSP chỉ ở OpenAPI cho backend.
 */
import { describe, expect, it } from 'vitest';
import {
  cancelPreviewSchema,
  cancelRequestSchema,
  cancelResponseSchema,
} from '../src/cancellation.js';
import { onlinePaymentCreateRequestSchema, paymentSchema } from '../src/payment.js';
import {
  refundApproveRequestSchema,
  refundDecisionSchema,
  refundRequestCreateRequestSchema,
  refundRequestSchema,
} from '../src/refund.js';
import { errorCatalogue } from '../src/errors.js';
import { buildDocument, serializeDocument } from '../src/openapi/generate.js';

const CANCEL_REQUEST = {
  reason: 'GUEST_REQUEST',
  note: 'Khách đổi kế hoạch',
  isForceMajeure: false,
  evidenceRefs: [],
  bookingRoomIds: [],
};

const CANCEL_RESPONSE = {
  bookingId: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  status: 'CANCELLED',
  cancelledAt: '2026-12-20T07:00:00Z',
  cancelReason: 'GUEST_REQUEST',
  releasedAssignmentCount: 3,
  cancellation: {
    policyId: '17c2f4a8-1a2b-4c3d-8e4f-00000000000c',
    appliedTierId: '90ab1c2d-1a2b-4c3d-8e4f-00000000000d',
    hoursBeforeCheckIn: 96.0,
    refundPercent: 50,
    paidAmount: 1305000,
    requestedAmount: 652000,
    penaltyAmount: 0,
    refundFee: 0,
  },
  refundRequest: {
    id: '5d9e0f21-1a2b-4c3d-8e4f-00000000000e',
    status: 'PENDING',
    approvedAmount: null,
  },
};

const ONLINE_REQUEST = {
  bookingId: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  type: 'DEPOSIT',
  method: 'VNPAY',
  amount: 1305000,
  returnUrl: 'https://pinehill.vn/dat-phong/ket-qua',
};

const PAYMENT_RESPONSE = {
  paymentId: '7e2b9d10-1a2b-4c3d-8e4f-00000000000f',
  bookingId: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  type: 'DEPOSIT',
  method: 'VNPAY',
  amount: 1305000,
  status: 'PENDING',
  providerTxnId: null,
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=130500000',
  expiresAt: '2026-09-19T03:29:02Z',
  paidAt: null,
  createdAt: '2026-09-19T03:14:02Z',
};

const REFUND_REQUEST = {
  bookingId: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  paymentId: 'b93c1e47-1a2b-4c3d-8e4f-000000000010',
  reason: 'GUEST_REQUEST',
  isForceMajeure: false,
  evidenceRefs: [],
  note: 'Khách huỷ trước 4 ngày',
};

const REFUND_RESPONSE = {
  id: '5d9e0f21-1a2b-4c3d-8e4f-00000000000e',
  bookingId: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  paymentId: 'b93c1e47-1a2b-4c3d-8e4f-000000000010',
  policyId: '17c2f4a8-1a2b-4c3d-8e4f-00000000000c',
  hoursBeforeCheckIn: 96.0,
  appliedTierId: '90ab1c2d-1a2b-4c3d-8e4f-00000000000d',
  refundPercent: 50,
  requestedAmount: 652000,
  approvedAmount: null,
  refundFee: 0,
  status: 'PENDING',
  isForceMajeure: false,
  reason: 'GUEST_REQUEST',
  evidenceRefs: [],
  requestedBy: '7f1d5b90-1a2b-4c3d-8e4f-000000000008',
  approvedBy: null,
  decidedAt: null,
  paidAt: null,
  createdAt: '2026-09-19T03:20:11Z',
};

const APPROVE_REQUEST = {
  approvedAmount: 652000,
  note: 'Đúng bậc 72 giờ, hoàn 50%',
  pinToken: 'pin-token-aaaaaaaaaaaaaaaaaaaaaa',
};

const APPROVE_RESPONSE = {
  id: '5d9e0f21-1a2b-4c3d-8e4f-00000000000e',
  status: 'APPROVED',
  requestedAmount: 652000,
  approvedAmount: 652000,
  refundPercent: 50,
  requestedBy: '7f1d5b90-1a2b-4c3d-8e4f-000000000008',
  approvedBy: '2c9d4e15-1a2b-4c3d-8e4f-000000000011',
  decidedAt: '2026-09-19T04:02:37Z',
  auditLogId: 'aa1f6c93-1a2b-4c3d-8e4f-000000000012',
  payoutDeadline: '2026-09-26T04:02:37Z',
};

describe('hợp đồng F5 khớp ví dụ api.md', () => {
  it('Payment giữ createdBy do server trả, phản hồi cũ vẫn đọc được (BR-PAY-06)', () => {
    expect(
      paymentSchema.parse({ ...PAYMENT_RESPONSE, createdBy: 'synthetic-collector' }),
    ).toMatchObject({ createdBy: 'synthetic-collector' });
    expect(paymentSchema.safeParse(PAYMENT_RESPONSE).success).toBe(true);
    expect(paymentSchema.safeParse({ ...PAYMENT_RESPONSE, createdBy: '' }).success).toBe(false);
  });

  it('§3.3 huỷ: nhận request và response kèm khối cancellation + refundRequest', () => {
    const request = cancelRequestSchema.parse(CANCEL_REQUEST);
    expect(request.evidenceRefs).toEqual([]);
    const response = cancelResponseSchema.parse(CANCEL_RESPONSE);
    expect(response.cancellation.hoursBeforeCheckIn).toBe(96);
    expect(response.refundRequest?.approvedAmount).toBeNull();
  });

  it('§3.5 thanh toán trực tuyến: request và response PENDING có URL PSP', () => {
    expect(onlinePaymentCreateRequestSchema.safeParse(ONLINE_REQUEST).success).toBe(true);
    const payment = paymentSchema.parse(PAYMENT_RESPONSE);
    expect(payment.status).toBe('PENDING');
    expect(payment.providerTxnId).toBeNull();
  });

  it('§3.6 yêu cầu hoàn: nhận request và response PENDING', () => {
    const request = refundRequestCreateRequestSchema.parse(REFUND_REQUEST);
    expect(request.evidenceRefs).toEqual([]);
    expect(refundRequestSchema.parse(REFUND_RESPONSE).status).toBe('PENDING');
  });

  it('§3.7 duyệt hoàn: request có pinToken, response có auditLogId + payoutDeadline', () => {
    const request = refundApproveRequestSchema.parse(APPROVE_REQUEST);
    expect(request.pinToken).toBe('pin-token-aaaaaaaaaaaaaaaaaaaaaa');
    expect(refundDecisionSchema.parse(APPROVE_RESPONSE).approvedAmount).toBe(652000);
  });

  it('cancel-preview chỉ mô tả khối hoàn, không đổi trạng thái booking', () => {
    const preview = cancelPreviewSchema.parse({
      bookingId: 'b1',
      currency: 'VND',
      cancellation: {
        policyId: 'p1',
        appliedTierId: 't1',
        hoursBeforeCheckIn: 30,
        refundPercent: 0,
        paidAmount: 1000000,
        requestedAmount: 0,
        penaltyAmount: 1000000,
        refundFee: 0,
      },
    });
    expect(preview.cancellation.refundPercent).toBe(0);
  });

  it('từ chối trường lạ ở request (mass assignment)', () => {
    expect(
      refundRequestCreateRequestSchema.safeParse({ ...REFUND_REQUEST, cardNumber: '4111' }).success,
    ).toBe(false);
    expect(
      onlinePaymentCreateRequestSchema.safeParse({ ...ONLINE_REQUEST, cvv: '123' }).success,
    ).toBe(false);
  });
});

describe('ràng buộc an toàn F5', () => {
  it('không có trường dữ liệu thẻ ở bất kỳ request nào (§2.14, NFR-SEC-02)', () => {
    const document = serializeDocument().toLowerCase();
    for (const token of [
      'cardnumber',
      'cvv',
      'expirymonth',
      'expiryyear',
      'cardholder',
      'cardexpiry',
    ]) {
      expect(document, token).not.toContain(token);
    }
  });

  it('callback PSP chỉ khai trong OpenAPI cho backend (§5.2)', () => {
    const paths = Object.keys(buildDocument().paths ?? {});
    expect(paths).toContain('/api/v1/integrations/psp/vnpay/callback');
    expect(paths).toContain('/api/v1/integrations/psp/momo/callback');
  });

  it('mã lỗi F5 gắn đúng HTTP §4.2', () => {
    expect(errorCatalogue.E_PAY_AMOUNT_MISMATCH.httpStatus).toBe(422);
    expect(errorCatalogue.E_PAY_REFUND_EXCEEDS_PAID.httpStatus).toBe(422);
    expect(errorCatalogue.E_PAY_SELF_APPROVAL.httpStatus).toBe(403);
    expect(errorCatalogue.E_PAY_REFUND_NOT_APPROVED.httpStatus).toBe(409);
    expect(errorCatalogue.E_PAY_GATEWAY_ERROR.httpStatus).toBe(502);
    expect(errorCatalogue.E_PAY_GATEWAY_TIMEOUT.httpStatus).toBe(504);
    expect(errorCatalogue.E_CANCEL_NOT_ALLOWED.httpStatus).toBe(409);
    expect(errorCatalogue.E_PAY_SIGNATURE_INVALID.httpStatus).toBe(401);
  });
});
