/** Cổng log của worker — cùng định dạng JSON một dòng như API (HB-004). */
export interface WorkerLogger {
  info(context: { queue: string }, msg: string): void;
  error(error: unknown, msg: string): void;
}
