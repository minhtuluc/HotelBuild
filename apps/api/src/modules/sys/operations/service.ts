import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { OperationStatusView } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden } from '../../sys/settings/validation.js';
import { projectOperation } from './projection.js';
import type { OperationRow } from './projection.js';
import { downloadSignature, signatureMatches } from './signature.js';
import { downloadQuery, exportPayloadSchema } from './validation.js';

/** Tệp xuất chỉ sống trong thư mục cấu hình; chặn mọi đường dẫn khác (không đọc tệp tuỳ ý). */
export function insideExportDir(exportDir: string, path: string): boolean {
  const base = exportDir.endsWith('/') ? exportDir : `${exportDir}/`;
  return path.startsWith(base) && !path.includes('..');
}

export interface DownloadArtifact {
  readonly path: string;
  readonly fileName: string;
  readonly contentType: string;
}

function notFound(): AppError {
  return new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy thao tác.');
}

/**
 * HB-163/UC-REP — theo dõi thao tác bất đồng bộ và phục vụ tệp xuất có hạn. Quyền: **chỉ người tạo**
 * hoặc OWNER (api.md §6.3; AC1 của HB-163).
 */
export class OperationsService {
  constructor(
    readonly db: PrismaClient,
    readonly exportDir: string,
    readonly secret: string,
    readonly now: () => Date = () => new Date(),
  ) {}

  private async load(id: string): Promise<OperationRow> {
    const rows = await this.db.$queryRaw<OperationRow[]>`
      SELECT id, kind, status, requested_by, property_scope, payload_json, result_path,
             result_expires_at, error_code, error_message
        FROM operations WHERE id = ${id}::uuid`;
    const row = rows[0];
    if (row === undefined) throw notFound();
    return row;
  }

  /**
   * api.md §6.4 — `GET /operations/{id}` kiểm **người khởi tạo/quyền hiện tại**: chỉ người đã yêu cầu (hoặc
   * OWNER) và chỉ khi phạm vi cơ sở của họ **hiện vẫn bao phủ** ảnh chụp lúc yêu cầu. Thu hẹp quyền sau đó
   * thì thao tác cũ không còn đọc được (BR-RBAC-02; BR-GEN-08 “kiểm tra quyền hiện tại trước trả kết quả lưu”).
   */
  private authorize(actor: AuthorizedActor, row: OperationRow): void {
    if (actor.isOwner()) return;
    if (row.requested_by !== actor.id) throw forbidden();
    if (!row.property_scope.every((propertyId) => actor.canActOn(propertyId))) throw forbidden();
  }

  /** Link ký chỉ sinh khi tệp còn hạn; hết hạn thì không trả (client thấy thao tác đã xong nhưng hết tệp). */
  private resultRef(row: OperationRow): string | undefined {
    if (row.status !== 'SUCCEEDED' || row.result_expires_at === null) return undefined;
    const expiresAt = Math.floor(row.result_expires_at.getTime() / 1000);
    if (expiresAt <= Math.floor(this.now().getTime() / 1000)) return undefined;
    const signature = downloadSignature(this.secret, row.id, expiresAt);
    return `/api/v1/operations/${row.id}/download?expires=${expiresAt}&signature=${signature}`;
  }

  async status(actor: AuthorizedActor, id: string): Promise<OperationStatusView> {
    const row = await this.load(id);
    this.authorize(actor, row);
    return projectOperation(row, this.resultRef(row));
  }

  /**
   * Tệp còn dùng được không: thao tác đã xong, hạn đã ký khớp `result_expires_at`, chưa quá hạn và tệp còn
   * trên đĩa. Quá hạn thì dọn tệp ngay tại chỗ đọc (best-effort) để không để rác trong thư mục tạm.
   */
  private async artifactStale(row: OperationRow, expires: number): Promise<boolean> {
    const path = row.result_path;
    if (row.status !== 'SUCCEEDED' || path === null) return true;
    if (!insideExportDir(this.exportDir, path)) throw new Error('OPE_RESULT_PATH_DENIED');
    const expired =
      row.result_expires_at === null ||
      Math.floor(row.result_expires_at.getTime() / 1000) !== expires ||
      expires <= Math.floor(this.now().getTime() / 1000);
    if (expired) {
      await rm(path, { force: true });
      return true;
    }
    return !existsSync(path);
  }

  async download(actor: AuthorizedActor, id: string, query: unknown): Promise<DownloadArtifact> {
    const row = await this.load(id);
    this.authorize(actor, row);
    const { expires, signature } = downloadQuery(query);
    if (await this.artifactStale(row, expires)) throw notFound();
    const path = row.result_path;
    if (path === null) throw notFound();
    if (!signatureMatches(this.secret, row.id, expires, signature)) throw forbidden();
    const payload = exportPayloadSchema.safeParse(row.payload_json);
    if (!payload.success) throw new Error('OPE_PAYLOAD_INVALID');
    return {
      path,
      fileName: `report-${row.id}.${payload.data.format === 'CSV' ? 'csv' : 'xlsx'}`,
      contentType:
        payload.data.format === 'CSV'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
