/**
 * Công cụ ca lỗi CSDL **thật**: đổi tên một bảng bằng vai sở hữu do `scripts/migrate.mjs` tạo trong lúc
 * đang chạy rồi đổi lại. Không mock tầng nào — Prisma nhận lỗi "quan hệ không tồn tại", nên các nhánh
 * chịu lỗi của service (ghi inbox, áp dụng sự kiện) đi đúng đường thật của production.
 */
import { rows } from './fixture.js';

export class TableOutage {
  private constructor(
    private readonly table: string,
    private readonly label: string,
  ) {}

  static async start(table: string, label: string): Promise<TableOutage> {
    await rows(`ALTER TABLE ${table} RENAME TO ${table}_${label}`);
    return new TableOutage(table, label);
  }

  /** Luôn gọi trong `finally`: để lại trạng thái schema đúng cho các ca sau. */
  async restore(): Promise<void> {
    await rows(`ALTER TABLE ${this.table}_${this.label} RENAME TO ${this.table}`);
  }
}
