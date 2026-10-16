import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { OperationRef } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { ReportsService } from '../reports/service.js';
import {
  adrRevparInput,
  cancellationsInput,
  occupancyInput,
  revenueByChannelInput,
} from '../reports/validation.js';
import type { ExportInput } from './validation.js';
import type { ExportQueue } from './queue.js';

/** Trần ảnh chụp kết quả: giữ truy vấn và bản ghi `operations` có biên; vượt thì yêu cầu thu hẹp kỳ. */
export const MAX_EXPORT_PAYLOAD_BYTES = 8 * 1024 * 1024;

/** Vai trò của chính tuyến xuất (api.md §2.12): kế toán và chủ chuỗi. */
const EXPORT_ROLES = ['ACCOUNTANT', 'OWNER'] as const;

export class ReportExportService {
  constructor(
    readonly db: PrismaClient,
    readonly queue: ExportQueue,
    readonly audit: AuditWriter,
    readonly clock: Clock,
    readonly timezone: string,
    readonly maxPayloadBytes: number = MAX_EXPORT_PAYLOAD_BYTES,
  ) {}

  /**
   * Chạy đúng truy vấn mà màn hình dùng (`ReportsService`) nên số trong tệp khớp số trên màn hình
   * (HB-163 AC3), rồi lưu ảnh chụp cho worker sinh CSV/XLSX. Bộ lọc đã kiểm ở `exportInput`.
   */
  private async snapshot(actor: AuthorizedActor, input: ExportInput): Promise<object> {
    const reports = new ReportsService(this.db, this.timezone);
    switch (input.report) {
      case 'occupancy':
        return reports.occupancy(actor, occupancyInput(input.params), EXPORT_ROLES);
      case 'adr-revpar':
        return reports.adrRevpar(actor, adrRevparInput(input.params), EXPORT_ROLES);
      case 'revenue-by-channel':
        return reports.revenueByChannel(actor, revenueByChannelInput(input.params), EXPORT_ROLES);
      case 'cancellations':
        return reports.cancellations(actor, cancellationsInput(input.params), EXPORT_ROLES);
    }
  }

  /**
   * Ghi yêu cầu trong **transaction của interceptor idempotency** (`tx` do `IdempotencyContext` cấp):
   * hàng `operations`, bản ghi audit và bản ghi khoá cùng commit hoặc cùng biến mất (HB-029).
   *
   * Ảnh chụp vẫn đọc qua `this.db` vì `ReportsService` tự mở transaction `RepeatableRead` và
   * `Prisma.TransactionClient` không có `$transaction`; câu đọc chạy trước mọi câu ghi nên không phá
   * tính nguyên tử của phần ghi.
   *
   * Hệ quả đã biết: ảnh chụp nằm trong transaction của interceptor (timeout 10 giây, `IdempotencyStore`)
   * nên một báo cáo chạy lâu hơn ngưỡng đó làm hỏng cả lệnh; claim được bù nên client gọi lại **cùng khoá**
   * là an toàn. Trần 8 MB và thời gian truy vấn trong request vốn đã là giới hạn đã ghi trong README.
   */
  async request(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    input: ExportInput,
  ): Promise<OperationRef> {
    const snapshot = await this.snapshot(actor, input);
    const resultJson = JSON.stringify(snapshot);
    if (Buffer.byteLength(resultJson, 'utf8') > this.maxPayloadBytes)
      throw new AppError(
        400,
        'E_GEN_VALIDATION_FAILED',
        'Kết quả vượt trần một tệp xuất; hãy thu hẹp kỳ báo cáo.',
      );
    const operationId = randomUUID();
    const scope = Prisma.sql`ARRAY[${Prisma.join(
      actor.propertyScope.map((id) => Prisma.sql`${id}::uuid`),
    )}]::uuid[]`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO operations(id, kind, status, requested_by, property_scope, payload_json, result_json)
      VALUES(${operationId}::uuid, 'REPORT_EXPORT', 'PENDING', ${actor.id}::uuid, ${scope},
             ${JSON.stringify({ report: input.report, format: input.format, params: input.params })}::jsonb,
             ${resultJson}::jsonb)`);
    await this.audit.record(tx, {
      actor,
      action: 'REPORT_EXPORT_REQUESTED',
      entityType: 'Operation',
      entityId: operationId,
      beforeJson: null,
      afterJson: { report: input.report, format: input.format, params: input.params },
      reason: null,
    });
    /**
     * `enqueue` nằm trong transaction của interceptor nên chạy **trước** commit: rollback sau đây để lại
     * một job mồ côi (worker `reportExportJob` coi hàng `operations` không tồn tại là no-op). Chấp nhận
     * vì HB-130 (outbox relay) chưa có — **không** dời sang phát sau commit ở đây.
     */
    await this.queue.enqueue(operationId);
    return {
      operationId,
      status: 'PENDING',
      statusUrl: `/api/v1/operations/${operationId}`,
    };
  }
}
