/**
 * SCR-15 — bộ điều khiển trạng thái màn quản lý người dùng. Lớp thuần: nhận `UsersPorts` để test không
 * cần mạng/React. Luật gán vai trò, OWNER cuối, thu hồi phiên… nằm ở máy chủ (HB-016); ở đây chỉ chống
 * phản hồi cũ (§8.1), giữ khoá idempotency khi kết quả chưa xác định và giữ mật khẩu tạm **một lần**.
 */
import { isApiError } from '@pinehill/api-client';
import type { ListPage, UserMe, UserSummary, UsersQuery } from '@pinehill/contracts';
import {
  accessChanged,
  createIssues,
  generateTemporaryPassword,
  ifMatchOf,
  toAccessRequest,
  toCreateRequest,
  usersQuery,
  writeFailure,
  type AccessDraft,
  type CreateDraft,
  type FieldIssue,
  type RandomBytes,
  type UserFilters,
  type WriteFailure,
} from './users-model';

export interface PropertyOption {
  readonly id: string;
  readonly name: string;
}

export interface UsersPorts {
  actor(): Promise<UserMe>;
  /** Có thể từ chối (vai trò không đọc được cơ sở): màn chuyển sang nhập mã cơ sở. */
  properties(): Promise<readonly PropertyOption[]>;
  list(query: UsersQuery): Promise<ListPage<UserSummary>>;
  create(body: ReturnType<typeof toCreateRequest>, key: string): Promise<UserSummary>;
  updateAccess(
    userId: string,
    body: ReturnType<typeof toAccessRequest>,
    ifMatch: string,
    key: string,
  ): Promise<UserSummary>;
  deletePin(userId: string): Promise<void>;
  random: RandomBytes;
  createId(): string;
  now(): number;
}

export type ReadPhase = 'loading' | 'ready' | 'forbidden' | 'expired' | 'error';

export type Panel =
  | { readonly kind: 'create' }
  | { readonly kind: 'access'; readonly userId: string }
  | { readonly kind: 'pin'; readonly userId: string };

export interface Handover {
  readonly username: string;
  readonly fullName: string;
  /** Hiện đúng một lần; `dismissHandover` xoá khỏi bộ nhớ. */
  readonly password: string;
}

export interface UsersState {
  readonly phase: ReadPhase;
  readonly error: unknown;
  readonly actor: UserMe | null;
  readonly properties: readonly PropertyOption[] | null;
  readonly filters: UserFilters;
  readonly rows: readonly UserSummary[];
  readonly nextCursor: string | null;
  readonly refreshing: boolean;
  readonly syncedAt: number | null;
  readonly panel: Panel | null;
  readonly busy: boolean;
  readonly failure: WriteFailure | null;
  readonly issues: readonly FieldIssue[];
  readonly notice: 'created' | 'saved' | 'pinCleared' | null;
  readonly handover: Handover | null;
}

const NO_FILTERS: UserFilters = { role: '', propertyId: '', q: '' };

const INITIAL: UsersState = {
  phase: 'loading',
  error: null,
  actor: null,
  properties: null,
  filters: NO_FILTERS,
  rows: [],
  nextCursor: null,
  refreshing: false,
  syncedAt: null,
  panel: null,
  busy: false,
  failure: null,
  issues: [],
  notice: null,
  handover: null,
};

interface Pending {
  readonly fingerprint: string;
  readonly key: string;
  readonly password: string;
}

function readPhase(error: unknown): ReadPhase {
  if (isApiError(error) && error.status === 403) return 'forbidden';
  if (isApiError(error) && error.status === 401) return 'expired';
  return 'error';
}

