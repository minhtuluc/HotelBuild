import { Client } from 'pg';
import type { HealthProbe } from './health-probe.js';

/** Kiểm tra PostgreSQL bằng một câu `select 1` qua thư viện `pg`. */
export class PostgresHealthProbe implements HealthProbe {
  readonly name = 'postgres';

  constructor(private readonly connectionString: string) {}

  async check(): Promise<boolean> {
    const client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 1000,
    });
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
