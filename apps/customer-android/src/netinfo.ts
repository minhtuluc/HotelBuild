export interface NetInfoSource {
  getConnected(): Promise<boolean>;
}

export class OfflineError extends Error {
  constructor() {
    super('Cần kết nối mạng.');
    this.name = 'OfflineError';
  }
}

export async function requireOnline(source: NetInfoSource): Promise<void> {
  if (!(await source.getConnected())) throw new OfflineError();
}
