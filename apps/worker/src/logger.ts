/** Cổng log của worker — cùng định dạng JSON một dòng như API (HB-004). */
export interface WorkerLogger {
  info(context: { queue: string }, msg: string): void;
  error(
    context: {
      queue: string;
      /** `job` = lỗi của một lượt xử lý nghiệp vụ (HB-078), vẫn chỉ mang mã ổn định, không message thô. */
      component: 'queue' | 'worker' | 'shutdown' | 'job';
      errorCode: string;
    },
    msg: string,
  ): void;
}
