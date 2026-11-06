'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { INITIAL_STATE, RelocationController, type ControllerState } from './controller';
import type { Params } from './model';
import { createPorts, type PinBox } from './port';

const MODULES = ['/auth', '/overbooking-cases', '/room-moves', '/bookings'] as const;

export interface RelocationModel {
  state: ControllerState;
  controller: RelocationController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useRelocation(params: Params): RelocationModel {
  const holder = useRef<RelocationController | null>(null);
  const pin = useRef<PinBox>({ current: null });
  const session = useOpsSession(MODULES, {
    onExpired: () => holder.current?.expire(),
    getPinToken: () => pin.current.current,
  });
  const [controller, setController] = useState<RelocationController | null>(null);
  const { caseId, bookingId, bookingRoomId, moveId } = params;
  useEffect(() => {
    const created = new RelocationController({
      ports: createPorts(session.client, pin.current),
      params: { caseId, bookingId, bookingRoomId, moveId },
    });
    holder.current = created;
    setController(created);
    void created.load();
    return () => {
      created.dispose();
      holder.current = null;
    };
  }, [session, caseId, bookingId, bookingRoomId, moveId]);
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