export class UsersController {
  state: UsersState = INITIAL;
  private epoch = 0;
  private alive = true;
  private pending: Pending | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly ports: UsersPorts) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.pending = null;
    this.listeners.clear();
  }
  private set(patch: Partial<UsersState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Tải lần đầu: hồ sơ phiên + cơ sở + trang đầu. */
  async load(): Promise<void> {
    const stamp = ++this.epoch;
    this.set({ phase: 'loading', error: null });
    try {
      const actor = await this.ports.actor();
      const [properties, page] = await Promise.all([
        this.ports.properties().catch((error: unknown) => {
          if (isApiError(error) && error.status === 401) throw error;
          return null;
        }),
        this.ports.list(usersQuery(this.state.filters, undefined)),
      ]);
      if (stamp !== this.epoch) return;
      this.set({ phase: 'ready', actor, properties, ...this.page(page, false) });
    } catch (error) {
      if (stamp === this.epoch) this.set({ phase: readPhase(error), error });
    }
  }

  private page(page: ListPage<UserSummary>, append: boolean): Partial<UsersState> {
    return {
      rows: append ? [...this.state.rows, ...page.data] : page.data,
      nextCursor: page.meta.hasMore ? page.meta.nextCursor : null,
      syncedAt: this.ports.now(),
      refreshing: false,
    };
  }

  /** Làm mới theo bộ lọc hiện tại; giữ dữ liệu cũ nếu lỗi (không xoá thành "rỗng"). */
  async reload(filters: UserFilters = this.state.filters): Promise<void> {
    const stamp = ++this.epoch;
    this.set({ filters, refreshing: true, error: null });
    try {
      const page = await this.ports.list(usersQuery(filters, undefined));
      if (stamp === this.epoch) this.set({ phase: 'ready', ...this.page(page, false) });
    } catch (error) {
      if (stamp !== this.epoch) return;
      const phase = readPhase(error);
      this.set(
        phase === 'error'
          ? { refreshing: false, error }
          : { phase, error, refreshing: false, rows: [], nextCursor: null },
      );
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.state.nextCursor;
    if (cursor === null || this.state.refreshing) return;
    const stamp = ++this.epoch;
    this.set({ refreshing: true });
    try {
      const page = await this.ports.list(usersQuery(this.state.filters, cursor));
      if (stamp === this.epoch) this.set(this.page(page, true));
    } catch (error) {
      if (stamp === this.epoch) this.set({ refreshing: false, error });
    }
  }

  /** Phiên hết hiệu lực (client phiên báo `onExpired`): bỏ dữ liệu cá nhân khỏi màn hình. */
  expire(): void {
    this.epoch++;
    this.pending = null;
    this.set({ ...INITIAL, phase: 'expired', filters: this.state.filters });
  }

  openPanel(panel: Panel | null): void {
    this.set({ panel, failure: null, issues: [], notice: null });
  }

  dismissHandover(): void {
    this.set({ handover: null });
  }

  private async write<T>(action: () => Promise<T>, onOk: (value: T) => void): Promise<void> {
    if (this.state.busy) return;
    this.set({ busy: true, failure: null, notice: null });
    try {
      const value = await action();
      if (!this.alive) return;
      onOk(value);
    } catch (error) {
      const failure = writeFailure(error);
      this.set({
        busy: false,
        failure,
        ...(failure.kind === 'expired' ? { phase: 'expired' } : {}),
      });
      if (failure.kind === 'conflict') await this.reload();
    }
  }

  /**
   * Tạo người dùng. Mật khẩu tạm sinh một lần và giữ cùng khoá khi thử lại **cùng bản nháp** sau kết quả
   * chưa xác định; máy chủ chưa có middleware idempotency (QĐ-03 T9) nên không tự gửi lại.
   */
  async create(draft: CreateDraft): Promise<void> {
    const issues = createIssues(draft);
    this.set({ issues });
    if (issues.length > 0) return;
    const fingerprint = JSON.stringify(draft);
    const pending =
      this.pending?.fingerprint === fingerprint
        ? this.pending
        : {
            fingerprint,
            key: this.ports.createId(),
            password: generateTemporaryPassword(this.ports.random),
          };
    this.pending = pending;
    await this.write(
      () => this.ports.create(toCreateRequest(draft, pending.password), pending.key),
      (created) => {
        this.pending = null;
        this.set({
          busy: false,
          panel: null,
          notice: 'created',
          handover: {
            username: created.username,
            fullName: created.fullName,
            password: pending.password,
          },
          rows: [created, ...this.state.rows.filter((row) => row.id !== created.id)],
        });
      },
    );
    if (this.pending !== null && this.state.failure?.kind !== 'unknownOutcome') this.pending = null;
  }

  /** Sửa quyền với `If-Match` = phiên bản đang xem; 412 → tải lại bản mới, không ghi đè. */
  async saveAccess(user: UserSummary, draft: AccessDraft): Promise<void> {
    if (!accessChanged(user, draft)) return;
    await this.write(
      () =>
        this.ports.updateAccess(
          user.id,
          toAccessRequest(draft),
          ifMatchOf(user.version),
          this.ports.createId(),
        ),
      (saved) => {
        this.set({
          busy: false,
          panel: null,
          notice: 'saved',
          rows: this.state.rows.map((row) => (row.id === saved.id ? saved : row)),
        });
      },
    );
  }

  async clearPin(user: UserSummary): Promise<void> {
    await this.write(
      () => this.ports.deletePin(user.id),
      () => {
        this.set({
          busy: false,
          panel: null,
          notice: 'pinCleared',
          rows: this.state.rows.map((row) =>
            row.id === user.id ? { ...row, hasPin: false } : row,
          ),
        });
      },
    );
  }
}
