/** Nguồn trạng thái mạng — phần thuần bơm được để test nhánh offline. */
export interface NetInfoSource {
  getConnected(): Promise<boolean>;
}

export class OfflineError extends Error {
  constructor() {
    super('Cần kết nối mạng.');
    this.name = 'OfflineError';
  }
}

/** Ném `OfflineError` khi mất mạng để UI hiện "cần kết nối" mà không gửi request. */
export async function requireOnline(source: NetInfoSource): Promise<void> {
  if (!(await source.getConnected())) throw new OfflineError();
}
