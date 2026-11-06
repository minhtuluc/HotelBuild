'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { OtaController, INITIAL_STATE, type ControllerState } from './controller';
import { createPorts } from './port';

const MODULES = ['/auth', '/channels'] as const;

export interface OtaModel {
  state: ControllerState;
  controller: OtaController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useOta(): OtaModel {
  const holder = useRef<OtaController | null>(null);
  const session = useOpsSession(MODULES, { onExpired: () => holder.current?.expire() });
  const [controller, setController] = useState<OtaController | null>(null);
  useEffect(() => {
    const created = new OtaController({ ports: createPorts(session.client) });
    holder.current = created;
    setController(created);
    void created.load();
    return () => {
      created.dispose();
      holder.current = null;
    };
  }, [session]);
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
