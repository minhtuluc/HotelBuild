import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { RuntimeSettings } from './runtime-port.js';
import { missing, safeError } from './validation.js';
const TTL_MS = 60000;
const fresh = (readAt: number, now: number) => now >= readAt && now - readAt < TTL_MS;
/** No auth data here. A generation prevents an old, in-flight DB read from restoring stale cache. */
export class RuntimeSettingsReader implements RuntimeSettings {
  private readonly values = new Map<string, { value: string; readAt: number }>();
  private readonly generations = new Map<string, number>();
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: Clock,
  ) {}
  invalidate(key: string): void {
    this.values.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }
  async get(key: string): Promise<string> {
    const readAt = this.clock.now().getTime(),
      entry = this.values.get(key);
    if (entry && fresh(entry.readAt, readAt)) return entry.value;
    this.values.delete(key);
    const generation = this.generations.get(key) ?? 0;
    try {
      const row = await this.db.system_settings.findUnique({
        where: { key },
        select: { value: true },
      });
      if (!row) throw missing();
      const now = this.clock.now().getTime();
      if (generation === (this.generations.get(key) ?? 0) && fresh(readAt, now))
        this.values.set(key, { value: row.value, readAt });
      return row.value;
    } catch (error) {
      safeError(error);
    }
  }
}
