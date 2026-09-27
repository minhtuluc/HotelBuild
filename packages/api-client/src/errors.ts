import { isErrorCode, type ErrorCode } from '@pinehill/contracts';

/** Nguồn gốc thất bại: HTTP có bao lỗi, hết thời gian, lỗi mạng, người gọi huỷ, hay phản hồi sai hợp đồng. */
export type ApiFailureKind = 'http' | 'timeout' | 'network' | 'aborted' | 'protocol';

export interface ApiErrorInit {
  kind: ApiFailureKind;
  message: string;
  status?: number | undefined;
  code?: string | undefined;
  traceId?: string | undefined;
  details?: { field: string; issue: string }[] | undefined;
  correlationId?: string | undefined;
  retryable?: boolean | undefined;
}

/**
 * Lỗi đã chuẩn hoá từ bao lỗi api.md §4.1.
 * UI chỉ được suy hành vi từ `code`, không từ `message` (thiết kế màn hình §8.1).
 */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly traceId: string | undefined;
  readonly details: { field: string; issue: string }[] | undefined;
  readonly correlationId: string | undefined;
  readonly retryable: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.traceId = init.traceId;
    this.details = init.details;
    this.correlationId = init.correlationId;
    this.retryable = init.retryable ?? false;
  }

  /** Mã lỗi đã biết trong danh mục §4.2; `undefined` nếu server trả mã mới. */
  get knownCode(): ErrorCode | undefined {
    return this.code !== undefined && isErrorCode(this.code) ? this.code : undefined;
  }

  hasCode(code: ErrorCode): boolean {
    return this.code === code;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
