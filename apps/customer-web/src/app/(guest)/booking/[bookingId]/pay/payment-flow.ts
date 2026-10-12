import { isApiError } from '@pinehill/api-client';
import {
  onlinePaymentCreateRequestSchema,
  type OnlinePaymentCreateRequest,
  type Payment,
  type PaymentStatusView,
} from '@pinehill/contracts';
import {
  approvedAmount,
  paymentMessage,
  sameOffer,
  safePaymentUrl,
  type Offer,
} from './payment-model';
export interface PaymentPorts {
  read(signal: AbortSignal): Promise<Offer>;
  create(body: OnlinePaymentCreateRequest, key: string, signal: AbortSignal): Promise<Payment>;
  status(id: string, signal: AbortSignal): Promise<PaymentStatusView>;
}
export type ObservedPayment = PaymentStatusView & { expiresAt: string | null };
export type Phase =
  | 'loading'
  | 'ready'
  | 'confirm'
  | 'pending'
  | 'unknown'
  | 'received'
  | 'confirmed'
  | 'failed'
  | 'blocked'
  | 'forbidden'
  | 'error';
export interface PaymentView {
  phase: Phase;
  busy: boolean;
  offer?: Offer;
  payment?: ObservedPayment;
  fullPayment?: Payment;
  changed?: boolean;
  checkedAt?: string;
}
interface Intent {
  key: string;
  body: OnlinePaymentCreateRequest;
  paymentId?: string;
}
interface Options {
  ports: PaymentPorts;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  bookingId: string;
  origin: string;
  fixtureOrigin?: string;
  key?: () => string;
  changed?: (view: PaymentView) => void;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function bodyForIntent(
  value: unknown,
  bookingId: string,
  returnUrl: string,
): OnlinePaymentCreateRequest {
  const body = onlinePaymentCreateRequestSchema.parse(value);
  if (
    body.bookingId !== bookingId ||
    body.returnUrl !== returnUrl ||
    body.type !== 'DEPOSIT' ||
    !['VNPAY', 'MOMO'].includes(body.method) ||
    !Number.isSafeInteger(body.amount)
  )
    throw Error('Invalid intent');
  return body;
}
function decodeIntent(raw: string, bookingId: string, returnUrl: string): Intent {
  const value: unknown = JSON.parse(raw);
  if (!record(value)) throw Error('Invalid intent');
  const key = value.key;
  if (
    typeof key !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)
  )
    throw Error('Invalid key');
  const body = bodyForIntent(value.body, bookingId, returnUrl);
  const paymentId = value.paymentId;
  if (paymentId !== undefined && (typeof paymentId !== 'string' || !paymentId))
    throw Error('Invalid intent');
  return { key, body, ...(paymentId === undefined ? {} : { paymentId }) };
}
function isOnlineDeposit(p: Payment) {
  return p.type === 'DEPOSIT' && ['VNPAY', 'MOMO'].includes(p.method);
}
function choosePaymentId(id: string | undefined, intent: Intent | undefined, payments: Payment[]) {
  return id ?? intent?.paymentId ?? (payments.length === 1 ? payments[0]?.paymentId : undefined);
}
function makeIntent(
  options: Options,
  offer: Offer,
  amount: number,
  method: 'MOMO' | 'VNPAY',
  returnUrl: string,
): Intent {
  return {
    key: (options.key ?? (() => crypto.randomUUID()))(),
    body: { bookingId: offer.booking.id, type: 'DEPOSIT', method, amount, returnUrl },
  };
}
function assertCreatedPayment(payment: Payment, body: OnlinePaymentCreateRequest) {
  if (
    payment.bookingId !== body.bookingId ||
    payment.type !== body.type ||
    payment.method !== body.method ||
    payment.amount !== body.amount
  )
    throw Error('Identity mismatch');
}
/** Presentation workflow only: never updates a booking/payment business status. Unknown writes stay fenced. */
export class PaymentFlow {
  state: PaymentView = { phase: 'loading', busy: false };
  private controller = new AbortController();
  private alive = true;
  private intent: Intent | undefined;
  private storageKey = '';
  private method: 'MOMO' | 'VNPAY' = 'VNPAY';
  constructor(private readonly options: Options) {}
  get referenceId() {
    return this.intent?.paymentId ?? this.intent?.key;
  }
  private show(view: PaymentView) {
    if (!this.alive) return;
    this.state = view.offer
      ? {
          ...view,
          checkedAt: view.busy
            ? (this.state.checkedAt ?? new Date().toISOString())
            : new Date().toISOString(),
        }
      : view;
    this.options.changed?.(this.state);
  }
  private async read(): Promise<Offer> {
    const offer = await this.options.ports.read(this.controller.signal);
    if (
      offer.booking.id !== this.options.bookingId ||
      offer.balance.bookingId !== this.options.bookingId ||
      offer.booking.payments?.some((p) => p.bookingId !== this.options.bookingId)
    )
      throw Error('Identity mismatch');
    return offer;
  }
  private restore(offer: Offer) {
    this.storageKey = `pinehill-payment:${encodeURIComponent(offer.booking.guestId)}:${encodeURIComponent(offer.booking.id)}`;
    const raw = this.options.storage.getItem(this.storageKey);
    this.intent =
      raw === null ? undefined : decodeIntent(raw, this.options.bookingId, this.returnUrl());
  }
  private returnUrl() {
    return `${this.options.origin}/booking/${encodeURIComponent(this.options.bookingId)}/pay`;
  }
  private persist(intent: Intent) {
    this.options.storage.setItem(this.storageKey, JSON.stringify(intent));
    this.intent = intent;
  }
  private failure(error: unknown, write = false) {
    const forbidden =
      isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404);
    this.show({ phase: forbidden ? 'forbidden' : write ? 'unknown' : 'error', busy: false });
  }
  private async observe(offer: Offer, id: string) {
    const status = await this.options.ports.status(id, this.controller.signal);
    if (
      status.bookingId !== offer.booking.id ||
      status.paymentId !== id ||
      !Number.isSafeInteger(status.amount)
    )
      throw Error('Identity mismatch');
    // Read booking AFTER status; redirect query never proves settlement or confirmation.
    const fresh = await this.read();
    const full = fresh.booking.payments?.find((p) => p.paymentId === id);
    const payment = { ...status, expiresAt: full?.expiresAt ?? null };
    this.show({
      phase: paymentMessage(payment, fresh.booking),
      busy: false,
      offer: fresh,
      payment,
      ...(full === undefined ? {} : { fullPayment: { ...full, ...status } }),
    });
  }
  private initialView(offer: Offer, online: Payment[]): PaymentView {
    if (this.intent || online.length > 1) return { phase: 'unknown', busy: false, offer };
    const unavailable =
      approvedAmount(offer.booking, offer.balance) === null || offer.booking.payments === undefined;
    return { phase: unavailable ? 'blocked' : 'ready', busy: false, offer };
  }
  async load(requestedId?: string): Promise<void> {
    if (!this.alive || this.state.busy) return;
    this.show(this.state.offer ? { ...this.state, busy: true } : { phase: 'loading', busy: true });
    try {
      const offer = await this.read();
      if (!this.alive) return;
      this.restore(offer);
      const online = (offer.booking.payments ?? []).filter(isOnlineDeposit);
      const id = choosePaymentId(requestedId, this.intent, online);
      if (id) {
        await this.observe(offer, id);
        return;
      }
      this.show(this.initialView(offer, online));
    } catch (error) {
      this.failure(error);
    }
  }
  async prepare(method: 'MOMO' | 'VNPAY'): Promise<void> {
    if (!this.alive || this.state.busy || this.state.phase !== 'ready') return;
    this.show({ ...this.state, busy: true });
    try {
      const offer = await this.read();
      this.restore(offer);
      if (
        this.intent ||
        offer.booking.payments?.some(
          (p) => p.type === 'DEPOSIT' && ['VNPAY', 'MOMO'].includes(p.method),
        )
      ) {
        this.show({ phase: 'unknown', busy: false, offer });
        return;
      }
      this.method = method;
      this.show({
        phase: approvedAmount(offer.booking, offer.balance) === null ? 'blocked' : 'confirm',
        busy: false,
        offer,
      });
    } catch (error) {
      this.failure(error);
    }
  }
  private async reconfirm(previous: Offer): Promise<{ offer: Offer; amount: number } | null> {
    const offer = await this.read();
    const amount = approvedAmount(offer.booking, offer.balance);
    if (amount === null) {
      this.show({ phase: 'blocked', busy: false, offer });
      return null;
    }
    if (!sameOffer(previous, offer)) {
      this.show({ phase: 'confirm', busy: false, offer, changed: true });
      return null;
    }
    this.restore(offer);
    if (this.intent) {
      this.show({ phase: 'unknown', busy: false, offer });
      return null;
    }
    return { offer, amount };
  }
  async confirm(): Promise<string | null> {
    if (!this.alive || this.state.busy || this.state.phase !== 'confirm' || !this.state.offer)
      return null;
    const previous = this.state.offer;
    this.show({ ...this.state, busy: true });
    let sent = false;
    try {
      const current = await this.reconfirm(previous);
      if (!current) return null;
      const intent = makeIntent(
        this.options,
        current.offer,
        current.amount,
        this.method,
        this.returnUrl(),
      );
      this.persist(intent); // Persist before POST; unavailable storage prevents the write.
      sent = true;
      const payment = await this.options.ports.create(
        intent.body,
        intent.key,
        this.controller.signal,
      );
      if (!this.alive) return null;
      assertCreatedPayment(payment, intent.body);
      this.persist({ ...intent, paymentId: payment.paymentId });
      this.show({
        phase: 'pending',
        busy: false,
        offer: current.offer,
        payment,
        fullPayment: payment,
      });
      if (payment.status !== 'PENDING') {
        await this.load(payment.paymentId);
        return null;
      }
      return safePaymentUrl(payment, this.options.fixtureOrigin);
    } catch (error) {
      this.failure(error, sent);
      return null;
    }
  }
  expireSession() {
    this.controller.abort();
    this.show({ phase: 'forbidden', busy: false });
    this.alive = false;
  }
  dispose() {
    this.alive = false;
    this.controller.abort();
  }
}
