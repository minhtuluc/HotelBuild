import type { PaymentFlow } from './flow';
import { canPoll, isPaymentReturn } from './model';
interface Options {
  flow: PaymentFlow;
  bookingId: string;
  now: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (timer: unknown) => void;
}
/** Owns timers only; background/deep-link query never creates or settles payments. */
export class PaymentLifecycle {
  private timer: unknown;
  private active = true;
  private alive = true;
  private reads = 0;
  constructor(private readonly options: Options) {}
  private clear() {
    if (this.timer !== undefined) {
      this.options.cancel(this.timer);
      this.timer = undefined;
    }
  }
  sync(): void {
    this.clear();
    const state = this.options.flow.state;
    const payment = state.payment;
    if (
      !this.alive ||
      state.busy ||
      !payment ||
      !canPoll(payment, this.reads, this.options.now(), this.active)
    )
      return;
    this.timer = this.options.schedule(() => {
      this.timer = undefined;
      void this.poll();
    }, 2000);
  }
  private async poll(): Promise<void> {
    const state = this.options.flow.state;
    if (
      !this.alive ||
      state.busy ||
      !state.payment ||
      !canPoll(state.payment, this.reads, this.options.now(), this.active)
    )
      return;
    this.reads++;
    await this.check();
  }
  async check(): Promise<void> {
    if (!this.alive || !this.active) return;
    this.clear();
    await this.options.flow.load();
    this.sync();
  }
  async setActive(value: boolean): Promise<void> {
    const resumed = value && !this.active;
    this.active = value;
    this.clear();
    if (!resumed || !this.alive) return;
    // Foreground return is a reconciliation read, separate from the scheduled polling budget.
    await this.check();
  }
  async returnFrom(url: string): Promise<boolean> {
    if (!this.alive || !isPaymentReturn(url, this.options.bookingId)) return false;
    await this.check();
    return true;
  }
  dispose(): void {
    this.alive = false;
    this.clear();
    this.options.flow.dispose();
  }
}
