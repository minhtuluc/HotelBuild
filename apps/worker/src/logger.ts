/** Cổng log của worker — cùng định dạng JSON một dòng như API (HB-004). */
export interface WorkerLogger {
  info(context: { queue: string }, msg: string): void;
  error(
    context: { queue: string; component: 'queue' | 'worker' | 'shutdown'; errorCode: string },
    msg: string,
  ): void;
}
