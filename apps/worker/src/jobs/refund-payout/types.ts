/** Kiểu dùng chung của job chi hoàn (HB-100, ADR-016). */
export interface ClaimedPayout {
  readonly id: string;
  readonly refundRequestId: string;
  readonly refundAllocationId: string;
  readonly originalPaymentId: string;
  readonly refundPaymentId: string;
  readonly method: string;
  readonly amount: bigint;
  readonly bankNote: string | null;
  readonly pspKey: string;
  readonly attempts: number;
  readonly leaseToken: string;
  readonly version: bigint;
}

/** Kết quả đối soát/khởi tạo phía PSP — `UNKNOWN` không chứng minh đã/không chi (ADR-016). */
export type TransferResult =
  | { readonly state: 'SUCCEEDED'; readonly providerTxnId: string }
  | { readonly state: 'FAILED' }
  | { readonly state: 'NOT_FOUND' }
  | { readonly state: 'UNKNOWN' };

export interface PayoutGateway {
  /** `false` ⇒ provider không hỗ trợ gửi/đối soát tự động: chuyển đối soát tay, không tự gửi lại. */
  readonly automatic: boolean;
  /** Mã lý do ổn định khi không tự chi được (ghi `last_error`). */
  readonly blockedCode?: string;
  /** Hỏi PSP theo khoá bền trước mọi lần thử lại. */
  query(pspKey: string): Promise<TransferResult>;
  submit(request: {
    readonly pspKey: string;
    readonly method: string;
    readonly amount: bigint;
  }): Promise<TransferResult>;
}
