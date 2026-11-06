'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { INITIAL_STATE, WalkOutController, type ControllerState } from './controller';
import type { Params } from './model';
import { createPorts, type PinBox } from './port';

const MODULES = ['/auth', '/room-merges', '/room-moves'] as const;

export interface WalkOutModel {
  state: ControllerState;
  controller: WalkOutController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useWalkOut(params: Params): WalkOutModel {
  const holder = useRef<WalkOutController | null>(null);
  const pin = useRef<PinBox>({ current: null });
  const session = useOpsSession(MODULES, {
    onExpired: () => holder.current?.expire(),
    getPinToken: () => pin.current.current,
  });
  const [controller, setController] = useState<WalkOutController | null>(null);
  const { mergeId, moveId } = params;
  useEffect(() => {
    const created = new WalkOutController({
      ports: createPorts(session.client, pin.current),
      params: { mergeId, moveId },
    });
    holder.current = created;
    setController(created);
    void created.load();
    return () => {
      created.dispose();
      holder.current = null;
    };
  }, [session, mergeId, moveId]);
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
