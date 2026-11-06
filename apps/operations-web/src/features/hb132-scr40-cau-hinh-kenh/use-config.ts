'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { defaultRange } from '../../lib/inventory-grid';
import { useOpsSession } from '../../lib/ops-session';
import { ConfigController, INITIAL_STATE, type ControllerState } from './controller';
import { createPorts } from './port';

const MODULES = [
  '/auth',
  '/properties',
  '/room-types',
  '/channels',
  '/channel-allotments',
] as const;

export interface ConfigModel {
  state: ControllerState;
  controller: ConfigController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useConfig(): ConfigModel {
  const holder = useRef<ConfigController | null>(null);
  const session = useOpsSession(MODULES, { onExpired: () => holder.current?.expire() });
  const [controller, setController] = useState<ConfigController | null>(null);
  useEffect(() => {
    const created = new ConfigController({
      ports: createPorts(session.client),
      selection: {
        propertyId: null,
        channelId: null,
        roomTypeId: null,
        range: defaultRange(new Date()),
      },
    });
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
