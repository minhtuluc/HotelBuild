import type { AppError } from '../app-error.js';
/** Trusted workflow signal: discard the entire business transaction before trying again. */
export class RetryTransaction extends Error {
  constructor(readonly exhausted: AppError) {
    super('Retry complete business transaction');
  }
}
