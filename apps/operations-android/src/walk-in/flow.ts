/**
 * SCR-65 — máy trạng thái walk-in ≤ 5 bước: kỳ lưu trú → khách → xác nhận/tạo (`POST /walk-in`) → thu cọc
 * (PIN + `POST /payments`) → hoàn tất. Lớp thuần nhận `WalkInPorts` để test không cần mạng/đồng hồ thật.
 *
 * Chỉ chạy **khi có mạng**: mất mạng thì không gửi, không xếp hàng (QĐ-03 quyết định 6). Mỗi lệnh ghi giữ một
 * `Idempotency-Key` cho tới khi có kết quả chắc chắn; kết quả chưa xác định thử lại cùng khoá và cùng nội dung.
 * `pinToken` chỉ nằm trong bộ nhớ của luồng, dùng một lần cho đúng một lệnh thu và bị bỏ sau kết quả chắc chắn.
 */
import type {
  Payment,
  PaymentCreateRequest,
  PinToken,
  RoomTypeSummary,
  WalkInRequest,
  WalkInResult,
} from '@pinehill/contracts';
import { isApiError } from '@pinehill/api-client';
import {
  actionFailure,
  depositBody,
  guestIssue,
  nextStep,
  pinFailure,
  previousStep,
  stayIssue,
  toWalkInRequest,
  walkInDefaults,
  type ActionFailure,
  type DepositMethod,
  type GuestIssue,
  type StayIssue,
  type WalkInGuest,
  type WalkInStay,
  type WalkInStep,
} from './model';

export interface WalkInPorts {
  online(): Promise<boolean>;
  now(): number;
  createId(): string;
  roomTypes(propertyId: string): Promise<readonly RoomTypeSummary[]>;
  createBooking(request: WalkInRequest, idempotencyKey: string): Promise<WalkInResult>;
  verifyPin(pin: string, bookingId: string): Promise<PinToken>;
  pay(body: PaymentCreateRequest, idempotencyKey: string): Promise<Payment>;
}

export type FlowFailure = ActionFailure | { readonly kind: 'offline' };
export type TypesPhase = 'loading' | 'ready' | 'offline' | 'error';
export type PinPhase = 'idle' | 'verified' | 'wrong' | 'locked' | 'unavailable';

export interface WalkInState {
  readonly step: WalkInStep;
  readonly stay: WalkInStay;
  readonly guest: WalkInGuest;
  readonly note: string;
  readonly stayProblem: StayIssue | null;
  readonly guestProblem: GuestIssue | null;
  readonly roomTypes: readonly RoomTypeSummary[];
  readonly types: TypesPhase;
  readonly busy: 'creating' | 'verifying' | 'paying' | null;
  readonly result: WalkInResult | null;
  readonly failure: FlowFailure | null;
  readonly pin: PinPhase;
  readonly lockedMinutes: number | null;
  readonly payment: Payment | null;
}

interface PendingKey {
  readonly fingerprint: string;
  readonly key: string;
}

const EPOCH = '2000-01-01';

function initial(): WalkInState {
  return {
    step: 'stay',
    stay: { ...walkInDefaults('', EPOCH), checkIn: '', checkOut: '' },
    guest: { fullName: '', phone: '' },
    note: '',
    stayProblem: null,
    guestProblem: null,
    roomTypes: [],
    types: 'loading',
    busy: null,
    result: null,
    failure: null,
    pin: 'idle',
    lockedMinutes: null,
    payment: null,
  };
}

function typesFailure(error: unknown): TypesPhase {
  if (!isApiError(error)) return 'error';
  return error.kind === 'network' || error.kind === 'aborted' ? 'offline' : 'error';
}

