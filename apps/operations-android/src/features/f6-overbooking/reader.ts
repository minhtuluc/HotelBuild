/**
 * SCR-67 (cảnh báo quá tải) và SCR-63 (đổi phòng) — đọc từ tuyến HB-120, lớp thuần nhận `F6Ports` để test
 * không cần mạng. Chống ghi đè bởi phản hồi cũ (§8.1); bộ nhớ đệm **chỉ trong RAM**, gắn nhãn thời điểm,
 * xoá khi đăng xuất/401/403 và không bao giờ dùng cho cơ sở hoặc vai khác. Lễ tân **không** bao giờ tải hay
 * giữ bảng xếp hạng đầy đủ: chỉ cảnh báo tối thiểu và phương án của chính booking đang xử lý (AC2, AC3).
 */
import type {
  BookingRelocationOptions,
  OverbookingCaseDetail,
  OverbookingScanMetadata,
  RoomMoveView,
  UserMe,
} from '@pinehill/contracts';
import { OfflineError } from '../../netinfo';
import { readFailure, type ReadFailure } from '../../stay/model';
import { canReadCases, rowOfCase, rowsOfAlerts, tagOf, type AlertRow } from './model';
import type { F6Ports } from './ports';

export type Phase = 'idle' | 'loading' | 'ready' | 'empty' | ReadFailure;

function failureOf(error: unknown): ReadFailure {
  return error instanceof OfflineError ? 'offline' : readFailure(error);
}

export interface AlertsState {
  readonly phase: Phase;
  readonly rows: readonly AlertRow[];
  readonly scan: OverbookingScanMetadata | null;
  /** Số ca quá hạn do máy chủ đếm (chỉ có ở danh sách quản lý). */
  readonly overdueCount: number | null;
  readonly syncedAt: string | null;
  readonly stale: boolean;
  readonly notice: 'offline' | 'error' | null;
}

export const IDLE_ALERTS: AlertsState = {
  phase: 'idle',
  rows: [],
  scan: null,
  overdueCount: null,
  syncedAt: null,
  stale: false,
  notice: null,
};

interface AlertsEntry {
  readonly key: string;
  readonly rows: readonly AlertRow[];
  readonly scan: OverbookingScanMetadata;
  readonly overdueCount: number | null;
  readonly syncedAt: string;
}

/** Cache chỉ-RAM của SCR-67; chủ phiên gọi `clear()` khi đăng xuất. */
export class AlertsCache {
  private entry: AlertsEntry | null = null;
  get(key: string): AlertsEntry | null {
    return this.entry?.key === key ? this.entry : null;
  }
  put(entry: AlertsEntry): void {
    this.entry = entry;
  }
  clear(): void {
    this.entry = null;
  }
}

abstract class Observable<S> {
  protected abstract state: S;
  protected epoch = 0;
  protected alive = true;
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  protected publish(next: S): void {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.listeners.clear();
  }
}

export class AlertsReader extends Observable<AlertsState> {
  state: AlertsState = IDLE_ALERTS;
  constructor(
    private readonly ports: F6Ports,
    private readonly cache: AlertsCache,
  ) {
    super();
  }

  invalidate(): void {
    this.epoch++;
    this.publish(IDLE_ALERTS);
  }

  /** Quản lý/chủ chuỗi đọc ca; lễ tân chỉ đọc cảnh báo tối thiểu theo booking được cấp. */
  async load(role: UserMe['role'], propertyId?: string): Promise<void> {
    const stamp = ++this.epoch;
    const key = `${canReadCases(role) ? 'cases' : 'alerts'}:${propertyId ?? ''}`;
    this.publish({ ...this.state, phase: 'loading' });
    try {
      const entry = await this.fetch(canReadCases(role), propertyId, key);
      if (stamp !== this.epoch) return;
      this.cache.put(entry);
      this.publish(this.fromEntry(entry, false, null));
    } catch (error) {
      if (stamp !== this.epoch) return;
      this.fail(failureOf(error), key);
    }
  }

  private async fetch(
    manager: boolean,
    propertyId: string | undefined,
    key: string,
  ): Promise<AlertsEntry> {
    const syncedAt = this.ports.now().toISOString();
    if (manager) {
      const list = await this.ports.cases(propertyId);
      return {
        key,
        rows: list.data.map(rowOfCase),
        scan: list.meta.scan,
        overdueCount: list.meta.overdueCount,
        syncedAt,
      };
    }
    const list = await this.ports.alerts(propertyId);
    return {
      key,
      rows: rowsOfAlerts(list.data),
      scan: list.meta.scan,
      overdueCount: null,
      syncedAt,
    };
  }

