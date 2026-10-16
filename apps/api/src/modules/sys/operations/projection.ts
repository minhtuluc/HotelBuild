import type { OperationStatusView } from '@pinehill/contracts';

/** Dòng `operations` cần cho phản hồi trạng thái (đọc bằng SQL thô — bảng không khai trong Prisma). */
export interface OperationRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly requested_by: string;
  readonly property_scope: readonly string[];
  readonly payload_json: unknown;
  readonly result_path: string | null;
  readonly result_expires_at: Date | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
}

const OPERATION_STATUSES: Readonly<Record<string, true>> = {
  PENDING: true,
  RUNNING: true,
  SUCCEEDED: true,
  FAILED: true,
};

function isOperationStatus(value: string): value is OperationStatusView['status'] {
  return OPERATION_STATUSES[value] === true;
}

/**
 * `resultRef` chỉ xuất hiện khi thao tác đã xong **và** tệp còn hạn; hết hạn thì bỏ trường này (hợp đồng
 * cho phép vắng) vì link ký đã vô hiệu — không trả link chết cho client.
 */
export function projectOperation(
  row: OperationRow,
  resultRef: string | undefined,
): OperationStatusView {
  if (!isOperationStatus(row.status)) throw new Error('OPE_UNKNOWN_STATUS');
  return {
    operationId: row.id,
    status: row.status,
    ...(resultRef === undefined ? {} : { resultRef }),
    ...(row.status === 'FAILED' && row.error_code !== null ? { errorCode: row.error_code } : {}),
    ...(row.status === 'FAILED' && row.error_message !== null
      ? { errorMessage: row.error_message }
      : {}),
  };
}
