import { Client } from 'pg';
import type { HealthProbe } from './health-probe.js';

/** Bề mặt tối thiểu của client PostgreSQL để kiểm tra sống, tách ra để test mock được. */
export interface PgProbeClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
}

/** Kiểm tra PostgreSQL bằng một câu `select 1` qua `pg`. */
export class PostgresHealthProbe implements HealthProbe {
  readonly name = 'postgres';

  constructor(
    private readonly connectionString: string,
    private readonly createClient: (connectionString: string) => PgProbeClient = (cs) =>
      new Client({ connectionString: cs, connectionTimeoutMillis: 1000 }),
  ) {}

  async check(): Promise<boolean> {
    const client = this.createClient(this.connectionString);
    try {
      await client.connect();
      await client.query('select 1');
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
