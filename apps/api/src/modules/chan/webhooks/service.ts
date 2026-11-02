/**
 * Nhận webhook OTA simulator (HB-128; api.md §5.1, §5.3; ADR-017 quyết định 3–5).
 *
 * Thứ tự bắt buộc: `{channel}` → provider → account/khoá **từ cấu hình** → xác minh HMAC trên raw bytes
 * + cửa sổ ±300 giây → đối chiếu `providerAccountId` → validate payload → ghi bền `webhook_inbox` →
 * **chỉ sau đó** ACK. Mọi bước xác minh đều đứng trước dedup: một sự kiện giả mạo không chiếm được khoá
 * `(provider, account, eventId)` của lần gửi hợp lệ sau đó (AC2, AC3).
 *
 * Dedup HTTP 7 ngày dựa trên UNIQUE của inbox, không TTL: cùng hash là bản phát lại hợp lệ (`200`), khác
 * hash là `409 E_CHAN_REPLAY_DETECTED` giữ nguyên bản gốc kèm dấu đối soát trong `audit_logs` (AC6, AC7).
 * Redis/queue **không** nằm trên đường cam kết: commit inbox là ACK, HB-129 quét `PENDING` để phục hồi.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger } from 'nestjs-pino';
import type { Prisma } from '@prisma/client';
import { otaWebhookSignatureSchema, type OtaInboxAck } from '@pinehill/contracts';
import type { Clock } from '@pinehill/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { WEBHOOK_INBOX } from '../../integrations/inbox/module.js';
import type { InboxReceipt, InboxRow, WebhookInbox } from '../../integrations/inbox/store.js';
import { RUNTIME_SETTINGS, type RuntimeSettings } from '../../sys/settings/runtime-port.js';
import {
  ADAPTER_CONFIG_KEY,
  findAccount,
  hashPayload,
  normalizeEvent,
  parseAccounts,
  parseEvent,
  providerOf,
  verifySignature,
  type OtaAccount,
  type OtaAccounts,
  type OtaProvider,
} from '../adapters/ota.js';

interface WebhookLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface OtaWebhookAck {
  readonly status: 200 | 202;
  readonly body: OtaInboxAck;
}

interface WebhookHeaders {
  readonly signature: string;
  readonly keyId: string;
  readonly eventId: string;
}

interface StoredEvent {
  readonly provider: OtaProvider;
  readonly account: OtaAccount;
  readonly eventId: string;
  readonly payloadHash: string;
  readonly payload: Prisma.InputJsonValue;
  readonly now: Date;
  readonly actor: { readonly ip: string | null; readonly correlationId: string };
}

function signatureInvalid(): AppError {
  return new AppError(401, 'E_CHAN_SIGNATURE_INVALID', 'Chữ ký webhook không hợp lệ.');
}

function invalidRequest(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu webhook không hợp lệ.');
}

function unavailable(): AppError {
  return new AppError(503, 'E_GEN_SERVICE_UNAVAILABLE', 'Chưa ghi nhận được sự kiện.');
}

const eventIdSchema = z.string().trim().min(1).max(128);
const keyIdSchema = z.string().trim().min(1).max(64);

/**
 * Header theo HB-120: hình dạng chữ ký/khoá sai ⇒ `401` (header transport hỏng), thiếu/sai event ID ⇒
 * `400` (yêu cầu thiếu trường, không phải lỗi xác thực) — đúng ca `durable-before-202`.
 */
function readHeaders(headers: FastifyRequest['headers']): WebhookHeaders {
  const signature = otaWebhookSignatureSchema.safeParse(headers['x-pinehill-signature']);
  const keyId = keyIdSchema.safeParse(headers['x-pinehill-key-id']);
  if (!signature.success || !keyId.success) throw signatureInvalid();
  const eventId = eventIdSchema.safeParse(headers['x-channel-event-id']);
  if (!eventId.success) throw invalidRequest();
  return { signature: signature.data, keyId: keyId.data, eventId: eventId.data };
}

@Injectable()
export class OtaWebhookService {
  constructor(
    @Inject(WEBHOOK_INBOX) private readonly inbox: WebhookInbox,
    @Inject(RUNTIME_SETTINGS) private readonly settings: RuntimeSettings,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectPinoLogger(OtaWebhookService.name) private readonly logger: WebhookLogger,
  ) {}

  /** Một request HTTP: không ném lỗi lạ ra ngoài — mọi kết cục là ACK hoặc `AppError` theo api.md §4.2. */
  async receive(channel: string, request: FastifyRequest): Promise<OtaWebhookAck> {
    const provider = providerOf(channel);
    if (provider === null) throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy kênh OTA.');
    const headers = readHeaders(request.headers);
    const raw = request.chanRawBody ?? Buffer.alloc(0);
    const account = await this.accountOf(provider, headers.keyId);
    const now = this.clock.now();
    const correlationId = String(request.id);
    if (!this.verified(provider, headers, raw, account, now, correlationId))
      throw signatureInvalid();
    const event = parseEvent(raw);
    if (event === null) throw invalidRequest();
    if (event.providerAccountId !== account.accountId) {
      this.logger.warn(
        {
          event: 'OTA_ACCOUNT_BINDING_MISMATCH',
          provider,
          eventId: headers.eventId,
          correlationId,
        },
        'Payload account does not match the configured signing key',
      );
      throw signatureInvalid();
    }
    const payload = normalizeEvent(provider, event);
    return this.store({
      provider,
      account,
      eventId: headers.eventId,
      payloadHash: hashPayload(payload),
      payload,
      now,
      actor: { ip: request.ip ?? null, correlationId },
    });
  }

