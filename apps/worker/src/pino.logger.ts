import pino from 'pino';
import type { WorkerLogger } from './logger.js';

/** pino JSON ra stdout: có `level`, `time`, `pid`, `hostname`, `msg` như log của API. */
export function createLogger(level: string): WorkerLogger {
  return pino({ level, base: { service: 'worker' } });
}
