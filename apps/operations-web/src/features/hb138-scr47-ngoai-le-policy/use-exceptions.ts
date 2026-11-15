'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { ExceptionController, INITIAL_STATE, type ControllerState } from './controller';
import { emptyFilter } from './model';
import { createPorts, type PinBox } from './port';
import { useWorkingPropertyId } from '../../session/staff-session';

const MODULES = ['/auth', '/properties', '/refund-requests'] as const;

export interface ExceptionsModel {
  state: ControllerState;
  controller: ExceptionController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useExceptions(): ExceptionsModel {
  const holder = useRef<ExceptionController | null>(null);
  const pin = useRef<PinBox>({ current: null });
  const session = useOpsSession(MODULES, {
    onExpired: () => holder.current?.expire(),
    getPinToken: () => pin.current.current,
  });
  const [controller, setController] = useState<ExceptionController | null>(null);
  // Mở ở cơ sở đang làm việc và dựng lại khi đổi cơ sở trên thanh ngữ cảnh (TD-44).
  const working = useWorkingPropertyId();
  useEffect(() => {
    const created = new ExceptionController({
      ports: createPorts(session.client, pin.current),
      filter: { ...emptyFilter, propertyId: working },
    });
    holder.current = created;
    setController(created);
    void created.load();
    return () => {
      created.dispose();
      holder.current = null;
    };
  }, [session, working]);
  const subscribe = useCallback(
    (listener: () => void) => controller?.subscribe(listener) ?? (() => undefined),
    [controller],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => controller?.getState() ?? INITIAL_STATE,
    () => INITIAL_STATE,
  );
  return { state, controller };
}
