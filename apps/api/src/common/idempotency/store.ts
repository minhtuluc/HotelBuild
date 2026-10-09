import { Prisma } from '@prisma/client';
import type { PrismaClient, idempotency_keys } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AppError } from '../app-error.js';
import type { RequestIdentity } from './request.js';
import { canonicalJson } from './request.js';
import { normalizeResponse } from './response.js';

export interface CommandResponse {
  readonly status: number;
  readonly body: Prisma.JsonValue;
  readonly headers: Readonly<Record<string, string>>;
}
export interface Claim {
  readonly kind: 'claim';
  readonly id: string;
  readonly token: string;
}
export interface Replay {
  readonly kind: 'replay';
  readonly response: CommandResponse;
}
export const inProgress = () =>
  new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Yêu cầu đang được xử lý.', 1);
const reused = () =>
  new AppError(409, 'E_SYS_IDEMPOTENCY_KEY_REUSED', 'Khoá đã dùng cho yêu cầu khác.');
const DAY = 24 * 60 * 60 * 1000;
const LEASE = 30000;
const transactionOptions = { maxWait: 1000, timeout: 10000 };
function isLockTimeout(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010' &&
    error.meta?.code === '55P03'
  );
}
export class IdempotencyStore {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}
  async purgeExpired(): Promise<number> {
    const now = this.clock.now();
    return this.db.$executeRaw`WITH expired AS (
      SELECT id FROM idempotency_keys WHERE expires_at<=${now}
      AND (status='COMPLETED' OR lease_expires_at<=${now})
      ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
    ) DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM expired)`;
  }
  async claim(input: RequestIdentity): Promise<Claim | Replay> {
    const where = {
      principal_type: input.principal.type,
      principal_id: input.principal.id,
      method: input.method,
      path: input.path,
      key: input.key,
    };
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
        const lock = canonicalJson([
          where.principal_type,
          where.principal_id,
          where.method,
          where.path,
          where.key,
        ]);
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        const matching = await tx.$queryRaw<idempotency_keys[]>`SELECT * FROM idempotency_keys
          WHERE principal_type::text=${where.principal_type} AND principal_id=${where.principal_id}
          AND method=${where.method} AND path=${where.path} AND key=${where.key} FOR UPDATE`;
        const now = this.clock.now();
        const current = matching[0];
        if (current) {
          if (current.expires_at.getTime() <= now.getTime()) {
            if (
              current.status === 'IN_PROGRESS' &&
              current.lease_expires_at.getTime() > now.getTime()
            )
              throw inProgress();
            await tx.idempotency_keys.delete({ where: { id: current.id } });
          } else {
            if (current.request_hash !== input.requestHash) throw reused();
            if (current.status === 'COMPLETED')
              return { kind: 'replay', response: readResponse(current) };
            if (current.lease_expires_at.getTime() > now.getTime()) throw inProgress();
            const token = this.ids.generate();
            await tx.idempotency_keys.update({
              where: { id: current.id },
              data: {
                lease_token: token,
                lease_expires_at: new Date(now.getTime() + LEASE),
                updated_at: now,
              },
            });
            return { kind: 'claim', id: current.id, token };
          }
        }
        const id = this.ids.generate(),
          token = this.ids.generate();
        await tx.idempotency_keys.create({
          data: {
            ...where,
            id,
            lease_token: token,
            actor_id: input.principal.type === 'USER' ? input.principal.id : null,
            request_hash: input.requestHash,
            lease_expires_at: new Date(now.getTime() + LEASE),
            expires_at: new Date(now.getTime() + DAY),
            created_at: now,
            updated_at: now,
          },
        });
        return { kind: 'claim', id, token };
      }, transactionOptions);
    } catch (error) {
      if (isLockTimeout(error)) throw inProgress();
      throw error;
    }
  }
  async run(
    claim: Claim,
    operation: (tx: Prisma.TransactionClient) => Promise<CommandResponse>,
  ): Promise<CommandResponse> {
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
        await tx.$queryRaw`SELECT id FROM idempotency_keys WHERE id=${claim.id}::uuid FOR UPDATE`;
        const row = await tx.idempotency_keys.findUnique({ where: { id: claim.id } });
        if (
          !row ||
          row.status !== 'IN_PROGRESS' ||
          row.lease_token !== claim.token ||
          row.lease_expires_at.getTime() <= this.clock.now().getTime()
        )
          throw inProgress();
        // The fence row stays locked; each use case owns policy for its business resource locks.
        await tx.$executeRaw`SET LOCAL lock_timeout = DEFAULT`;
        const result = await operation(tx);
        const response = normalizeResponse(result.status, result.body, result.headers);
        const saved = await tx.idempotency_keys.updateMany({
          where: { id: claim.id, lease_token: claim.token, status: 'IN_PROGRESS' },
          data: {
            status: 'COMPLETED',
            response_status: response.status,
            response_body_json: response.body === null ? Prisma.JsonNull : response.body,
            response_headers_json: { ...response.headers },
            updated_at: this.clock.now(),
          },
        });
        if (saved.count !== 1) throw inProgress();
        return response;
      }, transactionOptions);
    } catch (error) {
      // A killed process cannot compensate; its committed claim remains recoverable by lease takeover.
      await this.db.$executeRaw`WITH owned AS (
        SELECT id FROM idempotency_keys WHERE id=${claim.id}::uuid
        AND lease_token=${claim.token}::uuid AND status='IN_PROGRESS' FOR UPDATE SKIP LOCKED
      ) DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM owned)`;
      if (isLockTimeout(error)) throw inProgress();
      throw error;
    }
  }
}
function readResponse(row: {
  response_status: number | null;
  response_body_json: Prisma.JsonValue;
  response_headers_json: Prisma.JsonValue;
}): CommandResponse {
  if (row.response_status === null) throw new Error('Invalid durable response');
  const headers: Record<string, string> = {};
  if (
    typeof row.response_headers_json !== 'object' ||
    row.response_headers_json === null ||
    Array.isArray(row.response_headers_json)
  )
    throw new Error('Invalid durable response headers');
  for (const [name, value] of Object.entries(row.response_headers_json)) {
    if (typeof value !== 'string') throw new Error('Invalid durable response header');
    headers[name] = value;
  }
  return { status: row.response_status, body: row.response_body_json, headers };
}
