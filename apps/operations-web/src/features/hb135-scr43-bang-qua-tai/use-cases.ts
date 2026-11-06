'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpsSession } from '../../lib/ops-session';
import { CaseController, INITIAL_STATE, type ControllerState } from './controller';
import { emptyFilter } from './model';
import { createPorts } from './port';
import { defaultRange } from '../../lib/inventory-grid';

/** Mặc định xem 30 ngày tới (AC1); người dùng xoá ngày để xem cả ca đã qua. */
const defaultWindow = (now: Date) => {
  const range = defaultRange(now, 30);
  return { dateFrom: range.from, dateTo: range.to };
};

const MODULES = ['/auth', '/properties', '/room-types', '/overbooking-cases'] as const;

export interface CasesModel {
  state: ControllerState;
  controller: CaseController | null;
}

/** Dựng bộ điều khiển trong effect (StrictMode chạy effect hai lần) và nối vào React qua store ngoài. */
export function useCases(): CasesModel {
  const holder = useRef<CaseController | null>(null);
  const session = useOpsSession(MODULES, { onExpired: () => holder.current?.expire() });
  const [controller, setController] = useState<CaseController | null>(null);
  useEffect(() => {
    const created = new CaseController({
      ports: createPorts(session.client),
      filter: { ...emptyFilter, ...defaultWindow(new Date()) },
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
