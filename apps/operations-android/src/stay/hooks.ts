import { useEffect, useState } from 'react';
import type { Session } from '../session';
import { watchContext } from './context';
import { BalanceReader, type BalancePorts, type BalanceState } from './reader';

/** Writer gắn với vòng đời màn hình; đổi phiên/cơ sở thì quên PIN + khoá chờ, rời màn hình thì đóng. */
export function useStayWriter<W extends { reset(): void; dispose(): void }>(
  session: Session,
  create: () => W,
): W | null {
  const [writer, setWriter] = useState<W | null>(null);
  useEffect(() => {
    const active = create();
    setWriter(active);
    const sessionChanges = watchContext(session, () => {
      active.reset();
    });
    return () => {
      sessionChanges();
      active.dispose();
    };
  }, [session, create]);
  return writer;
}

const NO_BALANCE: BalanceState = { phase: 'idle', balance: null };

/** Số dư do máy chủ trả; không giữ bản cũ khi tải lại thất bại. */
export function useBalance(
  ports: BalancePorts,
  initialBookingId?: string,
): {
  state: BalanceState;
  load: (bookingId: string) => void;
} {
  const [reader, setReader] = useState<BalanceReader | null>(null);
  const [state, setState] = useState<BalanceState>(NO_BALANCE);
  useEffect(() => {
    const active = new BalanceReader(ports);
    setReader(active);
    const unsubscribe = active.subscribe(() => setState(active.state));
    if (initialBookingId !== undefined) void active.load(initialBookingId);
    return () => {
      unsubscribe();
      active.dispose();
    };
  }, [ports, initialBookingId]);
  return {
    state,
    load: (bookingId) => {
      void reader?.load(bookingId);
    },
  };
}
