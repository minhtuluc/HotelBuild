import { useEffect, useState } from 'react';
import type { Session } from '../session';
import { watchContext } from '../stay/context';
import { PreviewReader, type PreviewState } from './reader';

const NONE = { phase: 'idle', value: null } as const;

/**
 * Số xem trước gắn với vòng đời màn hình: tải ngay khi mở (`first`), tải lại khi người dùng đổi lựa chọn
 * (`load`), bỏ số đang có khi đổi phiên/cơ sở, đóng khi rời màn hình.
 */
export function usePreview<T extends { bookingId: string }>(
  session: Session,
  bookingId: string,
  first: () => Promise<T>,
): { state: PreviewState<T>; load: (run: () => Promise<T>) => void } {
  const [reader, setReader] = useState<PreviewReader<T> | null>(null);
  const [state, setState] = useState<PreviewState<T>>(NONE);
  useEffect(() => {
    const active = new PreviewReader<T>();
    setReader(active);
    const unsubscribe = active.subscribe(() => setState(active.state));
    const contextChanges = watchContext(session, () => {
      active.invalidate();
    });
    void active.load(bookingId, first);
    return () => {
      unsubscribe();
      contextChanges();
      active.dispose();
    };
  }, [session, bookingId]);
  return {
    state,
    load: (run) => {
      void reader?.load(bookingId, run);
    },
  };
}
