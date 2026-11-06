'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { SyncController, INITIAL_STATE, type ControllerState } from './controller';
import { createPorts } from './port';

const MODULES = ['/auth', '/channels', '/operations'] as const;

export interface SyncModel {
  state: ControllerState;
  controller: SyncController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useSync(): SyncModel {
  const holder = useRef<SyncController | null>(null);
  const session = useOpsSession(MODULES, { onExpired: () => holder.current?.expire() });
  const [controller, setController] = useState<SyncController | null>(null);
  useEffect(() => {
    const created = new SyncController({ ports: createPorts(session.client) });
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
