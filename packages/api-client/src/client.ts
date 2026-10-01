import { errorBodySchema, operationRefSchema } from '@pinehill/contracts';
import { ApiError, type ApiFailureKind } from './errors.js';

/** Bộ giải mã đầu ra: schema zod của contracts thoả cấu trúc này. */
export interface Decoder<T> {
  parse(input: unknown): T;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** Server phát lại kết quả cũ (header `Idempotency-Replayed`) — không tạo bản ghi mới. */
  replayed: boolean;
  etag: string | undefined;
  traceId: string | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | undefined;

export interface RequestBase {
  method: HttpMethod;
  /** Đường dẫn tương đối trong /api/v1, ví dụ `/auth/login`. */
  path: string;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  /** Khoá idempotency do client sinh; bỏ trống thì client tự sinh (api.md §1.3). */
  idempotencyKey?: string;
  /** Phiên bản đọc gần nhất cho lệnh sửa đối tượng đã tồn tại; thiếu → 428, lệch → 412. */
  ifMatch?: string;
  /** Chèn `pinToken` vào body theo api.md §2 (cột yêu cầu của endpoint 🔒). */
  pinProtected?: boolean;
  correlationId?: string;
  signal?: AbortSignal;
  /** Ghi đè số lần gửi tối đa của client; `1` = không tự gửi lại (vd. `POST /users`). */
  maxAttempts?: number;
}

export interface RequestSpec<T> extends RequestBase {
  decoder: Decoder<T>;
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  getPinToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  createId?: () => string;
  timeoutMs?: number;
  /** Tổng số lần gửi tối đa, tính cả lần đầu. */
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

const WRITE_METHODS: ReadonlyArray<HttpMethod> = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Mã lỗi trả về mãi cùng kết quả khi gửi lại (api.md §1.6): 502/503/504 và khoá đang giữ. */
function isRetryableStatus(status: number, code: string | undefined): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 409 && code === 'E_SYS_REQUEST_IN_PROGRESS';
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && String(seconds) === value.trim())
    return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

/** Phân loại lỗi kết nối để UI biết có nên gửi lại hay không. */
function connectionFailure(
  callerAborted: boolean,
  timedOut: boolean,
): { kind: ApiFailureKind; message: string; retryable: boolean } {
  if (callerAborted) return { kind: 'aborted', message: 'Yêu cầu đã bị huỷ.', retryable: false };
  if (timedOut) return { kind: 'timeout', message: 'Hết thời gian chờ phản hồi.', retryable: true };
  return { kind: 'network', message: 'Không kết nối được máy chủ.', retryable: true };
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Nguồn ngẫu nhiên tối thiểu cần có (có ở web và ở Node; RN truyền qua `createId`). */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** UUIDv4 từ nguồn ngẫu nhiên mật mã; đặt đúng bit version/variant theo RFC 4122. */
function uuidV4FromRandomValues(cryptoApi: RandomSource): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Nguồn ID mặc định cho `Idempotency-Key`/mã tương quan.
 * Không có nguồn an toàn thì **dừng ngay** thay vì sinh ID yếu bằng `Math.random`
 * (hợp đồng yêu cầu UUIDv4 — api.md §1.3); React Native truyền `createId` từ expo-crypto.
 */
function requireSecureIdFactory(): () => string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return () => cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const source: RandomSource = cryptoApi;
    return () => uuidV4FromRandomValues(source);
  }
  throw new Error(
    'Không có nguồn ngẫu nhiên an toàn để sinh UUIDv4; truyền `createId` (ví dụ expo-crypto randomUUID) khi tạo ApiClient.',
  );
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly createId: () => string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.createId = options.createId ?? requireSecureIdFactory();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 250;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 4_000;
  }

  /** Lệnh có đầu ra theo hợp đồng. */
  async request<T>(spec: RequestSpec<T>): Promise<ApiResponse<T>> {
    return this.send(spec, (payload: unknown) => spec.decoder.parse(payload));
  }

  /** Lệnh không có thân phản hồi (204) hoặc bỏ qua thân. */
  async requestVoid(spec: RequestBase): Promise<ApiResponse<undefined>> {
    return this.send(spec, () => undefined);
  }

  private async send<T>(
    spec: RequestBase,
    decode: (payload: unknown) => T,
  ): Promise<ApiResponse<T>> {
    const correlationId = spec.correlationId ?? this.createId();
    const isWrite = WRITE_METHODS.includes(spec.method);
    const idempotencyKey = isWrite ? (spec.idempotencyKey ?? this.createId()) : undefined;
    const bodyText = await this.buildBody(spec);
    let lastError: ApiError = new ApiError({ kind: 'network', message: 'Chưa gửi được yêu cầu' });
    const maxAttempts = Math.max(1, spec.maxAttempts ?? this.maxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const outcome = await this.attempt(spec, correlationId, idempotencyKey, bodyText, decode);
      if (outcome.kind === 'ok') return { ...outcome.value, status: outcome.status };
      lastError = outcome.error;
      if (!outcome.error.retryable || attempt === maxAttempts) throw outcome.error;
      const delay =
        outcome.retryAfterMs ??
        Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** (attempt - 1));
      await this.sleep(delay);
    }
    throw lastError;
  }

  private async buildBody(spec: RequestBase): Promise<string | undefined> {
    if (spec.body === undefined) return undefined;
    if (!spec.pinProtected) return JSON.stringify(spec.body);
    const pinToken = await this.options.getPinToken?.();
    if (pinToken === null || pinToken === undefined) {
      throw new ApiError({
        kind: 'http',
        message: 'Thao tác tài chính cần PIN (BR-RBAC-05).',
        status: 401,
        code: 'E_AUTH_PIN_REQUIRED',
      });
    }
    if (typeof spec.body !== 'object' || spec.body === null || Array.isArray(spec.body)) {
      throw new ApiError({
        kind: 'protocol',
        message: 'Body của lệnh có PIN phải là một đối tượng.',
      });
    }
    return JSON.stringify({ ...spec.body, pinToken });
  }

  private async headers(
    spec: RequestBase,
    correlationId: string,
    idempotencyKey: string | undefined,
  ) {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': correlationId,
      ...spec.headers,
    };
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
    if (spec.ifMatch !== undefined) headers['if-match'] = spec.ifMatch;
    const token = await this.options.getAccessToken?.();
    if (token !== null && token !== undefined) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  private async attempt<T>(
    spec: RequestBase,
    correlationId: string,
    idempotencyKey: string | undefined,
    bodyText: string | undefined,
    decode: (payload: unknown) => T,
  ): Promise<AttemptOutcome<T>> {
    const fetched = await this.performFetch(spec, correlationId, idempotencyKey, bodyText);
    if (fetched.kind === 'error') return fetched;
    return this.interpret(fetched, correlationId, decode);
  }

  /**
   * Gửi một lần và **đọc hết thân phản hồi trong cùng hạn thời gian** (F0-07);
   * timer và listener trên tín hiệu người gọi luôn được dọn ở `finally`.
   */
  private async performFetch(
    spec: RequestBase,
    correlationId: string,
    idempotencyKey: string | undefined,
    bodyText: string | undefined,
  ): Promise<FetchedResponse | { kind: 'error'; error: ApiError }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (spec.signal?.aborted === true) controller.abort();
    else spec.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await this.fetchImpl(this.buildUrl(spec), {
        method: spec.method,
        headers: await this.headers(spec, correlationId, idempotencyKey),
        ...(bodyText === undefined ? {} : { body: bodyText }),
        signal: controller.signal,
      });
      // Đọc body trong cùng phạm vi timeout: body treo không được vượt hạn.
      const payload = await readPayload(response);
      return { kind: 'ok', status: response.status, headers: response.headers, payload };
    } catch {
      const callerAborted = spec.signal?.aborted === true;
      const timedOut = !callerAborted && controller.signal.aborted;
      return {
        kind: 'error',
        error: new ApiError({ ...connectionFailure(callerAborted, timedOut), correlationId }),
      };
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  /** Đọc thân phản hồi: lỗi HTTP theo bao lỗi §4.1, thành công thì giải mã theo hợp đồng. */
  private interpret<T>(
    fetched: FetchedResponse,
    correlationId: string,
    decode: (payload: unknown) => T,
  ): AttemptOutcome<T> {
    const { status, headers, payload } = fetched;
    const traceId = headers.get('x-trace-id') ?? undefined;
    if (status < 200 || status >= 300) {
      return {
        kind: 'error',
        error: this.mapError(status, payload, correlationId, traceId),
        retryAfterMs: readRetryAfterMs(headers.get('retry-after')),
      };
    }
    try {
      return {
        kind: 'ok',
        status,
        value: {
          data: decode(payload),
          replayed: headers.get('idempotency-replayed') === 'true',
          etag: headers.get('etag') ?? undefined,
          traceId,
        },
      };
    } catch (error) {
      return {
        kind: 'error',
        error: new ApiError({
          kind: 'protocol',
          message: `Phản hồi không khớp hợp đồng: ${error instanceof Error ? error.message : 'không rõ'}`,
          status,
          correlationId,
          traceId,
        }),
      };
    }
  }

  private mapError(
    status: number,
    payload: unknown,
    correlationId: string,
    traceId: string | undefined,
  ): ApiError {
    const parsed = errorBodySchema.safeParse(payload);
    const code = parsed.success ? parsed.data.code : undefined;
    const retryable = isRetryableStatus(status, code);
    if (!parsed.success) {
      return new ApiError({
        kind: 'protocol',
        message: `Máy chủ trả ${status} không theo bao lỗi §4.1.`,
        status,
        correlationId,
        traceId,
        retryable,
      });
    }
    return new ApiError({
      kind: 'http',
      message: parsed.data.message,
      status,
      code: parsed.data.code,
      traceId: parsed.data.traceId,
      details: parsed.data.details,
      correlationId,
      retryable,
    });
  }

  private buildUrl(spec: RequestBase): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) query.append(key, String(value));
    }
    const search = query.toString();
    return `${this.baseUrl}${spec.path}${search === '' ? '' : `?${search}`}`;
  }
}

/** Tham chiếu tác vụ bất đồng bộ cho các lệnh trả 202. */
export const operationRefDecoder: Decoder<{
  operationId: string;
  status: string;
  statusUrl: string;
}> = {
  parse: (input) => operationRefSchema.parse(input),
};

interface FetchedResponse {
  kind: 'ok';
  status: number;
  headers: Headers;
  payload: unknown;
}

type AttemptOutcome<T> =
  | { kind: 'ok'; status: number; value: Omit<ApiResponse<T>, 'status'> }
  | { kind: 'error'; error: ApiError; retryAfterMs?: number | undefined };