export class WalkInFlow {
  state: WalkInState = initial();
  private listeners = new Set<() => void>();
  private alive = true;
  private createKey: PendingKey | null = null;
  private payKey: PendingKey | null = null;
  private pinToken: string | null = null;
  private inFlight: Promise<void> | null = null;
  constructor(private readonly ports: WalkInPorts) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private set(patch: Partial<WalkInState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  dispose(): void {
    this.alive = false;
    this.pinToken = null;
    this.createKey = null;
    this.payKey = null;
    this.listeners.clear();
  }

  async init(propertyId: string, date: string): Promise<void> {
    this.pinToken = null;
    this.createKey = null;
    this.payKey = null;
    this.set({ ...initial(), stay: walkInDefaults(propertyId, date) });
    try {
      const roomTypes = await this.ports.roomTypes(propertyId);
      this.set({ roomTypes, types: 'ready' });
    } catch (error) {
      this.set({ types: typesFailure(error) });
    }
  }

  setStay(patch: Partial<WalkInStay>): void {
    this.set({ stay: { ...this.state.stay, ...patch }, stayProblem: null });
  }
  setGuest(patch: Partial<WalkInGuest>): void {
    this.set({ guest: { ...this.state.guest, ...patch }, guestProblem: null });
  }
  setNote(note: string): void {
    this.set({ note });
  }

  next(): void {
    const { step, stay, guest } = this.state;
    if (this.state.busy !== null) return;
    const problems = {
      stayProblem: step === 'stay' ? stayIssue(stay) : null,
      guestProblem: step === 'guest' ? guestIssue(guest) : null,
    };
    const blocked = problems.stayProblem !== null || problems.guestProblem !== null;
    this.set({ ...problems, ...(blocked || step === 'review' ? {} : { step: nextStep(step) }) });
  }

  back(): void {
    const { step, busy } = this.state;
    if (busy !== null || (step !== 'guest' && step !== 'review')) return;
    this.set({ step: previousStep(step), failure: null });
  }

  /** Dùng chung cho mọi lệnh gửi: một lệnh một lúc, chỉ khi có mạng. */
  private exclusive(run: () => Promise<void>): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    const running = (async () => {
      this.set({ failure: null });
      if (!(await this.online())) {
        this.set({ failure: { kind: 'offline' } });
        return;
      }
      await run();
    })().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }
  private async online(): Promise<boolean> {
    try {
      return await this.ports.online();
    } catch {
      return false;
    }
  }
  private keyFor(slot: 'createKey' | 'payKey', fingerprint: string): string {
    const current = this[slot];
    const key = current?.fingerprint === fingerprint ? current.key : this.ports.createId();
    this[slot] = { fingerprint, key };
    return key;
  }

  create(): Promise<void> {
    const { step, result, stay, guest, note } = this.state;
    if (step !== 'review' || result !== null) return this.inFlight ?? Promise.resolve();
    if (stayIssue(stay) !== null || guestIssue(guest) !== null) return Promise.resolve();
    return this.exclusive(async () => {
      const request = toWalkInRequest(stay, guest, note);
      const key = this.keyFor('createKey', JSON.stringify(request));
      this.set({ busy: 'creating' });
      try {
        const created = await this.ports.createBooking(request, key);
        this.createKey = null;
        this.set({ busy: null, result: created, step: 'deposit' });
      } catch (error) {
        const failure = actionFailure(error);
        if (failure.kind !== 'unknownOutcome') this.createKey = null;
        this.set({ busy: null, failure });
      }
    });
  }

  verifyPin(pin: string): Promise<void> {
    const { result, step } = this.state;
    if (step !== 'deposit' || result === null || !/^\d{6}$/.test(pin)) return Promise.resolve();
    return this.exclusive(async () => {
      this.set({ busy: 'verifying', pin: 'idle' });
      try {
        const grant = await this.ports.verifyPin(pin, result.booking.id);
        const valid = grant.pinToken.length >= 16 && Date.parse(grant.expiresAt) > this.ports.now();
        this.pinToken = valid ? grant.pinToken : null;
        this.set({ busy: null, pin: valid ? 'verified' : 'idle' });
      } catch (error) {
        const failure = pinFailure(error);
        this.set({
          busy: null,
          pin: failure.kind,
          lockedMinutes: failure.kind === 'locked' ? failure.minutes : null,
        });
      }
    });
  }

  pay(method: DepositMethod): Promise<void> {
    const { result, step, pin } = this.state;
    const token = this.pinToken;
    if (step !== 'deposit' || result === null || pin !== 'verified' || token === null)
      return Promise.resolve();
    if (result.booking.depositAmount <= 0) return Promise.resolve();
    return this.exclusive(async () => {
      const body = depositBody(result.booking.id, method, result.booking.depositAmount, token);
      const key = this.keyFor('payKey', JSON.stringify(body));
      this.set({ busy: 'paying' });
      try {
        const payment = await this.ports.pay(body, key);
        this.settlePin();
        this.set({ busy: null, payment, step: 'done', pin: 'idle' });
      } catch (error) {
        this.payFailed(actionFailure(error));
      }
    });
  }

  private settlePin(): void {
    this.pinToken = null;
    this.payKey = null;
  }
  private payFailed(failure: ActionFailure): void {
    if (failure.kind === 'unknownOutcome') {
      this.set({ busy: null, failure });
      return;
    }
    this.settlePin();
    this.set({ busy: null, failure, pin: 'idle' });
  }

  /** Bỏ qua thu cọc (booking đã tạo, thu sau ở SCR-37/quầy): kết thúc luồng, bỏ `pinToken`. */
  skipDeposit(): void {
    if (this.state.step !== 'deposit' || this.state.busy !== null) return;
    this.settlePin();
    this.set({ step: 'done', pin: 'idle' });
  }
}