  private fromEntry(
    entry: AlertsEntry,
    stale: boolean,
    notice: AlertsState['notice'],
  ): AlertsState {
    return {
      phase: entry.rows.length === 0 ? 'empty' : 'ready',
      rows: entry.rows,
      scan: entry.scan,
      overdueCount: entry.overdueCount,
      syncedAt: entry.syncedAt,
      stale,
      notice,
    };
  }

  private fail(phase: ReadFailure, key: string): void {
    if (phase === 'expired' || phase === 'forbidden') {
      this.cache.clear();
      this.publish({ ...IDLE_ALERTS, phase });
      return;
    }
    const cached = this.cache.get(key);
    if (cached === null) this.publish({ ...IDLE_ALERTS, phase });
    else this.publish(this.fromEntry(cached, true, phase === 'offline' ? 'offline' : 'error'));
  }
}

export interface MoveState {
  readonly view: RoomMoveView;
  readonly tag: string;
}

export interface RelocationState {
  readonly phase: Phase;
  /** Chỉ quản lý/chủ chuỗi: ca đầy đủ + ứng viên theo thứ tự máy chủ. */
  readonly detail: OverbookingCaseDetail | null;
  /** Lễ tân: phương án của chính booking đang xử lý. */
  readonly options: BookingRelocationOptions | null;
  readonly move: MoveState | null;
  readonly syncedAt: string | null;
  readonly stale: boolean;
}

export const IDLE_RELOCATION: RelocationState = {
  phase: 'idle',
  detail: null,
  options: null,
  move: null,
  syncedAt: null,
  stale: false,
};

export interface RelocationTarget {
  readonly caseId: string;
  readonly bookingId: string;
  readonly moveId: string;
}

export class RelocationReader extends Observable<RelocationState> {
  state: RelocationState = IDLE_RELOCATION;
  private moveId = '';
  constructor(private readonly ports: F6Ports) {
    super();
  }

  /** Đổi phiên/cơ sở: bỏ dữ liệu cũ (PII chỉ ở RAM). */
  invalidate(): void {
    this.epoch++;
    this.moveId = '';
    this.publish(IDLE_RELOCATION);
  }

  follow(moveId: string): void {
    this.moveId = moveId;
  }

  async load(role: UserMe['role'], target: RelocationTarget): Promise<void> {
    const stamp = ++this.epoch;
    if (this.moveId === '') this.moveId = target.moveId;
    this.publish({ ...this.state, phase: 'loading' });
    try {
      const data = await this.read(role, target);
      if (stamp !== this.epoch) return;
      this.publish({
        ...data,
        phase: 'ready',
        syncedAt: this.ports.now().toISOString(),
        stale: false,
      });
    } catch (error) {
      if (stamp !== this.epoch) return;
      this.fail(failureOf(error));
    }
  }

  private async read(
    role: UserMe['role'],
    target: RelocationTarget,
  ): Promise<Pick<RelocationState, 'detail' | 'options' | 'move'>> {
    const manager = canReadCases(role);
    const detail = manager ? (await this.ports.caseDetail(target.caseId)).view : null;
    const options =
      !manager && target.bookingId !== ''
        ? await this.ports.options(target.bookingId, target.caseId)
        : null;
    const loaded = this.moveId === '' ? null : await this.ports.move(this.moveId);
    return {
      detail,
      options,
      move:
        loaded === null
          ? null
          : { view: loaded.view, tag: loaded.etag ?? tagOf(loaded.view.version) },
    };
  }

  /** Lỗi đọc giữ dữ liệu cũ có nhãn; mất quyền/phiên thì xoá sạch (không còn đọc được). */
  private fail(phase: ReadFailure): void {
    if (phase === 'expired' || phase === 'forbidden') {
      this.moveId = '';
      this.publish({ ...IDLE_RELOCATION, phase });
      return;
    }
    this.publish({
      ...this.state,
      phase: this.state.syncedAt === null ? phase : 'ready',
      stale: this.state.syncedAt !== null,
    });
  }
}