  /** `true` khi chữ ký/timestamp hợp lệ; log **chỉ** định danh, không payload/bí mật (AC9). */
  private verified(
    provider: OtaProvider,
    headers: WebhookHeaders,
    raw: Buffer,
    account: OtaAccount | null,
    now: Date,
    correlationId: string,
  ): account is OtaAccount {
    const ok =
      account !== null &&
      verifySignature({
        header: headers.signature,
        raw,
        secret: account.secret,
        nowSeconds: Math.floor(now.getTime() / 1000),
      });
    if (!ok)
      this.logger.warn(
        { event: 'OTA_SIGNATURE_INVALID', provider, eventId: headers.eventId, correlationId },
        'OTA webhook signature rejected',
      );
    return ok;
  }

  private async accountOf(provider: OtaProvider, keyId: string): Promise<OtaAccount | null> {
    const configured = await this.accounts();
    return configured === null ? null : findAccount(configured, provider, keyId);
  }

  /** Cấu hình thiếu khoá ⇒ `null` (401); đọc/parse lỗi ⇒ `503` (lỗi vận hành, không phải lỗi chữ ký). */
  private async accounts(): Promise<OtaAccounts | null> {
    let value: string;
    try {
      value = await this.settings.get(ADAPTER_CONFIG_KEY);
      return parseAccounts(value);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return null;
      this.logger.error(
        { event: 'OTA_ADAPTER_CONFIG_UNAVAILABLE', setting: ADAPTER_CONFIG_KEY },
        'OTA adapter configuration cannot be read',
      );
      throw unavailable();
    }
  }

  private async store(input: StoredEvent): Promise<OtaWebhookAck> {
    let receipt: InboxReceipt;
    try {
      receipt = await this.inbox.receive(
        {
          provider: input.provider,
          providerAccountId: input.account.accountId,
          eventId: input.eventId,
          payloadHash: input.payloadHash,
          payloadJson: input.payload,
          receivedAt: input.now,
        },
        { conflict: (tx, row) => this.recordConflict(tx, input, row) },
      );
    } catch {
      this.logger.error(
        {
          event: 'OTA_INBOX_WRITE_FAILED',
          provider: input.provider,
          eventId: input.eventId,
          correlationId: input.actor.correlationId,
        },
        'OTA webhook inbox not stored',
      );
      throw unavailable();
    }
    if (receipt.created) {
      this.logger.info(
        {
          event: 'OTA_INBOX_ACCEPTED',
          provider: input.provider,
          eventId: input.eventId,
          correlationId: input.actor.correlationId,
        },
        'OTA event stored',
      );
      return { status: 202, body: { duplicate: false, eventId: input.eventId } };
    }
    if (receipt.hashMatches) {
      this.logger.info(
        {
          event: 'OTA_INBOX_DUPLICATE',
          provider: input.provider,
          eventId: input.eventId,
          correlationId: input.actor.correlationId,
        },
        'OTA event replayed within the dedup window',
      );
      return { status: 200, body: { duplicate: true, eventId: input.eventId } };
    }
    this.logger.warn(
      {
        event: 'OTA_REPLAY_DETECTED',
        provider: input.provider,
        eventId: input.eventId,
        correlationId: input.actor.correlationId,
      },
      'Same event id delivered with a different payload',
    );
    throw new AppError(409, 'E_CHAN_REPLAY_DETECTED', 'Sự kiện đã được nhận với nội dung khác.');
  }

  /** Dấu đối soát trong **cùng** transaction của inbox: chỉ hash, không PII, không ghi đè bản gốc. */
  private async recordConflict(
    tx: Prisma.TransactionClient,
    input: StoredEvent,
    row: InboxRow,
  ): Promise<void> {
    await this.audit.record(tx, {
      actor: {
        id: null,
        role: 'SYSTEM',
        ip: input.actor.ip,
        correlationId: input.actor.correlationId,
      },
      action: 'CHANNEL_WEBHOOK_PAYLOAD_MISMATCH',
      entityType: 'WebhookInbox',
      entityId: row.id,
      beforeJson: {
        provider: input.provider,
        eventId: input.eventId,
        eventType: 'stored',
        payloadHash: row.payload_hash,
      },
      afterJson: {
        provider: input.provider,
        eventId: input.eventId,
        eventType: 'rejected',
        payloadHash: input.payloadHash,
      },
      reason: 'Same event id delivered with a different payload',
    });
  }
}
